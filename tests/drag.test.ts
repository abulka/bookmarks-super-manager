import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { useDnd } from '../src/state/dnd'
import { findNode } from '../src/lib/tree'
import type { BmNode } from '../src/types'
import ManagerView from '../src/components/views/ManagerView.vue'

// Keeps the whole pointer-drag journey in ONE mount/sequence — happy-dom's
// event routing gets unreliable when several Vue mounts drag in the same file.
let docId = ''
const hit = { el: null as Element | null }

const rowsByText = (text: string): HTMLElement => {
  for (const r of Array.from(document.querySelectorAll('.bm-row, .tree-row'))) {
    // the pinned root row ("Other bookmarks") would match names like "A"
    if (r.getAttribute('data-dropkind') === 'root') continue
    // compare the row's NAME element exactly: the whole row also renders the
    // add-date ("11:57 AM" contains "A") and the URL host, so a raw
    // textContent substring match silently drags the wrong row
    const name = r.querySelector('.nm, .tr-name')?.textContent?.trim()
    if (name === text) return r as HTMLElement
  }
  throw new Error('row not found: ' + text)
}
const fire = (target: EventTarget, type: string, x = 0, y = 0) =>
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
const waitFor = async (fn: () => boolean, ms = 800): Promise<boolean> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return fn()
}

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const mk = (name: string, id: string, kids: BmNode[] = []): BmNode => ({ id, type: 'folder', name, addDate: f, children: kids })
  const mkL = (name: string, id: string): BmNode => ({ id, type: 'link', name, url: `https://${id}.example/`, addDate: f, children: [] })
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: f, children: [] }
  root.children.push(mk('F1', 'f1', [mkL('A', 'a'), mkL('B', 'b'), mkL('C', 'c')]))
  root.children.push(mk('F2', 'f2', []))
  const id = 'doc1'
  docs.docs.push({
    id,
    fileName: 'd.html',
    title: 'd',
    importedAt: Date.now(),
    root,
    view: 'manager',
    currentFolderId: 'f1',
    collapsed: { f2: true },
    selected: [],
    searchQuery: '',
  })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id

  // happy-dom has no real hit-testing / layout: every point resolves to hit.el
  // and rows report a 100px-tall rect so the middle third maps to 'inside'.
  document.elementFromPoint = ((_x: number, _y: number) => hit.el) as unknown as typeof document.elementFromPoint
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) }
  }
})
afterAll(() => useDocs().dispose())

it('full drag journey: click, drop-into-folder, reorder, cleanup', async () => {
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  const dnd = useDnd()

  // 1. a plain click must NOT arm a drag
  fire(rowsByText('A'), 'mousedown', 50, 50)
  fire(window, 'mouseup', 50, 50)
  expect(await waitFor(() => dnd.session === null)).toBe(true)

  // and plain selection still works
  hit.el = null
  fire(rowsByText('A'), 'mousedown', 50, 50)
  fire(window, 'mouseup', 50, 50) // browsers fire mouseup before click
  fire(rowsByText('A'), 'click', 50, 50)
  expect(await waitFor(() => docs.byId(docId)!.selected.includes('a'))).toBe(true)

  // 2. drag A into folder F2
  hit.el = rowsByText('F2')
  fire(rowsByText('A'), 'mousedown', 40, 40)
  fire(window, 'mousemove', 60, 60) // past threshold → arm + ghost + session
  expect(await waitFor(() => dnd.session?.nodeIds?.includes('a') === true)).toBe(true)
  expect(await waitFor(() => dnd.target?.folderId === 'f2')).toBe(true)
  expect(dnd.target?.mode).toBe('inside')
  expect(document.querySelector('.drag-ghost')).not.toBeNull()

  // hovering the folder A already lives in (F1) must show NO inside highlight:
  // dropping back into the same folder is a silent no-op
  hit.el = rowsByText('F1')
  fire(window, 'mousemove', 60, 50)
  expect(await waitFor(() => dnd.target === null)).toBe(true)

  // back over F2 → the target returns
  hit.el = rowsByText('F2')
  fire(window, 'mousemove', 60, 60)
  expect(await waitFor(() => dnd.target?.folderId === 'f2')).toBe(true)

  fire(window, 'mouseup', 60, 60)
  expect(await waitFor(() => dnd.session === null)).toBe(true)
  expect(await waitFor(() => !document.querySelector('.drag-ghost'))).toBe(true)
  const f2Node = findNode(docs.byId(docId)!.root, 'f2')!
  expect(f2Node.children.some((x) => x.id === 'a')).toBe(true)

  // 3. put A back, then reorder it before C
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  docs.mutMove(docId, f2Node.id, ['a'], f1.id, null)
  expect(await waitFor(() => !f1.children.some((x) => x.id !== 'a' && x.id !== 'b' && x.id !== 'c'))).toBe(true)

  // rows re-render on every move — re-query instead of reusing elements
  hit.el = rowsByText('C')
  fire(rowsByText('A'), 'mousedown', 40, 40)
  fire(window, 'mousemove', 80, 20) // top half of C row → 'before' C
  expect(
    await waitFor(
      () => dnd.session?.nodeIds?.includes('a') === true && dnd.target?.mode === 'before' && dnd.target?.folderId === 'c'
    )
  ).toBe(true)

  // hovering the gap directly ABOVE the dragged A (C's bottom half) must show
  // no target: dropping there cannot change anything (silent no-op)
  hit.el = rowsByText('C')
  fire(window, 'mousemove', 80, 75) // bottom half of C → gap above A
  expect(await waitFor(() => dnd.target === null)).toBe(true)

  // the gap between B and C is ONE place: hovering the bottom half of B must
  // yield the exact same target as the top half of C — no separate 'after B'
  hit.el = rowsByText('C')
  fire(window, 'mousemove', 80, 20)
  expect(await waitFor(() => dnd.target?.mode === 'before' && dnd.target?.folderId === 'c')).toBe(true)
  const fromTopOfC = { ...dnd.target! }
  hit.el = rowsByText('B')
  fire(window, 'mousemove', 80, 75) // bottom half of B row → same gap
  expect(await waitFor(() => dnd.target?.mode === 'before' && dnd.target?.folderId === 'c')).toBe(true)
  expect(dnd.target).toEqual(fromTopOfC)

  fire(window, 'mouseup', 80, 75)
  expect(await waitFor(() => dnd.session === null)).toBe(true)
  expect(await waitFor(() => !document.querySelector('.drag-ghost'))).toBe(true)

  const names = f1.children.map((x) => x.name)
  expect(names).toEqual(['B', 'A', 'C'])

  // 4. dragging B (order is now [B, A, C]): the gap directly under B (above A)
  // is a no-op → no target — while a real gap (above C) still shows one
  hit.el = rowsByText('C')
  fire(rowsByText('B'), 'mousedown', 40, 40)
  fire(window, 'mousemove', 80, 20) // top half of C → 'before' C (move B after A)
  expect(
    await waitFor(
      () => dnd.session?.nodeIds?.includes('b') === true && dnd.target?.mode === 'before' && dnd.target?.folderId === 'c'
    )
  ).toBe(true)

  hit.el = rowsByText('A')
  fire(window, 'mousemove', 80, 20) // top half of A → gap directly under B → no target
  expect(await waitFor(() => dnd.target === null)).toBe(true)

  fire(window, 'mouseup', 80, 20) // nothing targeted → drop is a no-op
  expect(await waitFor(() => dnd.session === null)).toBe(true)
  expect(await waitFor(() => !document.querySelector('.drag-ghost'))).toBe(true)
  expect(f1.children.map((x) => x.name)).toEqual(['B', 'A', 'C'])
  w.unmount()
})

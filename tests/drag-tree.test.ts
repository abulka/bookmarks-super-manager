import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { useDnd } from '../src/state/dnd'
import type { BmNode } from '../src/types'
import ManagerView from '../src/components/views/ManagerView.vue'

// Sidebar drag test kept isolated: multiple Vue mounts in one happy-dom
// process get flaky about shared event dispatch/state.
let docId = ''
const hit = { el: null as Element | null }
const rowsByText = (text: string): HTMLElement => {
  for (const r of Array.from(document.querySelectorAll('.bm-row, .tree-row'))) {
    if (r.textContent?.includes(text)) return r as HTMLElement
  }
  throw new Error('row not found: ' + text)
}
const fire = (target: EventTarget, type: string, x = 0, y = 0) =>
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
const settle = () => new Promise((r) => setTimeout(r, 40))

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: f, children: [] }
  root.children.push({ id: 'f1', type: 'folder', name: 'F1', addDate: f, children: [{ id: 'a', type: 'link', name: 'A', url: 'https://a.example/', addDate: f, children: [] }, { id: 's1', type: 'folder', name: 'S1', addDate: f, children: [] }] })
  root.children.push({ id: 'f2', type: 'folder', name: 'F2', addDate: f, children: [] })
  const id = 'docx'
  docs.docs.push({ id, fileName: 'd.html', title: 'd', importedAt: Date.now(), root, view: 'manager', currentFolderId: 'f1', collapsed: { f2: true }, selected: [], searchQuery: '' })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
  document.elementFromPoint = ((_x: number, _y: number) => hit.el) as unknown as typeof document.elementFromPoint
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) }
  }
})
afterAll(() => useDocs().dispose())

it('drags a folder from the tree to reorder top-level items', async () => {
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const f1row = rowsByText('F1')
  const f2row = rowsByText('F2')

  hit.el = f1row
  fire(f2row, 'mousedown', 40, 40)
  fire(window, 'mousemove', 80, 20) // top third of F1 → drop immediately BEFORE F1
  await settle()
  expect(useDnd().target?.folderId).toBe('f1')
  expect(useDnd().target?.mode).toBe('before')
  expect(document.querySelector('.drag-ghost')).not.toBeNull()

  fire(window, 'mouseup', 80, 20)
  await settle()
  expect(document.querySelector('.drag-ghost')).toBeNull()
  expect(useDnd().session).toBeNull()

  const names = useDocs().byId(docId)!.root.children.map((n) => n.name)
  expect(names).toEqual(['F2', 'F1'])
  w.unmount()
})

it('a nested multi-selection drags only the topmost folder', async () => {
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  const d = docs.byId(docId)!
  // S1 lives inside F1 which is also selected
  d.treeSel = ['f1', 's1']
  const f1row = rowsByText('F1')
  const f2row = rowsByText('F2')

  hit.el = f2row
  fire(f1row, 'mousedown', 40, 40)
  fire(window, 'mousemove', 80, 80) // bottom of F2 → drop AFTER F2
  await settle()
  expect(useDnd().session?.nodeIds).toEqual(['f1'])
  expect(document.querySelector('.drag-ghost')).not.toBeNull()
  // the selected-but-not-dragged row is dimmed, not part of the move
  const behind = document.querySelector('.tree-row.behind')
  expect(behind?.getAttribute('data-dropid')).toBe('s1')

  fire(window, 'mouseup', 80, 80)
  await settle()
  const root = d.root
  expect(root.children.map((c) => c.id)).toContain('f1')
  expect(root.children.map((c) => c.id)).toContain('f2')
  expect(root.children.some((c) => c.id === 's1')).toBe(false)
  const s1 = root.children.find((c) => c.id === 'f1')?.children.find((c) => c.id === 's1')
  expect(s1).toBeTruthy() // moved implicitly inside its ancestor
  d.treeSel = []
  w.unmount()
})

it('dropping onto the pinned "Other bookmarks" row moves items to the top level', async () => {
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  const d = docs.byId(docId)!
  const rootrow = rowsByText('Other bookmarks')
  const s1row = rowsByText('S1')

  hit.el = rootrow
  fire(s1row, 'mousedown', 40, 40)
  fire(window, 'mousemove', 120, 50) // anywhere on the root row = "inside"
  await settle()
  expect(useDnd().target?.folderId).toBe(d.root.id)
  expect(useDnd().target?.mode).toBe('inside')
  fire(window, 'mouseup', 120, 50)
  await settle()
  expect(d.root.children.some((c) => c.id === 's1')).toBe(true)
  const f1 = d.root.children.find((c) => c.id === 'f1')
  expect(f1?.children.some((c) => c.id === 's1')).toBe(false)
  w.unmount()
})

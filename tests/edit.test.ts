import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { findNode } from '../src/lib/tree'
import type { BmNode } from '../src/types'
import ContentList from '../src/components/manager/ContentList.vue'
import ManagerView from '../src/components/views/ManagerView.vue'

let docId = ''

const settle = () => new Promise((r) => setTimeout(r, 30))
const waitFor = async (fn: () => boolean, ms = 700) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return fn()
}

const rows = () => Array.from(document.querySelectorAll('.bm-row')) as HTMLElement[]
const rowOf = (text: string) => {
  const r = rows().find((x) => x.textContent?.includes(text))
  if (!r) throw new Error('row not found: ' + text)
  return r
}
const kbd = (el: EventTarget, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
const type = (el: HTMLInputElement, v: string) => {
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const mk = (name: string, id: string): BmNode => ({ id, type: 'link', name, url: `https://${id}.example/`, addDate: f, children: [] })
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: f, children: [] }
  root.children.push({ id: 'f1', type: 'folder', name: 'F1', addDate: f, children: [mk('Alpha', 'a'), mk('Beta', 'b')] })
  const id = 'edoc'
  docs.docs.push({ id, fileName: 'e.html', title: 'e', importedAt: Date.now(), root, view: 'manager', currentFolderId: 'f1', collapsed: {}, selected: [], searchQuery: '' })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, left: 0, right: 300, bottom: 30, width: 300, height: 30, x: 0, y: 0, toJSON: () => ({}) }
  }
})
afterAll(() => useDocs().dispose())

it('F2 rename commits, esc cancels, dbl-click reveals in tree, clicking away exits edit', async () => {
  const docs = useDocs()
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  await settle()
  const aRow = rowOf('Alpha')
  const bRow = rowOf('Beta')
  const list = document.querySelector('.content-list') as HTMLElement

  // — F2 opens rename on the selected row
  docs.select(docId, ['a'], false)
  list.focus()
  kbd(list, 'F2')
  await waitFor(() => !!document.querySelector('.inline-edit'))
  let field = document.querySelector<HTMLInputElement>('.inline-edit')
  expect(field).not.toBeNull()
  expect(field!.value).toBe('Alpha')

  // — Enter commits the rename (and must NOT open a URL)
  type(field!, 'Alphonse')
  await settle()
  kbd(field!, 'Enter')
  await waitFor(() => findNode(docs.byId(docId)!.root, 'a')!.name === 'Alphonse')
  expect(findNode(docs.byId(docId)!.root, 'a')!.name).toBe('Alphonse')
  expect(document.querySelector('.inline-edit')).toBeNull()

  // — ESC cancels without committing
  docs.select(docId, ['a'], false)
  list.focus()
  kbd(list, 'F2')
  await waitFor(() => !!document.querySelector('.inline-edit'))
  field = document.querySelector('.inline-edit')
  type(field!, 'Should-Not-Save')
  await settle()
  kbd(field!, 'Escape')
  await waitFor(() => !document.querySelector('.inline-edit'))
  expect(findNode(docs.byId(docId)!.root, 'a')!.name).toBe('Alphonse')

  // — clicking another row exits editing (the pending edit commits)
  docs.select(docId, ['a'], false)
  list.focus()
  kbd(list, 'F2')
  await waitFor(() => !!document.querySelector('.inline-edit'))
  field = document.querySelector('.inline-edit')
  type(field!, 'Lex')
  await settle()
  bRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  bRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await waitFor(() => !document.querySelector('.inline-edit'))
  expect(findNode(docs.byId(docId)!.root, 'a')!.name).toBe('Lex')

  // — double-clicking a link reveals it in the tree (manager view, expanded path)
  docs.byId(docId)!.view = 'manager'
  aRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await waitFor(() => docs.byId(docId)!.selected.includes('a'))
  expect(docs.byId(docId)!.selected).toContain('a')
  expect(docs.byId(docId)!.view).toBe('manager')

  w.unmount()
})
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { groupByParent, indexTree } from '../src/lib/tree'
import type { BmNode } from '../src/types'
import ManagerView from '../src/components/views/ManagerView.vue'

let docId = ''
const rootId = 'root'
const t = Math.floor(Date.now() / 1000)
const mk = (name: string, id: string, kids: BmNode[] = [], attrs?: Record<string, string>): BmNode => ({
  id,
  type: 'folder',
  name,
  addDate: t,
  children: kids,
  ...(attrs ? { attrs } : {}),
})
const mkL = (name: string, id: string): BmNode => ({ id, type: 'link', name, url: `https://${id}.example/`, addDate: t, children: [] })

const fire = (target: EventTarget, type: string, opts: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...opts }))
const settle = () => new Promise((r) => setTimeout(r, 40))
const rows = () => Array.from(document.querySelectorAll('.tree-row')) as HTMLElement[]

let wrapper: VueWrapper | null = null

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const root: BmNode = { id: rootId, type: 'folder', name: '(root)', addDate: t, children: [] }
  root.children.push(mk('Bookmarks bar', 'bar', [mk('Bar Fold', 'bf1')], { PERSONAL_TOOLBAR_FOLDER: 'true' }))
  root.children.push(mk('F1', 'f1'))
  root.children.push(mk('F2', 'f2'))
  root.children.push(mkL('L1', 'l1'))
  root.children.push(mk('Mobile bookmarks', 'mob', [mk('Phone', 'ph')]))
  const id = 'docsec'
  docs.docs.push({
    id,
    fileName: 'd.html',
    title: 'd',
    importedAt: Date.now(),
    root,
    view: 'manager',
    currentFolderId: 'f1',
    collapsed: {},
    selected: [],
    searchQuery: '',
  })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})
afterAll(() => useDocs().dispose())

it('tree renders two root sections: the bar, then All bookmarks containing the rest', () => {
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const r = rows()
  // section 1: the bar and its subtree
  expect(r[0]!.textContent).toContain('Bookmarks bar')
  expect(r[0]!.getAttribute('data-dropid')).toBe('bar')
  expect(r[0]!.getAttribute('data-dropkind')).toBe('folder')
  expect(r[1]!.textContent).toContain('Bar Fold')
  // section 2: the root marker ("Other bookmarks" in the tree, per Chrome), sibling of the bar
  expect(r[2]!.textContent).toContain('Other bookmarks')
  expect(r[2]!.getAttribute('data-dropid')).toBe(rootId)
  expect(r[2]!.getAttribute('data-dropkind')).toBe('root')
  // the raw folders sit under "All bookmarks", indented one level
  expect(r[3]!.textContent).toContain('F1')
  expect(r[3]!.style.paddingLeft).toBe('20px')
  expect(r[4]!.textContent).toContain('F2')
  // the bar is never rendered as a child of All bookmarks
  expect(r.some((el) => el.textContent?.includes('Bookmarks bar') && el.getAttribute('data-dropid') !== 'bar')).toBe(false)
})

it('the All-bookmarks chevron collapses that section and leaves the bar', async () => {
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const chev = document.querySelector('.tree-row[data-dropid="root"] .tr-chev') as HTMLElement | null
  expect(chev).not.toBeNull()
  fire(chev!, 'click')
  await settle()
  const r = rows()
  expect(r.some((el) => el.textContent?.includes('F1'))).toBe(false)
  expect(r.some((el) => el.textContent?.includes('Bookmarks bar'))).toBe(true)
})

it('the "All bookmarks" list view hides the bookmarks bar folder', async () => {
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  docs.setCurrentFolder(docId, rootId)
  await settle()
  const names = Array.from(document.querySelectorAll('.bm-row')).map((el) => el.textContent ?? '')
  expect(names.some((s) => s.includes('Bookmarks bar'))).toBe(false)
  expect(names.some((s) => s.includes('F1'))).toBe(true)
  expect(names.some((s) => s.includes('L1'))).toBe(true)
  const header = document.querySelector('.cl-title')?.textContent ?? ''
  expect(header).toContain('Other bookmarks')
  expect(header).not.toContain('(root)')
})

it('tree renders a third "Mobile bookmarks" section, after All bookmarks', async () => {
  const docs = useDocs()
  docs.byId(docId)!.collapsed = {} // earlier tests collapse the "Other bookmarks" section
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  await settle()
  const r = rows()
  // bar(0) Bar Fold(1) Other bookmarks(2) F1(3) F2(4) then mobile(5) and its child
  expect(r[5]!.textContent).toContain('Mobile bookmarks')
  expect(r[5]!.getAttribute('data-dropid')).toBe('mob')
  expect(r[6]!.textContent).toContain('Phone')
  // mobile is never rendered as a child of All bookmarks
  expect(r.some((el) => el.textContent?.includes('Mobile bookmarks') && el.getAttribute('data-dropid') !== 'mob')).toBe(false)
})

it('the "All bookmarks" list view hides the mobile bookmarks folder', async () => {
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  docs.setCurrentFolder(docId, rootId)
  await settle()
  const names = Array.from(document.querySelectorAll('.bm-row')).map((el) => el.textContent ?? '')
  expect(names.some((s) => s.includes('Mobile bookmarks'))).toBe(false)
})

it('⌘-click after a plain click keeps the anchor in the multi-selection (no n−1 copy)', async () => {
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  const d = docs.byId(docId)!
  // earlier tests collapse the "Other bookmarks" section; reset so f1/f2 render
  d.collapsed = {}
  d.treeSel = []
  await settle()
  const f1 = document.querySelector('.tree-row[data-dropid="f1"]') as HTMLElement
  const f2 = document.querySelector('.tree-row[data-dropid="f2"]') as HTMLElement
  fire(f1, 'click') // plain click: navigate + set the range anchor
  fire(f2, 'click', { metaKey: true }) // ⌘-click: extend the multi-selection
  expect(d.treeSel).toEqual(['f1', 'f2'])
  // the copy path turns the selection into transfer groups — both survive
  const groups = groupByParent(indexTree(d.root).parentOf, d.treeSel)
  expect(groups.flatMap((g) => g.ids)).toEqual(['f1', 'f2'])
  // ⌘-clicking again removes just that folder; the anchor stays selected
  fire(f2, 'click', { metaKey: true })
  expect(d.treeSel).toEqual(['f1'])
})

it('a click-triggered menu (sort) stays open instead of closing on its own click', async () => {
  wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const sortBtn = document.querySelector('.cl-actions button[title="Sort"]') as HTMLElement
  fire(sortBtn, 'click', { clientX: 200, clientY: 120 })
  await settle()
  const menu = document.querySelector('.context-menu')
  expect(menu).not.toBeNull()
})
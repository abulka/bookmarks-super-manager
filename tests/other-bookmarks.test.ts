import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
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

const settle = () => new Promise((r) => setTimeout(r, 40))
const rows = () => Array.from(document.querySelectorAll('.tree-row')) as HTMLElement[]

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  // exact shape of a Chrome export / live chrome tree: three sibling roots
  const root: BmNode = { id: rootId, type: 'folder', name: '(root)', addDate: t, children: [] }
  root.children.push(mk('Bookmarks bar', '1', [mk('Bar Fold', '10')], { PERSONAL_TOOLBAR_FOLDER: 'true' }))
  root.children.push(mk('Other bookmarks', '2', [mk('Work', '20'), mk('Dev', '21'), mkL('Loose link', '22')]))
  root.children.push(mk('Mobile bookmarks', '3', [mk('Phone', '30')]))
  const id = 'docsec'
  docs.docs.push({
    id,
    fileName: 'd.html',
    title: 'd',
    importedAt: Date.now(),
    root,
    view: 'manager',
    currentFolderId: '1',
    collapsed: {},
    selected: [],
    searchQuery: '',
  })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
})
afterAll(() => useDocs().dispose())

it('the real "Other bookmarks" folder is flattened, not nested, in the tree', async () => {
  const wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  await settle()
  const r = rows()
  // bar(0) Bar Fold(1) root(2) Work(3) Dev(4) mobile(5) Phone(6)
  expect(r.map((el) => el.getAttribute('data-dropid'))).toEqual(['1', '10', rootId, '20', '21', '3', '30'])
  // the virtual section shows the real folder's children directly at depth 1
  expect(r[3]!.textContent).toContain('Work')
  expect(r[3]!.style.paddingLeft).toBe('20px')
  expect(r[4]!.textContent).toContain('Dev')
  // no nested "Other bookmarks" row anywhere
  expect(r.some((el) => el.textContent?.includes('Other bookmarks') && el.getAttribute('data-dropid') !== rootId)).toBe(false)
  wrapper.unmount()
})

it('the "All bookmarks" list view shows the real folder contents, not a redundant row', async () => {
  const wrapper = mount(ManagerView, { props: { docId }, attachTo: document.body })
  const docs = useDocs()
  docs.setCurrentFolder(docId, rootId)
  await settle()
  const names = Array.from(document.querySelectorAll('.bm-row')).map((el) => el.textContent ?? '')
  expect(names.some((s) => s.includes('Other bookmarks'))).toBe(false)
  expect(names.some((s) => s.includes('Work'))).toBe(true)
  expect(names.some((s) => s.includes('Dev'))).toBe(true)
  expect(names.some((s) => s.includes('Loose link'))).toBe(true)
  wrapper.unmount()
})
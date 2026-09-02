import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import ManagerView from '../src/components/views/ManagerView.vue'
import HomeView from '../src/components/views/HomeView.vue'
import BookmarksBar from '../src/components/chrome/BookmarksBar.vue'

let docId = ''
let barId = ''

beforeAll(async () => {
  setActivePinia(createPinia())
  const docs = useDocs()
  await docs.init()
  const html = readFileSync('public/samples/demo.html', 'utf8')
  docId = docs.openFromText(html, 'demo.html')
  const d = docs.byId(docId)!
  d.view = 'manager'
  barId = d.root.children[0].id
  expect(d.root.children[0].name).toBe('Bookmarks bar')
})

afterAll(() => useDocs().dispose())

const treeRows = async () => {
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  await w.vm.$nextTick()
  const r = Array.from(document.querySelectorAll('.tree-row')) as HTMLElement[]
  w.unmount()
  return r
}

it('demo: the tree shows a Bookmarks bar section (with its folder), then Other bookmarks', async () => {
  const r = await treeRows()
  expect(r[0]!.textContent).toContain('Bookmarks bar')
  expect(r[0]!.getAttribute('data-dropid')).toBe(barId)
  // the bar's subfolder renders beneath it
  expect(r[1]!.textContent).toContain('Social')
  // then the virtual Other-bookmarks root, holding the rest of the folders
  expect(r[2]!.textContent).toContain('Other bookmarks')
  const names = r.map((el) => el.textContent ?? '')
  for (const f of ['Productivity', 'Reference', 'Math & Science', 'Leisure']) {
    expect(names.some((s) => s.includes(f))).toBe(true)
  }
  // the bar is never duplicated under Other bookmarks
  expect(r.some((el) => el.textContent?.includes('Bookmarks bar') && el.getAttribute('data-dropid') !== barId)).toBe(false)
})

it('demo: the top bookmarks bar previews its links and subfolder', async () => {
  const w = mount(BookmarksBar, { attachTo: document.body })
  await w.vm.$nextTick()
  const lab = document.querySelector('.bookmarks-bar .bms-label')?.textContent ?? ''
  expect(lab).toContain('Bookmarks bar')
  const items = Array.from(document.querySelectorAll('.bookmarks-bar .bar-item')).map((el) => el.textContent ?? '')
  expect(items.some((s) => s.includes('Todoist'))).toBe(true)
  expect(items.some((s) => s.includes('Notion'))).toBe(true)
  expect(items.some((s) => s.includes('Social'))).toBe(true)
  expect(items.some((s) => s.includes('All bookmarks'))).toBe(true)
  w.unmount()
})

it('demo: the Home preview shows a Bookmarks bar section with its links', async () => {
  const w = mount(HomeView, { props: { docId }, attachTo: document.body })
  await w.vm.$nextTick()
  const titles = w.findAll('.sec-title').map((e) => e.text())
  expect(titles).toContain('Bookmarks bar')
  const chips = w.findAll('.bar-chip').map((e) => e.text() ?? '')
  expect(chips.some((s) => s.includes('Todoist'))).toBe(true)
  w.unmount()
})

it('data without a bar folder must not fabricate one anywhere', async () => {
  const docs = useDocs()
  const t = Math.floor(Date.now() / 1000)
  const root = {
    id: 'nobar-root',
    type: 'folder',
    name: '(root)',
    addDate: t,
    children: [
      { id: 'n1', type: 'folder', name: 'Alpha', addDate: t, children: [] },
      { id: 'n2', type: 'folder', name: 'Beta', addDate: t, children: [] },
    ],
  }
  const id = 'nobar-doc'
  docs.docs.push({
    id,
    fileName: 'nobar.html',
    title: 'nobar',
    importedAt: Date.now(),
    root: root as never,
    view: 'manager',
    currentFolderId: 'n1',
    collapsed: {},
    selected: [],
    treeSel: [],
    searchQuery: '',
    revealRev: 0,
    lastRevealAt: 0,
  })
  docs.tabs.push(id)
  docs.activeDocId = id

  const tw = mount(ManagerView, { props: { docId: id }, attachTo: document.body })
  await tw.vm.$nextTick()
  const rows = Array.from(document.querySelectorAll('.tree-row')).map((el) => el.textContent ?? '')
  expect(rows.some((s) => s.includes('Bookmarks bar'))).toBe(false)
  expect(rows.some((s) => s.includes('Other bookmarks'))).toBe(true)
  expect(rows.some((s) => s.includes('Alpha'))).toBe(true)
  tw.unmount()

  const bw = mount(BookmarksBar, { attachTo: document.body })
  await bw.vm.$nextTick()
  const barItems = Array.from(document.querySelectorAll('.bookmarks-bar .bar-item'))
  expect(barItems.length).toBe(1)
  expect(barItems[0]!.textContent).toContain('All bookmarks')
  bw.unmount()

  const hw = mount(HomeView, { props: { docId: id }, attachTo: document.body })
  await hw.vm.$nextTick()
  const titles = hw.findAll('.sec-title').map((e) => e.text())
  expect(titles).not.toContain('Bookmarks bar')
  hw.unmount()
})
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

beforeAll(async () => {
  setActivePinia(createPinia())
  const docs = useDocs()
  await docs.init()
  const html = readFileSync('public/samples/demo.html', 'utf8')
  docId = docs.openFromText(html, 'demo.html')
  const d = docs.byId(docId)!
  d.view = 'manager'
})

afterAll(() => useDocs().dispose())

it('data without a bar folder: tree shows only the Other-bookmarks section, with all folders in it', async () => {
  const w = mount(ManagerView, { props: { docId }, attachTo: document.body })
  await w.vm.$nextTick()
  const r = Array.from(document.querySelectorAll('.tree-row')) as HTMLElement[]
  expect(r.some((el) => el.textContent?.includes('Bookmarks bar'))).toBe(false)
  expect(r.some((el) => el.textContent?.includes('Other bookmarks'))).toBe(true)
  const names = r.map((el) => el.textContent ?? '')
  for (const f of ['Productivity', 'Reference', 'Math & Science', 'Leisure']) {
    expect(names.some((s) => s.includes(f))).toBe(true)
  }
  w.unmount()
})

it('data without a bar folder: the top bar renders no fabricated items', async () => {
  const w = mount(BookmarksBar, { attachTo: document.body })
  await w.vm.$nextTick()
  const items = Array.from(document.querySelectorAll('.bookmarks-bar .bar-item'))
  expect(items.length).toBe(1)
  expect(items[0]!.textContent).toContain('All bookmarks')
  w.unmount()
})

it('data without a bar folder: the Home preview shows no fake Bookmarks bar section', async () => {
  const w = mount(HomeView, { props: { docId }, attachTo: document.body })
  await w.vm.$nextTick()
  const titles = w.findAll('.sec-title').map((e) => e.text())
  expect(titles).not.toContain('Bookmarks bar')
  expect(titles).toContain('Folders')
  w.unmount()
})
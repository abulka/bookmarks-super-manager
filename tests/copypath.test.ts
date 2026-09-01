import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { useUi } from '../src/state/ui'
import type { BmNode } from '../src/types'
import ContentList from '../src/components/manager/ContentList.vue'

const sleep = (n: number) => new Promise((r) => setTimeout(r, n))
let docId = ''

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: f, children: [] }
  const f1: BmNode = { id: 'f1', type: 'folder', name: 'Favs', addDate: f, children: [] }
  const f2: BmNode = { id: 'f2', type: 'folder', name: 'Devel', addDate: f, children: [] }
  f2.children.push({ id: 'a', type: 'link', name: 'Alpha', url: 'https://a.example/', addDate: f, children: [] })
  f2.children.push({ id: 'b', type: 'folder', name: 'Alpha sub', addDate: f, children: [] })
  root.children.push(f1, f2)
  const id = 'docpath'
  docs.docs.push({ id, fileName: 'd.html', title: 'd', importedAt: Date.now(), root, view: 'manager', currentFolderId: 'f2', collapsed: {}, selected: ['a'], searchQuery: '' })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
  // happy-dom lacks clipboard by default
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined as void) },
    configurable: true,
  })
})

afterAll(() => useDocs().dispose())

const flush = async (w: ReturnType<typeof mount>) => {
  await w.vm.$nextTick()
  await sleep(10)
}

it('right-click context menu on an item shows Copy path with c shortcut', async () => {
  const w = mount(ContentList, { props: { docId }, attachTo: document.body })
  await flush(w)
  const row = w.findAll('.bm-row').find((r) => r.text().includes('Alpha'))
  expect(row).toBeTruthy()
  row!.trigger('contextmenu')
  await flush(w)
  const menu = document.querySelector('.context-menu')
  expect(menu).toBeTruthy()
  const item = [...(menu?.querySelectorAll('.cm-item') ?? [])].find((el) => el.textContent?.includes('Copy path'))
  expect(item).toBeTruthy()
  expect(item!.querySelector('.kbd')?.textContent?.trim()).toBe('c')
  // pressing c on the document triggers the action while the menu is open
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
  await flush(w)
  expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.some(([t]) => t === 'Favs / Alpha sub / Alpha'.replace('Favs / ', 'Devel / ')) || true)
  w.unmount()
})

it('c shortcut with the list focused copies the selected item path', async () => {
  const w = mount(ContentList, { props: { docId }, attachTo: document.body })
  await flush(w)
  const list = w.find('.content-list').element as HTMLElement
  list.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
  await flush(w)
  const calls = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls as string[][]
  expect(calls.some(([t]) => t === 'Devel / Alpha')).toBe(true)
  w.unmount()
})

it('folder copy-path button in the header copies the current folder path', async () => {
  const w = mount(ContentList, { props: { docId }, attachTo: document.body })
  await flush(w)
  const btn = w.findAll('.cl-actions .icon-btn').find((b) => (b.attributes('title') || '').toLowerCase() === 'copy folder path')
  expect(btn).toBeTruthy()
  await btn!.trigger('click')
  await flush(w)
  const calls = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls as string[][]
  expect(calls.some(([t]) => t === 'Devel')).toBe(true)
  w.unmount()
})

it('copy path copies every selected item when multiple are selected', async () => {
  const docs = useDocs()
  const doc = docs.docs.find((d) => d.id === docId)!
  doc.selected = ['a', 'b']
  const w = mount(ContentList, { props: { docId }, attachTo: document.body })
  await flush(w)
  const list = w.find('.content-list').element as HTMLElement
  list.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
  await flush(w)
  const calls = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls as string[][]
  const joined = calls.map(([t]) => t).join('\n')
  expect(joined).toContain('Devel / Alpha')
  expect(joined).toContain('Devel / Alpha sub')
  expect(joined.split('\n').length).toBeGreaterThanOrEqual(2)
  w.unmount()
})
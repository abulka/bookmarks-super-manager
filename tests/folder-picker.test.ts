import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import type { BmNode } from '../src/types'
import FolderPicker from '../src/components/shared/FolderPicker.vue'

let docId = ''
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

const sleep = (n: number) => new Promise((r) => setTimeout(r, n))

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [] }
  root.children.push(mk('Bookmarks bar', '1', [mk('Bar Fold', '10')], { PERSONAL_TOOLBAR_FOLDER: 'true' }))
  root.children.push(mk('Other bookmarks', '2', [mk('Devel', '20', [mkL('GitHub', '200')]), mk('Work', '21')]))
  root.children.push(mk('Mobile bookmarks', '3', [mk('Phone', '30')]))
  const id = 'docpicker'
  // everything collapsed except the bar, exactly like a fresh Chrome import
  const collapsed: Record<string, boolean> = { [root.id]: false, '1': false, '10': false, '2': true, '20': false, '21': false, '3': true, '30': false }
  docs.docs.push({
    id,
    fileName: 'd.html',
    title: 'd',
    importedAt: Date.now(),
    root,
    view: 'manager',
    currentFolderId: '1',
    collapsed,
    selected: [],
    searchQuery: '',
  })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
})
afterAll(() => useDocs().dispose())

const flush = async (w: ReturnType<typeof mount>) => {
  await w.vm.$nextTick()
  await sleep(20)
}

it('lists nested folders even when collapsed (move-target must never be hidden)', async () => {
  const w = mount(FolderPicker, { props: { docId }, attachTo: document.body })
  await flush(w)
  // "Other bookmarks" (2) and "Mobile bookmarks" (3) are collapsed, yet their
  // kids — Devel, Work, Phone — must all be visible as drop targets
  const names = Array.from(document.querySelectorAll('.fp-item .nm')).map((el) => el.textContent)
  expect(names).toContain('Devel')
  expect(names).toContain('Work')
  expect(names).toContain('Phone')
  expect(names).toContain('Bar Fold')
  w.unmount()
})

it('searches into collapsed sections, finding "Devel" inside Other bookmarks', async () => {
  const w = mount(FolderPicker, { props: { docId }, attachTo: document.body })
  await flush(w)
  const input = document.querySelector('.fp-search input') as HTMLInputElement
  input.value = 'Devel'
  input.dispatchEvent(new Event('input'))
  await flush(w)
  const names = Array.from(document.querySelectorAll('.fp-item .nm')).map((el) => el.textContent)
  expect(names).toContain('Devel')
  // ancestors of the match are shown so the result is navigable
  expect(names).toContain('Other bookmarks')
  w.unmount()
})
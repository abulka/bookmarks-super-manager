import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import type { BmNode } from '../src/types'
import SearchView from '../src/components/views/SearchView.vue'

const sleep = (n: number) => new Promise((r) => setTimeout(r, n))
let docId = ''

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: f, children: [] }
  const bar: BmNode = { id: 'bar', type: 'folder', name: 'Bookmarks bar', addDate: f, children: [] }
  const devel: BmNode = { id: 'devel', type: 'folder', name: 'Devel', addDate: f, children: [] }
  const projects: BmNode = { id: 'projects', type: 'folder', name: 'Projects', addDate: f, children: [] }
  const jammer: BmNode = { id: 'jammer', type: 'folder', name: 'Chord Jammer', addDate: f, children: [] }
  const webmidi: BmNode = { id: 'webmidi', type: 'folder', name: '0. webmidijs - defines Note as new Note()', addDate: f, children: [] }
  webmidi.children.push({ id: 'note', type: 'link', name: 'Note | WEBMIDI.js', url: 'https://webmidijs.org/api/classes/Note', addDate: f, children: [] })
  jammer.children.push(
    webmidi,
    { id: 'gh', type: 'link', name: 'abulka/webmidijs-play', url: 'https://github.com/abulka/webmidijs-play', addDate: f, children: [] }
  )
  projects.children.push(jammer)
  devel.children.push(projects)
  bar.children.push(devel)
  root.children.push(bar)

  const id = 'docsearch'
  docs.docs.push({ id, fileName: 's.html', title: 's', importedAt: Date.now(), root, view: 'search', currentFolderId: 'bar', collapsed: {}, selected: [], searchQuery: '' })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
})

afterAll(() => useDocs().dispose())

describe('SearchView', () => {
  it('finds folders by name — a folder-only query no longer misses the folder', async () => {
    const docs = useDocs()
    const doc = docs.byId(docId)!
    doc.searchQuery = '0. webmidijs'
    docs.bump()

    const w = mount(SearchView, { props: { docId }, attachTo: document.body })
    await w.vm.$nextTick()

    const rows = w.findAll('.search-row')
    expect(rows.length).toBe(1)
    // the hit is the folder itself, shown with the folder icon
    expect(rows[0].find('.sr-folder').exists()).toBe(true)
    expect(rows[0].find('.sr-name').text()).toContain('0. webmidijs')
    w.unmount()
  })

  it('returns links plus the matching folder when the term hits both', async () => {
    const docs = useDocs()
    const doc = docs.byId(docId)!
    doc.searchQuery = 'webmidijs'
    docs.bump()

    const w = mount(SearchView, { props: { docId }, attachTo: document.body })
    await w.vm.$nextTick()

    const rows = w.findAll('.search-row')
    // folder hit + the link it contains + the webmidijs-play link
    expect(rows.length).toBe(3)
    const types = rows.map((r) => (r.find('.sr-folder').exists() ? 'folder' : 'link'))
    expect(types).toContain('folder')
    expect(w.find('.sb-count').text()).toBe('3 results')
    w.unmount()
  })

  it('matches top-level chrome folders too', async () => {
    const docs = useDocs()
    const doc = docs.byId(docId)!
    doc.searchQuery = 'Bookmarks bar'
    docs.bump()

    const w = mount(SearchView, { props: { docId }, attachTo: document.body })
    await w.vm.$nextTick()

    const rows = w.findAll('.search-row')
    expect(rows.length).toBe(1)
    expect(rows[0].find('.sr-folder').exists()).toBe(true)
    expect(rows[0].text()).toContain('Bookmarks bar')
    w.unmount()
  })

  it('double-clicking a result reveals it in the manager tree', async () => {
    const docs = useDocs()
    const doc = docs.byId(docId)!
    doc.searchQuery = '0. webmidijs'
    docs.bump()

    const w = mount(SearchView, { props: { docId }, attachTo: document.body })
    await w.vm.$nextTick()
    await w.find('.search-row').trigger('dblclick')
    await sleep(10)

    expect(doc.view).toBe('manager')
    expect(doc.currentFolderId).toBe('jammer')
    expect(doc.selected).toEqual(['webmidi'])
    // ancestors between the root and the folder are expanded for the reveal
    expect(doc.collapsed['devel']).toBe(false)
    expect(doc.collapsed['projects']).toBe(false)
    expect(doc.collapsed['jammer']).toBe(false)
    w.unmount()
  })
})
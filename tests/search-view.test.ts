import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import type { BmNode } from '../src/types'
import SearchView from '../src/components/views/SearchView.vue'
import { tokenizeQuery, tokenMatches, matchQuery } from '../src/lib/search'
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

describe('smart search', () => {
  const mkDoc = (): string => {
    const docs = useDocs()
    const f = Math.floor(Date.now() / 1000)
    const root: BmNode = { id: 'r2', type: 'folder', name: '(root)', addDate: f, children: [] }
    root.children.push(
      { id: 'pi', type: 'folder', name: 'Pi stuff', addDate: f, children: [] },
      { id: 'hid', type: 'folder', name: 'Happily tools', addDate: f, children: [] },
      { id: 'cam', type: 'link', name: 'Pi Camera — codesandbox', url: 'https://example.com/codesandbox/pi', addDate: f, children: [] },
      { id: 'rasp', type: 'link', name: 'Raspberry Notes', url: 'https://example.com/bitcode/raspberry-pi', addDate: f, children: [] }
    )
    const id = 'smart' + f
    docs.docs.push({ id, fileName: 'x.html', title: 'x', importedAt: Date.now(), root, view: 'search', currentFolderId: 'r2', collapsed: {}, selected: [], searchQuery: '' })
    docs.tabs.push(id)
    docs.activeDocId = id
    return id
  }

  it('unit: substring by default, whole word when quoted', () => {
    expect(tokenizeQuery('pi code')).toEqual([{ text: 'pi', whole: false }, { text: 'code', whole: false }])
    expect(tokenizeQuery('  Pi\tCODE  ')).toEqual([{ text: 'pi', whole: false }, { text: 'code', whole: false }])
    expect(tokenizeQuery('"pi" code')).toEqual([{ text: 'pi', whole: true }, { text: 'code', whole: false }])
    // unquoted matches a substring anywhere, including mid-word
    expect(tokenMatches({ text: 'pi', whole: false }, 'Happily tools')).toBe(true)
    // quoted matches an exact whole word only
    expect(tokenMatches({ text: 'pi', whole: true }, 'Pi stuff')).toBe(true)
    expect(tokenMatches({ text: 'pi', whole: true }, 'pi-code')).toBe(true)
    expect(tokenMatches({ text: 'pi', whole: true }, 'My pi.')).toBe(true)
    expect(tokenMatches({ text: 'pi', whole: true }, 'pinterest')).toBe(false)
    expect(tokenMatches({ text: 'pi', whole: true }, 'pick list')).toBe(false)
    expect(tokenMatches({ text: 'pi', whole: true }, 'pixels')).toBe(false)
    expect(tokenMatches({ text: 'pi', whole: true }, 'Happily tools')).toBe(false)
  })

  it('plain "pi" matches substrings (mid-word included)', async () => {
    const docs = useDocs()
    const id = mkDoc()
    docs.byId(id)!.searchQuery = 'pi'
    docs.bump()
    const w = mount(SearchView, { props: { docId: id }, attachTo: document.body })
    await w.vm.$nextTick()

    const names = w.findAll('.search-row').map((r) => r.find('.sr-name').text())
    expect(names).toContain('Pi stuff')
    expect(names).toContain('Happily tools') // "pi" is mid-word in "Happily"
    expect(names).toContain('Pi Camera — codesandbox')
    expect(names).toContain('Raspberry Notes') // via its url ".../raspberry-pi"
    w.unmount()
  })

  it('quoted "pi" restricts to whole words', async () => {
    const docs = useDocs()
    const id = mkDoc()
    docs.byId(id)!.searchQuery = '"pi"'
    docs.bump()
    const w = mount(SearchView, { props: { docId: id }, attachTo: document.body })
    await w.vm.$nextTick()

    const names = w.findAll('.search-row').map((r) => r.find('.sr-name').text())
    expect(names).toContain('Pi stuff')
    expect(names).toContain('Pi Camera — codesandbox')
    expect(names).toContain('Raspberry Notes') // whole word at the end of the url "…/pi"
    expect(names).not.toContain('Happily tools') // only mid-word "pi"

    // the whole-word "pi" is what gets highlighted, not an offset fragment
    const piStuffRow = w.findAll('.search-row').find((r) => r.find('.sr-name').text() === 'Pi stuff')!
    expect(piStuffRow.find('.sr-name mark').text()).toBe('Pi')
    w.unmount()
  })

  it('"pi code" requires both terms (each matched as a substring)', async () => {
    const docs = useDocs()
    const id = mkDoc()
    docs.byId(id)!.searchQuery = 'pi code'
    docs.bump()
    const w = mount(SearchView, { props: { docId: id }, attachTo: document.body })
    await w.vm.$nextTick()

    const names = w.findAll('.search-row').map((r) => r.find('.sr-name').text())
    expect(names).toContain('Pi Camera — codesandbox') // name has "pi" + "code"
    expect(names).toContain('Raspberry Notes') // url has "pi" (raspberry-pi) + "code" (bitcode)
    expect(names).not.toContain('Pi stuff') // no "code"
    expect(names).not.toContain('Happily tools') // no "code"
    w.unmount()
  })

  it('unit: every whitespace token must match at least one field, in any field', () => {
    const tokens = tokenizeQuery('pi code')
    expect(matchQuery(tokens, 'Pi Camera', 'https://x/code/')).toBe(true) // pi in name, code in url
    expect(matchQuery(tokens, 'Pi Camera')).toBe(false) // only pi
    expect(matchQuery(tokens, '', 'https://example.com/code/pi')).toBe(true) // both in url
  })
})
import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { isPrivateHost } from '../src/lib/url'
import type { BmNode } from '../src/types'
import DuplicatesView from '../src/components/views/DuplicatesView.vue'

const sleep = (n: number) => new Promise((r) => setTimeout(r, n))
let docId = ''

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: f, children: [] }
  const f1: BmNode = { id: 'f1', type: 'folder', name: 'F1', addDate: f, children: [] }
  const f2: BmNode = { id: 'f2', type: 'folder', name: 'F2', addDate: f, children: [] }
  const f3: BmNode = { id: 'f3', type: 'folder', name: 'F3', addDate: f, children: [] }
  // private-host duplicates (dev.local) + public-host duplicates (github.com)
  f1.children.push({ id: 'a', type: 'link', name: 'A', url: 'http://dev.local:8080/x', addDate: f, children: [] })
  f2.children.push({ id: 'b', type: 'link', name: 'B', url: 'http://dev.local:8080/x', addDate: f, children: [] })
  f3.children.push(
    { id: 'c', type: 'link', name: 'C', url: 'https://github.com/foo', addDate: f, children: [] },
    { id: 'd', type: 'link', name: 'D', url: 'https://github.com/foo', addDate: f, children: [] },
    { id: 'e', type: 'link', name: 'E', url: 'https://example.com/unique', addDate: f, children: [] }
  )
  root.children.push(f1, f2, f3)
  const id = 'docdup'
  docs.docs.push({ id, fileName: 'd.html', title: 'd', importedAt: Date.now(), root, view: 'duplicates', currentFolderId: 'root', collapsed: {}, selected: [], searchQuery: '' })
  docs.tabs.push(id)
  docs.activeDocId = id
  docId = id
})

afterAll(() => useDocs().dispose())

describe('private-host detection', () => {
  it('classifies local/private hosts', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('192.168.0.41')).toBe(true)
    expect(isPrivateHost('10.1.2.3')).toBe(true)
    expect(isPrivateHost('172.20.0.1')).toBe(true)
    expect(isPrivateHost('shed.local')).toBe(true)
    expect(isPrivateHost('plantuml.dokku.nas')).toBe(true)
    expect(isPrivateHost('nas')).toBe(true)
    expect(isPrivateHost('github.com')).toBe(false)
    expect(isPrivateHost('www.hpmuseum.org')).toBe(false)
  })
})

describe('Duplicate view host grouping', () => {
  it('shows duplicate groups under each host, expandable to member rows', async () => {
    const w = mount(DuplicatesView, { props: { docId }, attachTo: document.body })
    await w.vm.$nextTick()

    // two hosts with duplicates: dev.local and github.com
    const headers = w.findAll('.host-header')
    expect(headers.length).toBe(2)
    const names = headers.map((h) => h.find('.hh-name').text())
    expect(names).toEqual(['dev.local', 'github.com'])
    expect(w.find('.hh-count').text()).toContain('1 groups')

    // host sections are expanded by default, so both hosts' duplicate groups show
    expect(w.findAll('.host-body .dup-group').length).toBe(2)

    // collapse the first host → only the other host's group remains
    headers[0].trigger('click')
    await w.vm.$nextTick()
    await sleep(10)
    expect(w.findAll('.host-body .dup-group').length).toBe(1)

    // expand it again → both groups return
    headers[0].trigger('click')
    await w.vm.$nextTick()
    await sleep(10)
    expect(w.findAll('.host-body .dup-group').length).toBe(2)

    // expand the URL group inside the host → 2 member rows
    w.find('.host-body .dup-group').find('.dup-header').trigger('click')
    await w.vm.$nextTick()
    await sleep(10)
    expect(w.findAll('.dup-row').length).toBe(2)

    // dh-count reflects filtered total
    expect(w.find('.dh-count').text()).toContain('2 extra copies in 2 groups')
    w.unmount()
  }, 20000)

  it('Hide local/dev hosts removes private-host sections', async () => {
    const w = mount(DuplicatesView, { props: { docId }, attachTo: document.body })
    await w.vm.$nextTick()
    const input = w
      .findAll('.toggle')
      .find((t) => t.text().includes('Hide local/dev hosts'))!
      .find('input')
    await input.setValue(true)

    const names = w.findAll('.host-header').map((h) => h.find('.hh-name').text())
    expect(names).toEqual(['github.com'])
    w.unmount()
  }, 20000)
})
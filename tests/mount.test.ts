import { describe, expect, it, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { usePrefs } from '../src/state/prefs'
import HomeView from '../src/components/views/HomeView.vue'
import ManagerView from '../src/components/views/ManagerView.vue'

/** UI smoke test on top of the real 2.4 MB reorganized export.
 *  Mounts the light views (home + manager) rather than the full application
 *  chrome — mounting the entire App (tabs, toolbar, bookmarks bar, status bar,
 *  teleports) in one happy-dom process is intermittently slow/flaky. */
describe('UI smoke test', () => {
  afterAll(() => useDocs().dispose())

  const openReorg = (docs: ReturnType<typeof useDocs>) => {
    const html = readFileSync('public/samples/bookmarks_reorg.html', 'utf8')
    const id = docs.openFromText(html, 'bookmarks_reorg.html')
    expect(id.length).toBeGreaterThan(0)
    return docs.byId(id)!
  }

  it('home view renders tiles, recent bookmarks and stats from a real export', async () => {
    const { vi } = await import('vitest')
    // keep App-style fetches (sample index) from touching the network
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 } as Response))
    setActivePinia(createPinia())
    usePrefs().setTheme('dark')
    const docs = useDocs()
    await docs.init()
    const doc = openReorg(docs)
    expect(doc.root.children.length).toBeGreaterThan(1)

    const w = mount(HomeView, { props: { docId: doc.id }, attachTo: document.body })
    await w.vm.$nextTick()
    expect(w.find('.home').exists()).toBe(true)
    expect(w.findAll('.home-card').length).toBeGreaterThan(0)
    expect(w.find('.home-hero .sub').text()).toContain('bookmarks')
    w.unmount()
    vi.unstubAllGlobals()
  }, 20000)

  it('manager view renders the tree sidebar and content list', async () => {
    setActivePinia(createPinia())
    usePrefs().setTheme('dark')
    const docs = useDocs()
    await docs.init()
    const doc = openReorg(docs)
    docs.setView(doc.id, 'manager')
    docs.setCurrentFolder(doc.id, doc.root.children[0].id)

    const w = mount(ManagerView, { props: { docId: doc.id }, attachTo: document.body })
    await w.vm.$nextTick()
    expect(w.findAll('.tree-row').length).toBeGreaterThan(0)
    expect(w.find('.content-list').exists()).toBe(true)
    w.unmount()
  }, 20000)

  it('checker store drives a worker end-to-end', async () => {
    setActivePinia(createPinia())
    const docs = useDocs()
    await docs.init()
    const id = docs.newBlankDoc()
    let captured: { urls: string[] } | null = null
    ;(globalThis as any).Worker = class {
      onmessage: ((e: unknown) => void) | null = null
      postMessage(msg: { type: string; urls?: string[]; runId: string }): void {
        if (msg.type === 'run') {
          captured = { urls: msg.urls ?? [] }
          const runId = msg.runId
          const urls = msg.urls ?? []
          Promise.resolve().then(() =>
            this.onmessage?.({ data: { runId, done: urls.length, total: urls.length, results: [], finished: true } })
          )
        }
      }
      terminate(): void {}
    }
    const { useChecker } = await import('../src/state/checker')
    const checker = useChecker()
    checker.start(id, [{ id: 'x1', url: 'https://example.com/' }], false)
    expect(captured?.urls).toEqual(['https://example.com/'])
    await new Promise((r) => setTimeout(r, 20))
    expect(checker.phase).toBe('finished')
    checker.reset()
  }, 20000)
})
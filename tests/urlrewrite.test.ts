import { expect, it } from 'vitest'
import { rewriteUrl } from '../src/lib/urlrewrite'
import { useDocs } from '../src/state/docs'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import type { BmNode } from '../src/types'

setActivePinia(createPinia())

it('rewriteUrl maps legacy dpreview forum thread URLs to the current path', () => {
  expect(rewriteUrl('https://legacy.dpreview.com/forums/thread/2579414?page=3')).toBe(
    'https://www.dpreview.com/forums/threads/thread.2579414/page-3?page=3',
  )
  expect(rewriteUrl('http://legacy.dpreview.com/forums/thread/2579414')).toBe(
    'https://www.dpreview.com/forums/threads/thread.2579414/page-1?page=1',
  )
})

it('rewriteUrl returns null for non-legacy URLs', () => {
  expect(rewriteUrl('https://www.dpreview.com/forums/thread/2579414')).toBeNull()
  expect(rewriteUrl('https://example.com/foo')).toBeNull()
})

it('docs.rewriteLinks rewrites matching dead links and revives them', () => {
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const root: BmNode = {
    id: 'root',
    type: 'folder',
    name: '(root)',
    addDate: f,
    children: [
      { id: 'a', type: 'link', name: 'Old dpreview', url: 'https://legacy.dpreview.com/forums/thread/2579414?page=3', addDate: f, dead: true, children: [] },
      { id: 'b', type: 'link', name: 'Normal', url: 'https://example.com/', addDate: f, dead: true, children: [] },
    ],
  }
  const id = 'rw1'
  docs.docs.push({ id, fileName: 'd.html', title: 'd', importedAt: Date.now(), root, view: 'manager', currentFolderId: 'root', collapsed: {}, selected: [], searchQuery: '' })
  docs.tabs.push(id)
  docs.activeDocId = id

  const n = docs.rewriteLinks(id)
  expect(n).toBe(1)
  const d = docs.byId(id)!
  const a = d.root.children.find((c) => c.id === 'a')!
  expect(a.url).toBe('https://www.dpreview.com/forums/threads/thread.2579414/page-3?page=3')
  expect(a.dead).toBe(false)
  // non-matching dead link stays untouched
  expect(d.root.children.find((c) => c.id === 'b')!.url).toBe('https://example.com/')
  expect(d.root.children.find((c) => c.id === 'b')!.dead).toBe(true)
})

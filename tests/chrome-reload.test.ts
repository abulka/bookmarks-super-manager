// Reload-from-Chrome behaviour of the live doc: replaceChromeRoot() is what
// the toolbar Reload button (and the conflict toast's Reload action) invoke.
import { afterAll, beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useDocs } from '../src/state/docs'
import type { BmNode } from '../src/types'

let docId = ''

function folder(id: string, name: string, children: BmNode[] = []): BmNode {
  return { id, type: 'folder', name, children }
}
function link(id: string, name: string, url: string): BmNode {
  return { id, type: 'link', name, url, children: [] }
}

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  docId = docs.newBlankDoc()
  const doc = docs.byId(docId)!
  doc.ephemeral = true // act as the live Chrome doc
  doc.dirty = true
  // an edit that leaves an undo entry referencing the old tree
  const linkId = docs.mutCreateLink(docId, doc.root.children[0]!.id, 'Local edit', 'https://local')
  docs.mutRename(docId, linkId, 'renamed locally')
})

afterAll(() => useDocs().dispose())

it('replaceChromeRoot swaps the tree, clears dirty/undo/selection, and rebuilds collapsed state', () => {
  const docs = useDocs()
  const doc = docs.byId(docId)!
  const oldLinkId = doc.root.children[0]!.children[0]!.id
  doc.selected = [oldLinkId]
  doc.currentFolderId = oldLinkId // stale after reload

  const newRoot = folder('__root__', '(root)', [
    folder('1', 'Bookmarks bar', [link('10', 'Fresh A', 'https://a'), folder('20', 'Fresh folder', [])]),
    folder('2', 'Other bookmarks', []),
  ])
  docs.replaceChromeRoot(docId, newRoot)

  const reloaded = docs.byId(docId)!
  expect(reloaded.root.children.map((c) => c.id)).toEqual(['1', '2'])
  expect(reloaded.root.children[0]!.children.map((c) => c.name)).toEqual(['Fresh A', 'Fresh folder'])
  expect(reloaded.dirty).toBe(false)
  expect(reloaded.selected).toEqual([])
  // stale current folder is reset to the first top-level folder
  expect(reloaded.currentFolderId).toBe('1')
  // the undo entry pointed at the discarded tree — it must not survive
  expect(docs.undoOf(docId).canUndo).toBe(false)
  // collapsed map was rebuilt for the new tree, first folder expanded
  expect(reloaded.collapsed['1']).toBe(false)
  expect(reloaded.collapsed['20']).toBe(true)
})

it('replaceChromeRoot keeps the current folder when it still exists after reload', () => {
  const docs = useDocs()
  const doc = docs.byId(docId)!
  doc.currentFolderId = '20'
  const newRoot = folder('__root__', '(root)', [
    folder('1', 'Bookmarks bar', [link('11', 'B', 'https://b')]),
    folder('20', 'Fresh folder', []),
    folder('2', 'Other bookmarks', []),
  ])
  docs.replaceChromeRoot(docId, newRoot)
  expect(docs.byId(docId)!.currentFolderId).toBe('20')
})

it('replaceChromeRoot refuses to touch non-ephemeral documents', () => {
  const docs = useDocs()
  const fileDocId = docs.newBlankDoc()
  const before = JSON.stringify(docs.byId(fileDocId)!.root)
  docs.replaceChromeRoot(fileDocId, folder('__root__', '(root)', []))
  expect(JSON.stringify(docs.byId(fileDocId)!.root)).toBe(before)
})

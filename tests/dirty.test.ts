import { afterAll, beforeAll, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useDocs } from '../src/state/docs'
import { useClipboard } from '../src/state/clipboard'

let docId = ''
const HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3>Favs</H3>
  <DL><p>
    <DT><A HREF="https://a.example/">A</A>
  </DL><p>
</DL><p>`

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  docId = docs.openFromText(HTML, 'bookmarks.html')
  docs.activate(docId)
})

afterAll(() => useDocs().dispose())

it('an imported document starts clean (re-importable, nothing lost on close)', () => {
  expect(useDocs().byId(docId)!.dirty).toBe(false)
})

it('a blank document starts dirty (nothing exists on disk)', () => {
  const id = useDocs().newBlankDoc()
  expect(useDocs().byId(id)!.dirty).toBe(true)
})

it('a blank document has no "Other bookmarks" folder — the root is the catch-all', () => {
  const id = useDocs().newBlankDoc()
  const root = useDocs().byId(id)!.root
  expect(root.children.map((c) => c.name)).toEqual(['Bookmarks bar'])
  expect(useDocs().byId(id)!.currentFolderId).toBe(root.children[0].id)
})

it('content mutations mark the document dirty', () => {
  const docs = useDocs()
  const d = docs.byId(docId)!
  const link = d.root.children[0].children[0]
  docs.mutRename(docId, link.id, 'Renamed')
  expect(docs.byId(docId)!.dirty).toBe(true)
  docs.markExported(docId)
  expect(docs.byId(docId)!.dirty).toBe(false)
})

it('collapse/expand toggles do not mark the document dirty', () => {
  const docs = useDocs()
  const d = docs.byId(docId)!
  d.dirty = false
  docs.collapseAll(docId)
  docs.expandAll(docId)
  expect(docs.byId(docId)!.dirty).toBe(false)
})

it('a cut via the clipboard dirties both involved documents', () => {
  const docs = useDocs()
  const d = docs.byId(docId)!
  d.dirty = false
  const targetId = docs.newBlankDoc()
  const clip = useClipboard()
  const tgtRoot = docs.byId(targetId)!.root.id
  const link = d.root.children[0].children[0]
  clip.capture(docId, [link.id], d.root.children[0].id, 'cut')
  expect(clip.pasteInto(targetId, tgtRoot, null)).toBe(1)
  expect(docs.byId(docId)!.dirty).toBe(true)
  expect(docs.byId(targetId)!.dirty).toBe(true)
})
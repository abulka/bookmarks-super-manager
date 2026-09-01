import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useClipboard } from '../src/state/clipboard'
import { useDocs } from '../src/state/docs'
import { findNode } from '../src/lib/tree'
import type { BmNode } from '../src/types'

let docId = ''
let doc2Id = ''
const t = Math.floor(Date.now() / 1000)
const mk = (name: string, id: string, kids: BmNode[] = []): BmNode => ({ id, type: 'folder', name, addDate: t, children: kids })
const mkL = (name: string, id: string): BmNode => ({ id, type: 'link', name, url: `https://${id}.example/`, addDate: t, children: [] })

function seed(): void {
  const docs = useDocs()
  const root: BmNode = { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [] }
  root.children.push(mk('F1', 'f1', [mkL('A', 'a'), mkL('B', 'b'), mkL('C', 'c')]))
  root.children.push(mk('F2', 'f2', []))
  const doc = docs.byId(docId)!
  doc.root = root
  doc.currentFolderId = 'f1'
  doc.collapsed = {}
  doc.selected = []

  const root2: BmNode = { id: 'root2', type: 'folder', name: '(root)', addDate: t, children: [] }
  root2.children.push(mk('Archive', 'arch', [{ id: 'x', type: 'link', name: 'X', url: 'https://x.example/', addDate: t, children: [] }]))
  const doc2 = docs.byId(doc2Id)!
  doc2.root = root2
  doc2.currentFolderId = 'arch'
  doc2.collapsed = {}
  doc2.selected = []
}

beforeAll(() => {
  setActivePinia(createPinia())
  const docs = useDocs()
  const mkDoc = (id: string, name: string) => ({
    id,
    fileName: name,
    title: name,
    importedAt: Date.now(),
    root: { id: 'root', type: 'folder', name: '(root)', addDate: t, children: [] },
    view: 'manager',
    currentFolderId: '',
    collapsed: {},
    selected: [] as string[],
    treeSel: [] as string[],
    searchQuery: '',
    revealRev: 0,
    lastRevealAt: 0,
  })
  const doc1 = mkDoc('doc1', 'd.html')
  const doc2 = mkDoc('doc2', 'archive.html')
  docs.docs.push(doc1, doc2)
  docs.tabs.push(doc1.id, doc2.id)
  docs.activeDocId = doc1.id
  docId = doc1.id
  doc2Id = doc2.id
})

afterAll(() => useDocs().dispose())

beforeEach(() => {
  seed()
  useClipboard().clear()
  useDocs().undoOf(docId).clear()
  useDocs().undoOf(doc2Id).clear()
})

it('cut + same-doc paste moves the set and clears the clipboard', () => {
  const clip = useClipboard()
  const docs = useDocs()
  docs.byId(docId)!.selected = ['a', 'b']
  expect(clip.cutSelection(docId)).toBe(2)
  expect(clip.has).toBe(true)
  expect(clip.pasteInto(docId, 'f2', null)).toBe(2)
  expect(clip.has).toBe(false)
  expect(findNode(docs.byId(docId)!.root, 'f2')!.children.map((c) => c.id)).toEqual(['a', 'b'])
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['c'])
})

it('pasteCurrent inserts before the selected anchor row', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  clip.capture(docId, ['b'], f1.id, 'cut')
  docs.byId(docId)!.selected = ['c']
  expect(clip.pasteCurrent(docId)).toBe(1)
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['a', 'b', 'c'])
})

it('same-doc paste stays a single undo step', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  clip.capture(docId, ['a', 'b'], f1.id, 'cut')
  expect(clip.pasteInto(docId, 'f2', null)).toBe(2)
  const u = docs.undoOf(docId)
  expect(u.canUndo).toBe(true)
  u.undo()
  expect(findNode(docs.byId(docId)!.root, 'f2')!.children).toEqual([])
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  expect(u.canUndo).toBe(false)
})

it('cross-doc copy duplicates into the target and leaves the source intact', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  clip.capture(docId, ['a', 'b'], f1.id, 'copy')
  expect(clip.pasteInto(doc2Id, 'arch', null)).toBe(2)
  const arch = findNode(docs.byId(doc2Id)!.root, 'arch')!
  const inTarget = arch.children.filter((c) => c.name === 'A' || c.name === 'B')
  expect(inTarget.length).toBe(2)
  // fresh ids, no collision with the source
  expect(inTarget[0]!.id).not.toBe('a')
  expect(inTarget[1]!.id).not.toBe('b')
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  // undo in the target doc removes the clones only
  const u = docs.undoOf(doc2Id)
  u.undo()
  expect(findNode(docs.byId(doc2Id)!.root, 'arch')!.children.map((c) => c.id)).toEqual(['x'])
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['a', 'b', 'c'])
})

it('cross-doc cut moves the items and one undo restores both docs', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  clip.capture(docId, ['a', 'b'], f1.id, 'cut')
  expect(clip.pasteInto(doc2Id, 'arch', null)).toBe(2)
  const arch = findNode(docs.byId(doc2Id)!.root, 'arch')!
  const inTarget = arch.children.filter((c) => c.name === 'A' || c.name === 'B')
  expect(inTarget.length).toBe(2)
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['c'])
  docs.undoOf(doc2Id).undo()
  expect(findNode(docs.byId(doc2Id)!.root, 'arch')!.children.map((c) => c.id)).toEqual(['x'])
  expect(findNode(docs.byId(docId)!.root, 'f1')!.children.map((c) => c.id)).toEqual(['a', 'b', 'c'])
})

it('paste into a vanished source folder clears the clipboard', () => {
  const clip = useClipboard()
  clip.capture(docId, ['a'], 'ghost-parent', 'cut')
  expect(clip.pasteInto(docId, 'f1', null)).toBe(0)
  expect(clip.has).toBe(false)
})

it('paste only moves ids that still exist under the source parent', () => {
  const clip = useClipboard()
  const f1 = findNode(useDocs().byId(docId)!.root, 'f1')!
  clip.capture(docId, ['a', 'missing'], f1.id, 'cut')
  expect(clip.pasteInto(docId, 'f2', null)).toBe(1)
  expect(findNode(useDocs().byId(docId)!.root, 'f2')!.children.map((c) => c.id)).toEqual(['a'])
})

it('folder-mode: toolbar copy falls back to the viewed folder', () => {
  const clip = useClipboard()
  const docs = useDocs()
  // stale selection from f1 while viewing f2 → the folder itself is captured
  docs.byId(docId)!.selected = ['a', 'b']
  docs.byId(docId)!.currentFolderId = 'f2'
  expect(clip.copySelection(docId)).toBe(1)
  expect(clip.ids).toEqual(['f2'])
  expect(clip.srcParentId).toBe('root')
  expect(clip.summary).toBe('Folder “F2”')
  // paste duplicates the folder into another target
  docs.byId(docId)!.currentFolderId = 'f1'
  expect(clip.pasteCurrent(docId)).toBe(1)
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  const clone = f1.children.find((c) => c.name === 'F2')
  expect(clone).toBeTruthy()
  expect(clone!.id).not.toBe('f2')
})

it('folder-mode: cut moves the viewed folder', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const d = docs.byId(docId)!
  d.selected = []
  d.currentFolderId = 'f1'
  expect(clip.cutSelection(docId)).toBe(1)
  expect(clip.ids).toEqual(['f1'])
  expect(clip.pasteInto(docId, 'f2', null)).toBe(1)
  const f2 = findNode(d.root, 'f2')!
  expect(f2.children.map((c) => c.id)).toContain('f1')
  docs.undoOf(docId).undo()
  expect(d.root.children.map((c) => c.id)).toContain('f1')
  expect(f2.children.some((c) => c.id === 'f1')).toBe(false)
})

it('cannot duplicate a folder into its own subtree', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  f1.children.push({ id: 'sub', type: 'folder', name: 'Sub', addDate: t, children: [] })
  docs.byId(docId)!.selected = []
  docs.byId(docId)!.currentFolderId = 'f1'
  expect(clip.copySelection(docId)).toBe(1)
  expect(clip.pasteInto(docId, 'sub', null)).toBe(0)
  const sub = f1.children.find((c) => c.id === 'sub')!
  expect(sub.children.length).toBe(0)
  expect(clip.has).toBe(true) // clipboard survives the refusal
})

it('toolbar style copy then paste across folders works', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const d = docs.byId(docId)!
  d.currentFolderId = 'f1'
  d.selected = ['a', 'b']
  expect(clip.copySelection(docId)).toBe(2)
  d.currentFolderId = 'f2'
  expect(clip.pasteCurrent(docId)).toBe(2)
  expect(findNode(docs.byId(docId)!.root, 'f2')!.children.map((c) => c.name)).toEqual(['A', 'B'])
})

it('sourcePath names the folder the cut came from', () => {
  const clip = useClipboard()
  const f1 = findNode(useDocs().byId(docId)!.root, 'f1')!
  expect(clip.sourcePath).toBe('')
  clip.capture(docId, ['a'], f1.id, 'cut')
  expect(clip.sourcePath).toBe('F1')
})

it('same-doc copy duplicates in place with fresh ids', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const f1 = findNode(docs.byId(docId)!.root, 'f1')!
  clip.capture(docId, ['a'], f1.id, 'copy')
  expect(clip.pasteInto(docId, 'f1', null)).toBe(1)
  expect(f1.children.length).toBe(4)
  const kids = f1.children.map((c) => c.id)
  expect(kids.filter((id) => id === 'a').length).toBe(1)
  expect(new Set(kids).size).toBe(4) // clone has a fresh unique id
  expect(f1.children[3].name).toBe('A')
})

// ---------------- grouped (multi-parent tree transfers) ----------------

it('grouped capture: same-doc cut across parents stays one undo step', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const d = docs.byId(docId)!
  const f2 = findNode(d.root, 'f2')!
  const g1 = mk('G1', 'g1')
  f2.children.push(g1)
  clip.captureGroups(docId, [{ parentId: 'root', ids: ['f1'] }, { parentId: 'f2', ids: ['g1'] }], 'cut')
  expect(clip.ids).toEqual(['f1', 'g1'])
  expect(clip.srcParentId).toBe('root')
  expect(clip.sourcePath).toBe('(root) (+1 more)')
  expect(clip.pasteInto(docId, 'root', null)).toBe(2)
  expect(d.root.children.map((c) => c.id)).toContain('f1')
  expect(d.root.children.map((c) => c.id)).toContain('g1')
  expect(f2.children.map((c) => c.id)).toEqual([])
  expect(clip.has).toBe(false)
  const u = docs.undoOf(docId)
  u.undo()
  expect(f2.children.map((c) => c.id)).toEqual(['g1'])
  expect(u.canUndo).toBe(false)
})

it('grouped capture: cross-doc copy duplicates spanning parents', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const d = docs.byId(docId)!
  const f2 = findNode(d.root, 'f2')!
  f2.children.push(mk('G1', 'g1'))
  clip.captureGroups(docId, [{ parentId: 'root', ids: ['f2'] }, { parentId: 'f1', ids: ['a', 'b'] }], 'copy')
  expect(clip.pasteInto(doc2Id, 'arch', null)).toBe(3)
  const arch = findNode(docs.byId(doc2Id)!.root, 'arch')!
  expect(arch.children.length).toBe(4) // original X + 3 clones
  expect(clip.has).toBe(false)
  // source untouched
  const f1 = findNode(d.root, 'f1')!
  expect(f1.children.map((c) => c.id)).toEqual(['a', 'b', 'c'])
})

it('grouped capture: vanished groups are filtered out, not fatal', () => {
  const clip = useClipboard()
  const docs = useDocs()
  clip.captureGroups(docId, [{ parentId: 'root', ids: ['f1'] }, { parentId: 'ghost', ids: ['x'] }], 'cut')
  expect(clip.pasteInto(docId, 'f2', null)).toBe(1)
  const f2 = findNode(docs.byId(docId)!.root, 'f2')!
  expect(f2.children.map((c) => c.id)).toEqual(['f1'])
  expect(clip.has).toBe(false)
})

it('cut refuses a target inside the cut subtree and keeps the clipboard', () => {
  const clip = useClipboard()
  const docs = useDocs()
  const d = docs.byId(docId)!
  const f1 = findNode(d.root, 'f1')!
  const sub = mk('Sub', 'sub')
  f1.children.push(sub)
  clip.capture(docId, ['f1'], 'root', 'cut')
  expect(clip.pasteInto(docId, 'sub', null)).toBe(0)
  expect(sub.children).toEqual([])
  expect(clip.has).toBe(true)
})
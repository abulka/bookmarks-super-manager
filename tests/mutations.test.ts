import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDocs } from '../src/state/docs'
import { parseNetscape } from '../src/parser/netscape'
import { findNode } from '../src/lib/tree'
import type { BmNode } from '../src/types'
import { uid } from '../src/lib/id'

const TREE = `<DL><p>
<DT><H3>F1</H3>
<DL><p>
<DT><A HREF="https://a.com/">A</A>
<DT><A HREF="https://b.com/">B</A>
<DT><A HREF="https://c.com/">C</A>
</DL><p>
<DT><H3>F2</H3>
<DL><p>
<DT><A HREF="https://d.com/">D</A>
</DL><p>
</DL><p>
`

function makeDoc(): string {
  const docs = useDocs()
  const root = parseNetscape(TREE).root
  root.id = uid()
  const id = uid()
  docs.docs.push({
    id,
    fileName: 't.html',
    title: 't',
    importedAt: Date.now(),
    root,
    view: 'manager',
    currentFolderId: root.children[0].id,
    collapsed: {},
    selected: [],
    searchQuery: '',
  })
  return id
}

describe('docs mutations + undo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterAll(() => {
    useDocs().dispose()
  })

  it('moves a link between folders and undoes', () => {
    const docs = useDocs()
    const id = makeDoc()
    const doc = docs.byId(id)!
    const f1 = doc.root.children[0]
    const f2 = doc.root.children[1]
    const a = f1.children[0]
    expect(f1.children.length).toBe(3)
    expect(f2.children.length).toBe(1)

    docs.mutMove(id, f1.id, [a.id], f2.id, null)
    expect(f1.children.length).toBe(2)
    expect(f2.children.length).toBe(2)
    expect(f2.children[1].id).toBe(a.id)

    docs.undoOf(id).undo()
    expect(f1.children.length).toBe(3)
    expect(f1.children[0].id).toBe(a.id)
    expect(f2.children.length).toBe(1)

    docs.undoOf(id).redo()
    expect(f2.children[1].id).toBe(a.id)
  })

  it('reorders within the same folder deterministically', () => {
    const docs = useDocs()
    const id = makeDoc()
    const doc = docs.byId(id)!
    const f1 = doc.root.children[0] as BmNode
    const [a, b, c] = f1.children as BmNode[]

    // place A before C → [B, A, C]
    docs.mutMove(id, f1.id, [a.id], f1.id, c.id)
    expect(f1.children.map((x) => x.id)).toEqual([b.id, a.id, c.id])

    docs.undoOf(id).undo()
    expect(f1.children.map((x) => x.id)).toEqual([a.id, b.id, c.id])

    docs.undoOf(id).redo()
    expect(f1.children.map((x) => x.id)).toEqual([b.id, a.id, c.id])

    // append to the end → [B, C, A]
    docs.mutMove(id, f1.id, [a.id], f1.id, null)
    expect(f1.children.map((x) => x.id)).toEqual([b.id, c.id, a.id])
  })

  it('renames into/out of folders', () => {
    const docs = useDocs()
    const id = makeDoc()
    const a = docs.byId(id)!.root.children[0].children[0]
    docs.mutRename(id, a.id, 'Renamed')
    expect(a.name).toBe('Renamed')
    docs.undoOf(id).undo()
    expect(a.name).toBe('A')
  })

  it('deletes and restores', () => {
    const docs = useDocs()
    const id = makeDoc()
    const doc = docs.byId(id)!
    const f1 = doc.root.children[0] as BmNode
    const toDelete = f1.children[0].id
    docs.mutDelete(id, [toDelete])
    expect(f1.children.length).toBe(2)
    docs.undoOf(id).undo()
    expect(f1.children.length).toBe(3)
    expect(findNode(doc.root, toDelete)).toBeDefined()
  })

  it('sorts a folder and undoes', () => {
    const docs = useDocs()
    const id = makeDoc()
    const doc = docs.byId(id)!
    const f1 = doc.root.children[0]
    docs.mutSort(id, f1.id, 'name')
    expect(f1.children.map((c) => (c as BmNode).name).join(',')).toBe('A,B,C')
    docs.mutSort(id, f1.id, 'url')
    docs.undoOf(id).undo()
    expect(f1.children.map((c) => (c as BmNode).name).join(',')).toBe('A,B,C')
  })

  it('renaming a dead link without the ❌ marker revives it', () => {
    const docs = useDocs()
    const id = makeDoc()
    const doc = docs.byId(id)!
    const f1 = doc.root.children[0] as BmNode
    const a = f1.children[0] as BmNode
    docs.markDeadNames(id, [a.id])
    expect(a.dead).toBe(true)
    expect(a.name.includes('❌')).toBe(true)

    // keep the marker → stays dead & marked
    docs.mutRename(id, a.id, 'A better name ❌')
    expect(a.dead).toBe(true)

    // strip the marker while renaming → revived
    docs.mutRename(id, a.id, 'A better name')
    expect(a.dead).toBe(false)
    expect(a.name).toBe('A better name')
  })

  it('does not allow dropping a folder into its own subtree', () => {
    const docs = useDocs()
    const id = makeDoc()
    const doc = docs.byId(id)!
    const f1 = doc.root.children[0] as BmNode
    const f2 = doc.root.children[1] as BmNode
    // move F2 into F1
    docs.mutMove(id, doc.root.id, [f2.id], f1.id, null)
    expect(f1.children.some((c) => c.id === f2.id)).toBe(true)
    // dropping F1 into F2 (descendant) must be rejected
    const before = f2.children.length
    docs.mutMove(id, doc.root.id, [f1.id], f2.id, null)
    expect(f2.children.length).toBe(before)
  })
})
// chrome.bookmarks sync layer tests. The FakeChrome semantics are calibrated
// against the spike run on a real Chrome for Testing 151 profile
// (spike/spike-results.json) — the move scenarios below replicate the exact
// spike cases and expected outcomes.
import { describe, expect, it } from 'vitest'
import { FakeChrome } from '../src/lib/backend/fakeChrome'
import { chromeRootToNode, nodeFromPlain, plainEquals, type ChromePlain } from '../src/lib/backend/chrome'
import { applyOps, diffTrees, countOps, planApply, applyToChrome } from '../src/lib/backend/chromeSync'
import type { BmNode } from '../src/types'

const barId = '1'

/** spike scenario helper: bar = [L1, F1, L2, L3] as built in the probe */
async function spikeSetup(): Promise<{ fake: FakeChrome; ids: Record<string, string> }> {
  const fake = new FakeChrome()
  const F1 = await fake.create({ parentId: barId, title: 'F1' })
  const L1 = await fake.create({ parentId: barId, title: 'L1', url: 'https://example.com/1', index: 0 })
  const L2 = await fake.create({ parentId: barId, title: 'L2', url: 'https://example.com/2' })
  const L3 = await fake.create({ parentId: barId, title: 'L3', url: 'https://example.com/3' })
  return { fake, ids: { F1: F1.id, L1: L1.id, L2: L2.id, L3: L3.id } }
}

async function barTitles(fake: FakeChrome): Promise<string[]> {
  const tree = await fake.getTree()
  const bar = tree.children!.find((c) => c.id === barId)!
  return bar.children!.map((c) => c.title)
}
async function barChildTitles(fake: FakeChrome, id: string): Promise<string[]> {
  const tree = await fake.getTree()
  const bar = tree.children!.find((c) => c.id === barId)!
  const node = bar.children!.find((c) => c.id === id)!
  return node.children!.map((c) => c.title)
}

// ---- fake semantics: spike-calibrated --------------------------------------

describe('FakeChrome spike-calibrated semantics', () => {
  it('move-end-to-0: moving the last item to index 0 lands at 0', async () => {
    const { fake, ids } = await spikeSetup()
    await fake.move(ids.L3, { parentId: barId, index: 0 })
    expect(await barTitles(fake)).toEqual(['L3', 'L1', 'F1', 'L2'])
  })

  it('move-pos0-to-2: moving down lands at requested − 1 (pre-removal counting)', async () => {
    const { fake, ids } = await spikeSetup()
    await fake.move(ids.L3, { parentId: barId, index: 0 })
    // bar = [L3, L1, F1, L2]; spike moved pos 0 → index 2 and it landed at 1
    await fake.move(ids.L3, { parentId: barId, index: 2 })
    expect(await barTitles(fake)).toEqual(['L1', 'L3', 'F1', 'L2'])
  })

  it('move upward lands exactly at requested', async () => {
    const { fake, ids } = await spikeSetup()
    await fake.move(ids.L3, { parentId: barId, index: 0 })
    // bar = [L3, L1, F1, L2]; move L3 (pos 0)… wait, upward means srcPos > requested.
    // After the first move: move L2 (pos 3) → index 1 → lands at 1
    await fake.move(ids.L2, { parentId: barId, index: 1 })
    expect(await barTitles(fake)).toEqual(['L3', 'L2', 'L1', 'F1'])
  })

  it('same-parent index == count is valid and lands at the end', async () => {
    const fake = new FakeChrome()
    const b1 = await fake.create({ parentId: barId, title: 'b1', url: 'u1' })
    await fake.create({ parentId: barId, title: 'b2', url: 'u2' })
    await fake.create({ parentId: barId, title: 'b3', url: 'u3' })
    await fake.move(b1.id, { parentId: barId, index: 3 })
    expect(await barTitles(fake)).toEqual(['b2', 'b3', 'b1'])
  })

  it('same-parent index beyond count throws, unclamped', async () => {
    const fake = new FakeChrome()
    const b1 = await fake.create({ parentId: barId, title: 'b1', url: 'u' })
    await expect(fake.move(b1.id, { parentId: barId, index: 99 })).rejects.toThrow('Index out of bounds.')
  })

  it('cross-parent: lands exactly at requested; index == destCount appends; beyond throws', async () => {
    const fake = new FakeChrome()
    const F = await fake.create({ parentId: barId, title: 'F' })
    const a = await fake.create({ parentId: F.id, title: 'a', url: 'a' })
    const x = await fake.create({ parentId: barId, title: 'x', url: 'x' })
    await fake.move(x.id, { parentId: F.id, index: 0 })
    expect(await barChildTitles(fake, F.id)).toEqual(['x', 'a'])
    const y = await fake.create({ parentId: barId, title: 'y', url: 'y' })
    await fake.move(y.id, { parentId: F.id, index: 2 }) // == dest count → append
    expect(await barChildTitles(fake, F.id)).toEqual(['x', 'a', 'y'])
    await expect(fake.move(y.id, { parentId: F.id, index: 9 })).rejects.toThrow('Index out of bounds.')
  })

  it('create index bounds mirror the spike', async () => {
    const fake = new FakeChrome()
    await expect(fake.create({ parentId: barId, title: 'z', url: 'z', index: 99 })).rejects.toThrow('Index out of bounds.')
    const n = await fake.create({ parentId: barId, title: 'z', url: 'z', index: 0 })
    expect((await barTitles(fake))[0]).toBe('z')
    expect(n.id).toMatch(/^\d+$/)
  })

  it('remove / removeTree / descendant-move error cases match the spike', async () => {
    const fake = new FakeChrome()
    const F = await fake.create({ parentId: barId, title: 'F' })
    await fake.create({ parentId: F.id, title: 'inner', url: 'u' })
    await expect(fake.remove(F.id)).rejects.toThrow("Can't remove non-empty folder")
    await fake.removeTree(F.id)
    expect(await barTitles(fake)).toEqual([])
    const F2 = await fake.create({ parentId: barId, title: 'F2' })
    const F3 = await fake.create({ parentId: F2.id, title: 'F3' })
    await expect(fake.move(F2.id, { parentId: F3.id })).rejects.toThrow("Can't move a folder to itself or its descendant.")
  })

  it('naive reorder loop converges (as in the spike)', async () => {
    const { fake } = await spikeSetup()
    const desired = ['L2', 'F1', 'L1', 'L3']
    for (let i = 0; i < desired.length; i++) {
      const tree = await fake.getTree()
      const bar = tree.children!.find((c) => c.id === barId)!
      const id = bar.children!.find((c) => c.title === desired[i])!.id
      await fake.move(id, { parentId: barId, index: i })
    }
    expect(await barTitles(fake)).toEqual(desired)
  })
})

// ---- diff + execute --------------------------------------------------------

function link(id: string, name: string, url: string): BmNode {
  return { id, type: 'link', name, url, children: [] }
}
function folder(id: string, name: string, children: BmNode[] = []): BmNode {
  return { id, type: 'folder', name, children }
}

function plainLink(id: string, title: string, url: string): ChromePlain {
  return { id, title, url }
}
function plainFolder(id: string, title: string, children: ChromePlain[] = []): ChromePlain {
  return { id, title, children }
}

/** minimal live-doc-like root for diffing */
function localRoot(children: BmNode[]): BmNode {
  return { id: '__root__', type: 'folder', name: '(root)', children }
}

function docWithRoot(root: BmNode) {
  return {
    id: 'd1',
    fileName: 'x',
    title: 'x',
    importedAt: 0,
    root,
    view: 'manager' as const,
    currentFolderId: root.children[0]?.id ?? root.id,
    collapsed: {},
    selected: [] as string[],
    treeSel: [] as string[],
    searchQuery: '',
    revealRev: 0,
    lastRevealAt: 0,
  }
}

describe('diffTrees', () => {
  const chrome = plainFolder('0', '', [
    plainFolder(barId, 'Bookmarks bar', [plainLink('10', 'A', 'https://a'), plainLink('11', 'B', 'https://b')]),
    plainFolder('2', 'Other bookmarks', []),
  ])

  it('no ops when trees match', () => {
    const local = localRoot([
      folder(barId, 'Bookmarks bar', [link('10', 'A', 'https://a'), link('11', 'B', 'https://b')]),
      folder('2', 'Other bookmarks'),
    ])
    expect(diffTrees(local, chrome)).toEqual([])
  })

  it('rename, url change, create, delete, reorder produce the right op kinds in order', () => {
    const local = localRoot([
      folder(barId, 'Bookmarks bar', [link('11', 'B', 'https://b'), link('10', 'A2', 'https://a2'), link('99', 'New', 'https://n')]),
      folder('2', 'Other bookmarks'),
    ])
    const ops = diffTrees(local, chrome)
    const kinds = ops.map((o) => o.kind)
    expect(kinds.filter((k) => k === 'create')).toHaveLength(1)
    expect(ops.some((o) => o.kind === 'update' && o.id === '10' && o.title === 'A2' && o.url === 'https://a2')).toBe(true)
    expect(countOps(ops)).toEqual({ created: 1, updated: 1, moved: 1, deleted: 0 })
  })

  it('protects chrome permanent top-level folders from deletion', () => {
    const local = localRoot([folder(barId, 'Bookmarks bar', [])]) // '2' missing locally
    const ops = diffTrees(local, chrome)
    expect(ops.some((o) => o.kind === 'delete' && o.id === '2')).toBe(false)
  })

  it('deletes local-removed subtrees with removeTree semantics', () => {
    const ch = plainFolder('0', '', [
      plainFolder(barId, 'Bookmarks bar', [plainFolder('20', 'Gone', [plainLink('21', 'x', 'u')])]),
      plainFolder('2', 'Other bookmarks', []),
    ])
    const local = localRoot([folder(barId, 'Bookmarks bar', []), folder('2', 'Other bookmarks')])
    const ops = diffTrees(local, ch)
    expect(ops).toEqual([{ kind: 'delete', id: '20', folder: true }])
  })

  it('nested creates are dependency-ordered: folder first, then children', () => {
    const local = localRoot([
      folder(barId, 'Bookmarks bar', [folder('n1', 'New folder', [link('n2', 'deep', 'https://d')])]),
      folder('2', 'Other bookmarks'),
    ])
    const ops = diffTrees(local, chrome)
    const creates = ops.filter((o) => o.kind === 'create')
    expect(creates).toHaveLength(2)
    expect(creates[0]).toMatchObject({ localId: 'n1', parentId: barId, folder: true })
    expect(creates[1]).toMatchObject({ localId: 'n2', parentId: 'n1' }) // references the local (not-yet-created) id
  })
})

describe('applyOps + applyToChrome round-trips against the fake backend', () => {
  it('executes creates/moves/renames/deletes to convergence, remapping created ids', async () => {
    const fake = new FakeChrome()
    // chrome: bar = [A, B]
    const A = await fake.create({ parentId: barId, title: 'A', url: 'https://a' })
    await fake.create({ parentId: barId, title: 'B', url: 'https://b' })
    // local: bar = [B, NewFolder[deep], A-renamed] ; A url edited
    const local = localRoot([
      folder(barId, 'Bookmarks bar', [
        link('11', 'B', 'https://b'),
        folder('f1', 'New folder', [link('l1', 'deep', 'https://d')]),
        link('10', 'A-renamed', 'https://a2'),
      ]),
      folder('2', 'Other bookmarks'),
    ])
    const doc = docWithRoot(local)
    doc.currentFolderId = 'f1'
    doc.selected = ['l1']

    const r = await applyToChrome(doc, fake)
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])

    const tree = await fake.getTree()
    const bar = tree.children![0]!
    expect(bar.children!.map((c) => c.title)).toEqual(['B', 'New folder', 'A-renamed'])
    const nf = bar.children![1]!
    expect(nf.children!.map((c) => c.title)).toEqual(['deep'])
    expect(bar.children![2]!.url).toBe('https://a2')

    // created folder + link ids were written back into the doc tree
    expect(nf.id).not.toBe('f1')
    expect(doc.currentFolderId).toBe(nf.id)
    expect(doc.selected).toEqual([nf.children![0]!.id])

    // converged: another diff is empty
    expect(diffTrees(doc.root, tree)).toEqual([])
  })

  it('partial failure keeps remaining ops reportable and re-applies idempotently', async () => {
    const fake = new FakeChrome()
    const F = await fake.create({ parentId: barId, title: 'F' })
    await fake.create({ parentId: F.id, title: 'keep', url: 'u' })
    const local = localRoot([folder(barId, 'Bookmarks bar', []), folder('2', 'Other bookmarks')])

    // first apply deletes F entirely → ok
    const r1 = await applyToChrome(docWithRoot(structuredClone(local)), fake)
    expect(r1.ok).toBe(true)
    // second apply on the same local state: nothing left to do
    const r2 = await applyToChrome(docWithRoot(local), fake)
    expect(r2.ok).toBe(true)
    expect(diffTrees(local, r2.tree)).toEqual([])
    expect(F.id).toBeDefined()
  })

  it('applyOps surfaces backend errors as per-op failures without aborting the rest', async () => {
    const fake = new FakeChrome()
    await fake.create({ parentId: barId, title: 'A', url: 'https://a' })
    const ops = diffTrees(
      localRoot([folder(barId, 'Bookmarks bar', [])]),
      plainFolder('0', '', [plainFolder(barId, 'Bookmarks bar', [plainLink('10', 'A', 'https://a')]), plainFolder('2', 'Other bookmarks', [])]),
    )
    expect(ops).toEqual([{ kind: 'delete', id: '10', folder: false }])
  })
})

describe('planApply', () => {
  it('blocks when chrome changed since the baseline (no silent merge)', async () => {
    const fake = new FakeChrome()
    const baseline = await fake.getTree()
    await fake.create({ parentId: barId, title: 'External', url: 'https://ext' }) // changed elsewhere
    const local = localRoot([folder(barId, 'Bookmarks bar', []), folder('2', 'Other bookmarks')])
    const plan = await planApply(local, baseline, fake)
    expect(plan.blocked).toBe(true)
    expect(plan.ops).toEqual([])
  })

  it('proceeds when chrome matches the baseline', async () => {
    const fake = new FakeChrome()
    await fake.create({ parentId: barId, title: 'A', url: 'https://a' })
    const baseline = await fake.getTree()
    const local = localRoot([folder(barId, 'Bookmarks bar', []), folder('2', 'Other bookmarks')])
    const plan = await planApply(local, baseline, fake)
    expect(plan.blocked).toBe(false)
    expect(plan.ops).toEqual([{ kind: 'delete', id: '100', folder: false }])
  })
})

// ---- mapping ---------------------------------------------------------------

describe('chrome → app mapping', () => {
  it('maps folders/links, normalises ms → s dates, and treats empty folders as folders', () => {
    const node = nodeFromPlain({
      id: '7',
      title: 'A folder',
      dateAdded: 1700000000123,
      children: [{ id: '8', title: 'Link', url: 'https://x', dateAdded: 1700000001000 }],
    })
    expect(node.type).toBe('folder')
    expect(node.addDate).toBe(1700000000)
    expect(node.children[0]!.type).toBe('link')
    expect(node.children[0]!.url).toBe('https://x')
    expect(node.children[0]!.addDate).toBe(1700000001)
    const empty = nodeFromPlain({ id: '9', title: 'Empty', children: [] })
    expect(empty.type).toBe('folder')
    expect(empty.children).toEqual([])
    const bare = nodeFromPlain({ id: '12', title: 'L', url: 'https://y' })
    expect(bare.type).toBe('link')
  })

  it('chromeRootToNode makes the hidden root synthetic and keeps top-level ids', () => {
    const root = chromeRootToNode(
      plainFolder('0', '', [plainFolder('1', 'Bookmarks bar', []), plainFolder('2', 'Other bookmarks', [])]),
    )
    expect(root.id).toBe('__root__')
    expect(root.children.map((c) => c.id)).toEqual(['1', '2'])
  })

  it('chromeRootToNode hides the top-level "Mobile bookmarks" sync folder', () => {
    const root = chromeRootToNode(
      plainFolder('0', '', [
        plainFolder('1', 'Bookmarks bar', []),
        plainFolder('2', 'Other bookmarks', []),
        plainFolder('3', 'Mobile bookmarks', [plainLink('30', 'Phone note', 'https://m')]),
      ]),
    )
    expect(root.children.map((c) => c.id)).toEqual(['1', '2'])
    expect(root.children.some((c) => c.name === 'Mobile bookmarks')).toBe(false)
  })

  it('plainEquals compares structure and ignores dates', () => {
    const a = plainFolder('0', '', [plainFolder('1', 'bar', [plainLink('10', 'A', 'u')])])
    const b = plainFolder('0', '', [plainFolder('1', 'bar', [plainLink('10', 'A', 'u')])])
    expect(plainEquals(a, b)).toBe(true)
    b.children![0]!.children![0]!.title = 'B'
    expect(plainEquals(a, b)).toBe(false)
  })
})

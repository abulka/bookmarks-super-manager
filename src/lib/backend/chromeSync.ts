// Write-back: diff the live doc against chrome's current tree, produce a
// dependency-ordered op list, execute it, then verify by re-diffing.
//
// The diff carries an in-memory simulation of chrome's tree so every emitted
// `move` index is exact at execution time. It relies on the semantics pinned
// by the spike (spike/spike-results.json, Chrome for Testing 151):
//   - move index is pre-removal: same-parent with srcPos > requested lands at
//     requested; cross-parent always lands at requested; requested == count
//     is valid and lands at the end; beyond count throws
//   - create index ∈ [0, count]; appending (no index) is always safe
// The placement pass only ever emits upward/noop same-parent moves
// (invariant: after placing positions 0..i-1, the desired item sits at a
// position > i), which is why the naive "move to index i" loop converges.
import type { BmNode, BookmarkDoc } from '../../types'
import { findNode } from '../tree'
import type { ChromeBackend, ChromePlain } from './chrome'
import { plainEquals } from './chrome'

export type SyncOp =
  | { kind: 'create'; localId: string; parentId: string; title: string; url?: string; folder: boolean }
  | { kind: 'update'; id: string; title?: string; url?: string }
  | { kind: 'delete'; id: string; folder: boolean }
  | { kind: 'move'; id: string; parentId: string; index: number }

export interface SyncCounts {
  created: number
  updated: number
  moved: number
  deleted: number
}

export function countOps(ops: SyncOp[]): SyncCounts {
  const c: SyncCounts = { created: 0, updated: 0, moved: 0, deleted: 0 }
  for (const op of ops) {
    if (op.kind === 'create') c.created++
    else if (op.kind === 'update') c.updated++
    else if (op.kind === 'move') c.moved++
    else c.deleted++
  }
  return c
}

/**
 * Diff the local tree against a chrome tree (rooted at '0') and return the
 * ops that transform chrome into the local tree, in execution order.
 *
 * `protectTopLevel` (default) never deletes chrome's permanent top-level
 * folders (Bookmarks bar / Other bookmarks / …): a local deletion of one is
 * ignored rather than destroying the folder in chrome.
 */
export function diffTrees(localRoot: BmNode, chromeRoot: ChromePlain, protectTopLevel = true): SyncOp[] {
  const ops: SyncOp[] = []

  // simulation: folder id → ordered child ids; chrome id → plain node
  const sim = new Map<string, string[]>()
  const chromeById = new Map<string, ChromePlain>()
  const indexChrome = (n: ChromePlain): void => {
    sim.set(n.id, (n.children ?? []).map((c) => c.id))
    chromeById.set(n.id, n)
    for (const c of n.children ?? []) indexChrome(c)
  }
  indexChrome(chromeRoot)

  const childrenOf = (id: string): string[] => sim.get(id) ?? []
  const detach = (parent: string, id: string): void => {
    const list = sim.get(parent)
    if (!list) return
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
  }

  // every id present anywhere in the local tree — used to tell a *move* from
  // a *delete*: an item still living under a different parent locally was
  // moved, not deleted, and must never be deleted out from under itself.
  const localById = new Map<string, BmNode>()
  const indexLocal = (n: BmNode): void => {
    localById.set(n.id, n)
    for (const c of n.children ?? []) indexLocal(c)
  }
  indexLocal(localRoot)

  /** True when a chrome node (or anything in its subtree) still exists locally. */
  const relocatedIntoLocalTree = (chromeId: string): boolean => {
    if (localById.has(chromeId)) return true
    const cn = chromeById.get(chromeId)
    return !!cn?.children?.some((c) => relocatedIntoLocalTree(c.id))
  }

  const visit = (local: BmNode, chromeId: string): void => {
    const localKids = local.children
    const localIds = new Set(localKids.map((c) => c.id))

    // 1. deletes — chrome children missing locally AND gone from the whole
    //    local tree. Items that still exist locally under another parent are
    //    moves, not deletions: skip them here and let the placement pass (3)
    //    emit a single `move` instead. Subtree-relocations get the same grace.
    for (const cid of [...childrenOf(chromeId)]) {
      if (localIds.has(cid)) continue
      if (protectTopLevel && chromeId === chromeRoot.id) continue
      const cn = chromeById.get(cid)
      if (!cn) continue
      if (relocatedIntoLocalTree(cid)) continue // moved elsewhere — delete later, if at all
      ops.push({ kind: 'delete', id: cid, folder: !!cn.children })
      detach(chromeId, cid)
    }

    // 2. creates — local subtrees chrome doesn't have (append; placement fixes order)
    for (const lk of localKids) {
      if (chromeById.has(lk.id)) continue
      const folder = lk.type === 'folder'
      ops.push({
        kind: 'create',
        localId: lk.id,
        parentId: chromeId,
        title: lk.name,
        ...(folder ? {} : { url: lk.url }),
        folder,
      })
      chromeById.set(lk.id, {
        id: lk.id,
        title: lk.name,
        ...(folder ? {} : { url: lk.url }),
        ...(folder ? { children: [] } : {}),
      })
      if (folder) sim.set(lk.id, [])
      sim.get(chromeId)!.push(lk.id)
    }

    // 3. placement pass — desired order = local order (upward/noop moves only)
    const list = childrenOf(chromeId)
    for (let i = 0; i < localKids.length; i++) {
      const id = localKids[i]!.id
      const cur = list.indexOf(id)
      if (cur === i) continue
      ops.push({ kind: 'move', id, parentId: chromeId, index: i })
      if (cur >= 0) list.splice(cur, 1)
      else {
        for (const [pid, l] of sim) if (l.includes(id) && pid !== chromeId) detach(pid, id)
      }
      list.splice(i, 0, id)
    }

    // 4. updates + recurse
    for (const lk of localKids) {
      const cn = chromeById.get(lk.id)
      if (!cn) continue // deleted above (protected top-level folder): leave untouched
      const urlChanged = lk.type === 'link' && (cn.url ?? '') !== (lk.url ?? '')
      if (cn.title !== lk.name || urlChanged) {
        ops.push({
          kind: 'update',
          id: cn.id,
          ...(cn.title !== lk.name ? { title: lk.name } : {}),
          ...(urlChanged ? { url: lk.url } : {}),
        })
        cn.title = lk.name
        if (urlChanged) cn.url = lk.url
      }
      if (lk.type === 'folder' && cn.children) visit(lk, cn.id)
    }
  }

  visit(localRoot, chromeRoot.id)
  return ops
}

// ---- execution -------------------------------------------------------------

export interface ApplyOutcome {
  ok: boolean
  applied: number
  failures: { op: SyncOp; error: string }[]
  tree: ChromePlain
}

/** True while an Apply is running; the external-change watcher defers to it. */
export let applying = false

/**
 * Replay ops against a real-or-fake backend. Created nodes get their real
 * chrome ids: the local tree node's id is rewritten in place (so re-diffs
 * match) and doc selection/currentFolder references are remapped.
 */
export async function applyOps(doc: BookmarkDoc, ops: SyncOp[], backend: ChromeBackend): Promise<ApplyOutcome> {
  const idMap = new Map<string, string>()
  const resolve = (id: string): string => idMap.get(id) ?? id
  const failures: ApplyOutcome['failures'] = []
  let applied = 0

  const remapRefs = (oldId: string, newId: string): void => {
    const swap = (arr: string[]): void => {
      for (let i = 0; i < arr.length; i++) if (arr[i] === oldId) arr[i] = newId
    }
    swap(doc.selected)
    swap(doc.treeSel)
    if (doc.currentFolderId === oldId) doc.currentFolderId = newId
  }

  for (const op of ops) {
    try {
      switch (op.kind) {
        case 'create': {
          const created = await backend.create({
            parentId: resolve(op.parentId),
            title: op.title,
            ...(op.url !== undefined ? { url: op.url } : {}),
          })
          idMap.set(op.localId, created.id)
          const localNode = findNode(doc.root, op.localId)
          if (localNode) {
            localNode.id = created.id
            remapRefs(op.localId, created.id)
          }
          break
        }
        case 'update': {
          const changes: { title?: string; url?: string } = {}
          if (op.title !== undefined) changes.title = op.title
          if (op.url !== undefined) changes.url = op.url
          if (Object.keys(changes).length) await backend.update(resolve(op.id), changes)
          break
        }
        case 'delete': {
          if (op.folder) await backend.removeTree(resolve(op.id))
          else await backend.remove(resolve(op.id))
          break
        }
        case 'move': {
          await backend.move(resolve(op.id), { parentId: resolve(op.parentId), index: op.index })
          break
        }
      }
      applied++
    } catch (e) {
      failures.push({ op, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const tree = await backend.getTree()
  return { ok: !failures.length, applied, failures, tree }
}

/**
 * Batch Apply with self-verification: diff → execute → re-diff, up to
 * `maxPasses` correction rounds. Returns ok only when chrome and the local
 * tree agree (or failures aborted the run — the doc stays dirty either way).
 */
export async function applyToChrome(doc: BookmarkDoc, backend: ChromeBackend, maxPasses = 4): Promise<ApplyOutcome> {
  applying = true
  try {
    let applied = 0
    let failures: ApplyOutcome['failures'] = []
    let tree = await backend.getTree()
    for (let pass = 0; pass < maxPasses; pass++) {
      const ops = diffTrees(doc.root, tree)
      if (!ops.length) return { ok: !failures.length, applied, failures, tree }
      const r = await applyOps(doc, ops, backend)
      applied += r.applied
      failures = r.failures
      tree = r.tree
      if (r.failures.length) return { ok: false, applied, failures, tree }
    }
    return { ok: false, applied, failures, tree }
  } finally {
    applying = false
  }
}

/**
 * Pre-flight for the reviewable Apply summary: refuses to run when chrome
 * changed since the doc's baseline (v1 has no merge — reload first).
 */
export async function planApply(
  localRoot: BmNode,
  baseline: ChromePlain | undefined,
  backend: ChromeBackend,
): Promise<{ ops: SyncOp[]; counts: SyncCounts; blocked: boolean }> {
  const fresh = await backend.getTree()
  if (baseline && !plainEquals(baseline, fresh)) return { ops: [], counts: countOps([]), blocked: true }
  const ops = diffTrees(localRoot, fresh)
  return { ops, counts: countOps(ops), blocked: false }
}

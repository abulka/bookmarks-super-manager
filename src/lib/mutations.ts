import type { BmNode } from '../types'
import { uid } from './id'

/** Insert a node before the node with `anchorId` (or append if none). */
export function insertBefore(parent: BmNode, index: number, node: BmNode): void {
  parent.children.splice(index, 0, node)
}

/**
 * Move `ids` (children of `src`) to be placed before `anchorId` inside `tgt`
 * (or at the end when anchorId is null). Handles same-parent moves.
 */
export function applyMove(src: BmNode, ids: string[], tgt: BmNode, anchorId: string | null): void {
  const sel = new Set(ids)
  if (sel.size === 0) return
  const indices: number[] = []
  for (let i = 0; i < src.children.length; i++) if (sel.has(src.children[i].id)) indices.push(i)
  if (indices.length === 0) return
  const removed = indices.map((i) => src.children[i])
  for (let i = indices.length - 1; i >= 0; i--) src.children.splice(indices[i], 1)

  let insertIndex: number
  if (tgt === src) {
    if (anchorId) {
      const ai = src.children.findIndex((c) => c.id === anchorId)
      insertIndex = ai === -1 ? src.children.length : ai
    } else {
      insertIndex = src.children.length
    }
  } else {
    const ai = anchorId ? tgt.children.findIndex((c) => c.id === anchorId) : -1
    insertIndex = ai === -1 ? tgt.children.length : ai
  }
  for (let k = 0; k < removed.length; k++) tgt.children.splice(insertIndex + k, 0, removed[k])
}

/** Remove nodes by id from parent; returns the captured (id, position) entries for undo. */
export function applyRemove(parent: BmNode, ids: string[]): { node: BmNode; index: number }[] {
  const sel = new Set(ids)
  const captured: { node: BmNode; index: number }[] = []
  for (let i = 0; i < parent.children.length; i++) {
    if (sel.has(parent.children[i].id)) captured.push({ node: parent.children[i], index: i })
  }
  for (let i = captured.length - 1; i >= 0; i--) parent.children.splice(captured[i].index, 1)
  return captured
}

/** Re-insert previously captured nodes at their original positions. */
export function restoreRemove(parent: BmNode, captured: { node: BmNode; index: number }[]): void {
  const sorted = [...captured].sort((a, b) => a.index - b.index)
  // inserting in ascending original-index order is self-correcting: each
  // earlier insertion shifts later targets by exactly the +1 it needs
  for (const c of sorted) parent.children.splice(c.index, 0, c.node)
}

export function indexOf(parent: BmNode, id: string): number {
  return parent.children.findIndex((c) => c.id === id)
}

/** Deep clone (for document duplication). */
export function cloneTree(node: BmNode): BmNode {
  return {
    ...node,
    children: node.children.map(cloneTree),
  }
}

/**
 * Deep-clone a set of nodes for cross-doc transfer, giving every node a fresh
 * unique id so the copies can exist alongside the originals in any document.
 */
export function cloneNodes(nodes: BmNode[]): BmNode[] {
  const clone = (n: BmNode): BmNode => {
    const c: BmNode = { ...n, id: uid(), children: [] }
    for (const kid of n.children) c.children.push(clone(kid))
    return c
  }
  return nodes.map(clone)
}

export function collectNodeIds(nodes: BmNode[]): string[] {
  const out: string[] = []
  const walk = (n: BmNode) => {
    out.push(n.id)
    for (const c of n.children) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}

/** Remove a whole subtree from wherever it lives (returns captured info for undo). */
export function removeSubtreeFromParent(parentOf: Map<string, BmNode>, ids: string[]): { parent: BmNode; node: BmNode; index: number }[] {
  const captured: { parent: BmNode; node: BmNode; index: number }[] = []
  for (const id of ids) {
    const parent = parentOf.get(id)
    if (!parent) continue
    const index = indexOf(parent, id)
    if (index === -1) continue
    const [node] = parent.children.splice(index, 1)
    captured.push({ parent, node, index })
  }
  return captured
}
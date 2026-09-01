import { indexTree } from './tree'
import type { BmNode } from '../types'

export function parentOf(root: BmNode): Map<string, string> {
  const idx = indexTree(root)
  const out = new Map<string, string>()
  for (const [id, p] of idx.parentOf) out.set(id, p.id)
  return out
}

/** Number of folders above `id` (the top-level folders are depth 0). */
export function depthOf(root: BmNode, id: string): number {
  let cur = id
  let d = 0
  const idx = indexTree(root)
  while (cur && cur !== root.id) {
    const p = idx.parentOf.get(cur)
    if (!p) break
    d++
    cur = p.id
  }
  return d - 1 >= 0 ? d - 1 : 0
}
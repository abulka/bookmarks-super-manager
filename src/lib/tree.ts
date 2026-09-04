import { toRaw } from 'vue'
import type { BmNode } from '../types'
import { normalizeUrl } from './url'

export type NodeMap = {
  byId: Map<string, BmNode>
  parentOf: Map<string, BmNode>
}

function raw(root: BmNode): BmNode {
  return toRaw(root) as BmNode
}

/** Build id->node and node->parent maps. */
export function indexTree(root: BmNode): NodeMap {
  root = raw(root)
  const byId = new Map<string, BmNode>()
  const parentOf = new Map<string, BmNode>()
  const walk = (n: BmNode, parent: BmNode | null) => {
    byId.set(n.id, n)
    if (parent) parentOf.set(n.id, parent)
    for (const c of n.children) walk(c, n)
  }
  walk(root, null)
  return { byId, parentOf }
}

export function* walk(root: BmNode, includeRoot = false): Generator<BmNode> {
  root = raw(root)
  if (includeRoot) yield root
  for (const c of root.children) {
    yield c
    yield* walk(c, false)
  }
}

export function allLinks(root: BmNode): BmNode[] {
  const out: BmNode[] = []
  for (const n of walk(root)) if (n.type === 'link') out.push(n)
  return out
}

/**
 * Ancestry of `node` up to (excluding) the root, ordered root-most first.
 * The seen-set guards against cycles in the id-keyed parent map (duplicate
 * ids in legacy/foreign data would otherwise hang the walk forever).
 */
function ancestryPath(parentOf: Map<string, BmNode>, rootId: string, node: BmNode | undefined): BmNode[] {
  const path: BmNode[] = []
  const seen = new Set<BmNode>()
  let cur: BmNode | undefined = node
  while (cur && cur.id !== rootId && !seen.has(cur)) {
    seen.add(cur)
    path.push(cur)
    cur = parentOf.get(cur.id)
  }
  path.reverse()
  return path
}

/** Path of node names from root (exclusive) to node. */
export function namePath(root: BmNode, id: string): string[] {
  root = raw(root)
  const { byId, parentOf } = indexTree(root)
  return ancestryPath(parentOf, root.id, byId.get(id)).map((n) => n.name)
}

/** Breadcrumb of node objects from the top-most child to node. */
export function nodePath(root: BmNode, id: string): BmNode[] {
  root = raw(root)
  const { byId, parentOf } = indexTree(root)
  return ancestryPath(parentOf, root.id, id === root.id ? root : byId.get(id))
}

/** One crumb in the visible tree path (the "Other bookmarks" section targets the root). */
export interface Crumb {
  id: string
  name: string
}

/**
 * Visible path from the top-level section down to `id`, mirroring the tree:
 * folders under the bookmarks bar show `Bookmarks bar › …`; mobile shows
 * `Mobile bookmarks › …`; everything else gets the virtual "Other bookmarks"
 * section prepended. Root itself → [].
 */
export function crumbPath(root: BmNode, id: string): Crumb[] {
  root = raw(root)
  const path = nodePath(root, id).map((n) => ({ id: n.id, name: n.name }))
  if (!path.length) return []
  const bar = toolbarFolder(root)
  const mobile = mobileFolder(root)
  const top = path[0]!
  if (bar && top.id === bar.id) return path
  if (mobile && top.id === mobile.id) return path
  // the virtual section label is "Other bookmarks" — don't prepend it over a
  // real top-level folder that is already named "Other bookmarks" (that would
  // render a redundant "Other bookmarks › Other bookmarks")
  if (top.name === 'Other bookmarks') return path
  return [{ id: root.id, name: 'Other bookmarks' }, ...path]
}

export function findNode(root: BmNode, id: string): BmNode | undefined {
  return indexTree(root).byId.get(id)
}

export function folderCount(root: BmNode, id: string): number {
  const n = findNode(root, id)
  if (!n) return 0
  let c = 0
  for (const x of walk(n, false)) if (x.type === 'link') c++
  return c
}

export function countFolder(root: BmNode, id: string): { links: number; folders: number } {
  const n = findNode(root, id)
  if (!n) return { links: 0, folders: 0 }
  let links = 0
  let folders = 0
  for (const x of walk(n, false)) {
    if (x.type === 'link') links++
    else folders++
  }
  return { links, folders }
}

export interface FolderCount {
  links: number
  dead: number
}

/** Subtree link + dead-link counts for every folder, computed in one pass. */
export function folderCounts(root: BmNode): Map<string, FolderCount> {
  root = raw(root)
  const counts = new Map<string, FolderCount>()
  const visit = (n: BmNode): FolderCount => {
    let links = 0
    let dead = 0
    for (const c of n.children) {
      if (c.type === 'folder') {
        const sub = visit(c)
        links += sub.links
        dead += sub.dead
      } else {
        links++
        if (c.dead) dead++
      }
    }
    counts.set(n.id, { links, dead })
    return { links, dead }
  }
  visit(root)
  return counts
}

export interface DupGroup {
  key: string
  url: string
  members: { node: BmNode; path: BmNode[]; parentPathNames: string[] }[]
}

export interface DupReport {
  groups: DupGroup[]
  totalDuplicates: number
  uniqueUrls: number
}

/** Group links by normalized URL. */
export function findDuplicates(root: BmNode): DupReport {
  root = raw(root)
  const groups = new Map<string, { url: string; nodes: BmNode[] }[]>()
  const { parentOf } = indexTree(root)
  for (const n of walk(root)) {
    if (n.type !== 'link' || !n.url) continue
    const key = normalizeUrl(n.url)
    const url = n.url
    let arr = groups.get(key)
    if (!arr) {
      arr = []
      groups.set(key, arr)
    }
    let entry = arr.find((e) => e.url === url)
    if (!entry) {
      entry = { url, nodes: [] }
      arr.push(entry)
    }
    entry.nodes.push(n)
  }
  const out: DupGroup[] = []
  let totalDuplicates = 0
  for (const [, arr] of groups) {
    let totalNodes = 0
    for (const e of arr) totalNodes += e.nodes.length
    if (totalNodes > 1) {
      const members = arr.flatMap((e) =>
        e.nodes.map((node) => {
          const path = ancestryPath(parentOf, root.id, node)
          const parentPathNames = path.slice(0, -1).map((p) => p.name)
          return { node, path, parentPathNames }
        })
      )
      members.sort((a, b) => (b.node.addDate ?? 0) - (a.node.addDate ?? 0))
      const key = arr[0].url
      out.push({ key: normalizeUrl(key), url: arr[0].url, members })
      totalDuplicates += members.length - 1
    }
  }
  out.sort((a, b) => b.members.length - a.members.length)
  return { groups: out, totalDuplicates, uniqueUrls: groups.size }
}

/** Simple topological index of expanded folders, used to flatten the sidebar tree for rendering. */
export function flattenTree(root: BmNode, collapsed: Record<string, boolean>): BmNode[] {
  root = raw(root)
  const out: BmNode[] = []
  const isCollapsed = (id: string) => collapsed[id] === true
  const walkExpanded = (n: BmNode) => {
    for (const c of n.children) {
      out.push(c)
      if (c.type === 'folder' && !isCollapsed(c.id)) walkExpanded(c)
    }
  }
  walkExpanded(root)
  return out
}

/**
 * The "Bookmarks bar" top-level folder, if the data has one. Chrome marks it
 * with PERSONAL_TOOLBAR_FOLDER; older/foreign data is matched by name.
 */
export function toolbarFolder(root: BmNode): BmNode | null {
  root = raw(root)
  return root.children.find((c) => c.type === 'folder' && (c.attrs?.PERSONAL_TOOLBAR_FOLDER === 'true' || c.name.toLowerCase().includes('bookmarks bar'))) ?? null
}

/**
 * The top-level "Mobile bookmarks" folder, if the data has one. Chrome's sync
 * section keeps phone-synced bookmarks; it is its own root in the tree, just
 * like the bookmarks bar.
 */
export function mobileFolder(root: BmNode): BmNode | null {
  root = raw(root)
  return root.children.find((c) => c.type === 'folder' && c.name.toLowerCase() === 'mobile bookmarks') ?? null
}

/**
 * Chrome's real top-level "Other bookmarks" folder, if one exists. The app's
 * virtual "All bookmarks" section renders its contents (Chrome mirrors one into
 * the other), so the folder itself must never appear nested inside that section.
 */
export function otherFolder(root: BmNode): BmNode | null {
  root = raw(root)
  const bar = toolbarFolder(root)
  return root.children.find((c) => c.type === 'folder' && c.name.toLowerCase() === 'other bookmarks' && c.id !== bar?.id) ?? null
}

export function isDescendant(root: BmNode, ancestorId: string, id: string): boolean {
  root = raw(root)
  const { parentOf } = indexTree(root)
  const seen = new Set<string>()
  let cur = parentOf.get(id)
  while (cur && cur.id !== root.id && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.id === ancestorId) return true
    cur = parentOf.get(cur.id)
  }
  return false
}

/**
 * Reduce a selection to its topmost nodes: any id that has a selected
 * ancestor is dropped, since moving/copying the ancestor carries it along.
 * Order and duplicates of the input are preserved.
 */
export function topmostIds(parentOf: Map<string, BmNode>, ids: string[]): string[] {
  const sel = new Set(ids)
  const out: string[] = []
  for (const id of ids) {
    if (!sel.has(id)) continue
    let cur = parentOf.get(id)
    let blocked = false
    while (cur) {
      if (sel.has(cur.id)) {
        blocked = true
        break
      }
      cur = parentOf.get(cur.id)
    }
    if (!blocked) out.push(id)
  }
  return out
}

/**
 * Group raw ids under the folder that contains each one, for transfers that
 * span multiple parents. Only topmost ids survive; the output maps parent →
 * its direct selected children (input order preserved per parent).
 */
export function groupByParent(parentOf: Map<string, BmNode>, ids: string[]): { parentId: string; ids: string[] }[] {
  const map = new Map<string, string[]>()
  for (const id of topmostIds(parentOf, ids)) {
    const p = parentOf.get(id)
    if (!p) continue
    const list = map.get(p.id)
    if (list) list.push(id)
    else map.set(p.id, [id])
  }
  return [...map.entries()].map(([parentId, list]) => ({ parentId, ids: list }))
}

export function sortFolder(children: BmNode[], by: 'name' | 'url' | 'added'): BmNode[] {
  const cmp = (a: BmNode, b: BmNode): number => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    if (by === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    if (by === 'url') return (a.url || '').localeCompare(b.url || '')
    return (b.addDate ?? 0) - (a.addDate ?? 0)
  }
  return [...children].sort(cmp)
}
// Chrome extension backend: feature detection, chrome.bookmarks → app model
// mapping, the baseline snapshot used for external-change detection, and the
// real ChromeBackend adapter. The web build never enters these code paths
// (everything is gated on isChromeExt()).
import type { BmNode } from '../../types'
import { ROOT_ID } from '../../types'

export const CHROME_DOC_ID = 'chrome-live'

/** Minimal structural shape of a chrome.bookmarks subtree we diff/verify against. */
export interface ChromePlain {
  id: string
  title: string
  url?: string
  /** ms since epoch — carried for doc mapping; ignored by plainEquals */
  dateAdded?: number
  /** folders always have children (possibly empty); links don't */
  children?: ChromePlain[]
}

/** The subset of chrome.bookmarks the sync layer needs; faked in tests. */
export interface ChromeBackend {
  /** full tree, rooted at the hidden '0' node */
  getTree(): Promise<ChromePlain>
  create(p: { parentId: string; title: string; url?: string }): Promise<{ id: string }>
  update(id: string, p: { title?: string; url?: string }): Promise<void>
  remove(id: string): Promise<void>
  removeTree(id: string): Promise<void>
  move(id: string, p: { parentId: string; index?: number }): Promise<void>
  /** fires (debounce-free) on any external or applied change */
  watch(cb: () => void): void
}

export function isChromeExt(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.bookmarks?.getTree === 'function'
}

function plainNode(n: chrome.bookmarks.BookmarkTreeNode): ChromePlain {
  return {
    id: n.id,
    title: n.title,
    ...(n.url !== undefined ? { url: n.url } : {}),
    ...(n.dateAdded !== undefined ? { dateAdded: n.dateAdded } : {}),
    ...(n.children ? { children: n.children.map(plainNode) } : {}),
  }
}

/** Reads the whole tree as a plain structure rooted at the hidden '0' node. */
export async function fetchChromeTree(): Promise<ChromePlain> {
  if (!isChromeExt()) throw new Error('chrome.bookmarks unavailable')
  const [root] = await chrome.bookmarks.getTree()
  return plainNode(root)
}

/** chrome.bookmarks node → app node. Ids pass through untouched. */
export function nodeFromPlain(c: ChromePlain): BmNode {
  const folder = !!c.children
  return {
    id: c.id,
    type: folder ? 'folder' : 'link',
    name: c.title,
    ...(folder ? {} : { url: c.url }),
    // Chrome counts ms since epoch; the app's ADD_DATE convention is seconds
    ...(c.dateAdded ? { addDate: Math.floor(c.dateAdded / 1000) } : {}),
    children: folder ? (c.children ?? []).map(nodeFromPlain) : [],
  }
}

/** Whole chrome tree → the live doc's root: hidden '0' becomes the synthetic doc root. */
export function chromeRootToNode(root: ChromePlain): BmNode {
  const kids = (root.children ?? []).map(nodeFromPlain)
  return { id: ROOT_ID, type: 'folder', name: '(root)', children: kids }
}

/** Structural equality (ids, order, titles, urls — deliberately ignoring dates). */
export function plainEquals(a: ChromePlain, b: ChromePlain): boolean {
  if (a.id !== b.id || a.title !== b.title || (a.url ?? undefined) !== (b.url ?? undefined)) return false
  const ka = a.children ?? null
  const kb = b.children ?? null
  if (!ka !== !kb) return false
  if (!ka || !kb) return true
  if (ka.length !== kb.length) return false
  return ka.every((n, i) => plainEquals(n, kb[i]!))
}

// ---- baseline (chrome state this doc was loaded from / last applied) ------
const baselines = new Map<string, ChromePlain>()

export function getBaseline(docId: string): ChromePlain | undefined {
  return baselines.get(docId)
}
export function setBaseline(docId: string, tree: ChromePlain): void {
  baselines.set(docId, tree)
}
export function clearBaseline(docId: string): void {
  baselines.delete(docId)
}

/** Real chrome.bookmarks adapter. Throws when not running as an extension. */
export function chromeBackend(): ChromeBackend {
  if (!isChromeExt()) throw new Error('chrome.bookmarks unavailable')
  const bm = chrome.bookmarks
  return {
    getTree: fetchChromeTree,
    create: async (p) => {
      const n = await bm.create(p)
      return { id: n.id }
    },
    update: async (id, p) => {
      await bm.update(id, p)
    },
    remove: (id) => bm.remove(id),
    removeTree: (id) => bm.removeTree(id),
    move: async (id, p) => {
      await bm.move(id, p)
    },
    watch: (cb) => {
      for (const ev of [bm.onCreated, bm.onChanged, bm.onMoved, bm.onRemoved, bm.onChildrenReordered]) {
        ev.addListener(cb)
      }
    },
  }
}

/** Debounced (~500 ms) subscription to any chrome.bookmarks change. */
export function watchChromeChanges(onChange: () => void): void {
  if (!isChromeExt()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const bm = chrome.bookmarks
  const debounced = (): void => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 500)
  }
  for (const ev of [bm.onCreated, bm.onChanged, bm.onMoved, bm.onRemoved, bm.onChildrenReordered]) {
    ev.addListener(debounced)
  }
}

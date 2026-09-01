import { uid } from '../lib/id'
import type { BmNode } from '../types'

interface FxNode {
  type?: string
  title?: string
  uri?: string
  dateAdded?: number
  lastModified?: number
  iconUri?: string
  tags?: string[]
  children?: FxNode[]
}

function microToSec(ms?: number): number | undefined {
  if (!ms) return undefined
  return Math.round(ms / 1000)
}

function convert(n: FxNode): BmNode {
  const isFolder = n.type === 'text/x-moz-place-container' || (n.children && n.children.length > 0)
  const node: BmNode = {
    id: uid(),
    type: isFolder ? 'folder' : 'link',
    name: (n.title ?? '').trim() || '(untitled)',
    children: [],
  }
  if (isFolder) {
    node.addDate = microToSec(n.dateAdded)
    node.lastMod = microToSec(n.lastModified)
    for (const c of n.children ?? []) {
      if (c.type === 'text/x-moz-place-separator') continue
      node.children.push(convert(c))
    }
  } else {
    node.url = n.uri ?? ''
    node.addDate = microToSec(n.dateAdded)
    node.lastMod = microToSec(n.lastModified)
    if (n.tags && n.tags.length) node.attrs = { TAGS: n.tags.join(',') }
  }
  return node
}

/** Parse a Firefox `bookmarks-<date>.json` backup into a synthetic root. */
export function parseFirefoxJson(text: string): BmNode {
  const data = JSON.parse(text) as FxNode | FxNode[]
  const list = Array.isArray(data) ? data : [data]
  const root: BmNode = { id: uid(), type: 'folder', name: '(root)', children: [] }
  for (const item of list) {
    if (!item || item.type === 'text/x-moz-place-separator') continue
    root.children.push(convert(item))
  }
  return root
}

export function looksLikeFirefoxJson(text: string): boolean {
  const t = text.trim()
  return (t.startsWith('{') || t.startsWith('[')) && /"text\/x-moz-place/.test(text)
}
import { uid } from '../lib/id'
import type { BmNode } from '../types'

export interface ParseResult {
  root: BmNode
  links: number
  folders: number
  droppedIcons: number
}

const ATTR_RE = /([A-Z_]+)="([^"]*)"/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#32': ' ',
  num: '#',
}

function decodeEntitiesRaw(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (m, ent) => {
    const key = String(ent).toLowerCase()
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10))
    return ENTITIES[key] ?? m
  })
}

function decodeEntities(s: string): string {
  const decoded = decodeEntitiesRaw(s).trim()
  return decoded.replace(/\s+/g, ' ')
}

function readAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(raw)) !== null) out[m[1]] = decodeEntitiesRaw(m[2])
  return out
}

const ICON_ATTRS = new Set(['ICON', 'ICON_URI', 'FAVICON'])
const KEEP_STRUCT = new Set([
  'PERSONAL_TOOLBAR_FOLDER',
  'UNFILED_BOOKMARKS_FOLDER',
  'SYNC_TRANSACTION_VERSION',
  'LAST_MODIFIED',
])

function num(s?: string): number | undefined {
  const v = s ? parseInt(s, 10) : NaN
  return isNaN(v) || v <= 0 ? undefined : v
}

function makeNode(type: 'folder' | 'link', name: string, attrs: Record<string, string>): { node: BmNode; dropped: number } {
  const kept: Record<string, string> = {}
  let dropped = 0
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'HREF' || k === 'ADD_DATE') continue
    if (ICON_ATTRS.has(k)) {
      dropped++
      continue
    }
    if (KEEP_STRUCT.has(k) || k.length <= 16 && !/^WEBKIT_|^MOBILE_|^SYNC_META|^CONTAIN/.test(k)) {
      kept[k] = v
      continue
    }
    dropped++
  }
  const node: BmNode = {
    id: uid(),
    type,
    name: decodeEntities(name),
    attrs: kept,
    children: [],
  }
  if (type === 'link') {
    node.url = attrs.HREF || ''
    node.addDate = num(attrs.ADD_DATE)
  } else {
    node.addDate = num(attrs.ADD_DATE)
  }
  node.lastMod = num(attrs.LAST_MODIFIED)
  return { node, dropped }
}

/**
 * Parse a Netscape-Bookmark HTML export (Chrome / Safari / Firefox / Edge).
 * Returns a synthetic root whose children are the top-level folders/links.
 */
export function parseNetscape(html: string): ParseResult {
  const root: BmNode = { id: uid(), type: 'folder', name: '(root)', children: [] }
  const stack: BmNode[] = [root]
  let links = 0
  let folders = 0
  let droppedIcons = 0

  const lines = html.split(/\r?\n/)
  let buf = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!buf) {
      const t = line.trim()
      if (!t) continue
      if (/<\/DL>/.test(line)) {
        let closes = 0
        const re = /<\/DL>/g
        while (re.exec(line)) closes++
        for (let k = 0; k < closes && stack.length > 1; k++) stack.pop()
        continue
      }
      if (/<DL>/i.test(t) && !/<DT>/.test(t)) continue
      if (!/<DT>/.test(t)) continue
      // a <DT> element: handle immediately if it is complete on this line
      if (/<\/A>|<\/H3>/.test(t)) {
        handleElement(line, stack, (k) => (k === 'link' ? links++ : folders++), () => droppedIcons++)
        continue
      }
      // element continues on following lines
      buf = line
      continue
    }
    // accumulating a multiline element
    buf += '\n' + line
    if (/<\/A>|<\/H3>/.exec(buf)) {
      handleElement(buf, stack, (k) => (k === 'link' ? links++ : folders++), () => droppedIcons++)
      buf = ''
    }
  }

  return { root, links, folders, droppedIcons }
}

type Counts = (kind: 'link' | 'folder') => void

function handleElement(text: string, stack: BmNode[], counts: Counts, dropIcon: () => void): void {
  const fm = /<DT>\s*<H3([^>]*)>([\s\S]*?)<\/H3>/.exec(text)
  const parent = stack[stack.length - 1]
  if (fm) {
    const attrs = readAttrs(fm[1])
    const { node, dropped } = makeNode('folder', fm[2], attrs)
    for (let i = 0; i < dropped; i++) dropIcon()
    parent.children.push(node)
    stack.push(node)
    counts('folder')
    return
  }
  const am = /<DT>\s*<A([^>]*)>([\s\S]*?)<\/A>/.exec(text)
  if (am) {
    const attrs = readAttrs(am[1])
    const { node, dropped } = makeNode('link', am[2], attrs)
    for (let i = 0; i < dropped; i++) dropIcon()
    parent.children.push(node)
    counts('link')
  }
}

/** Detect whether text looks like a Netscape bookmark export. */
export function looksLikeNetscape(text: string): boolean {
  return /Netscape-Bookmark-file-1/i.test(text) || /<DL><p>/i.test(text)
}

/** Strict sanity: count `<DT><A` and `<DT><H3` occurrences for verification. */
export function countTokens(html: string): { links: number; folders: number } {
  const links = html.split(/<DT><A[\s>]/).length - 1
  const folders = html.split(/<DT><H3[\s>]/).length - 1
  return { links, folders }
}
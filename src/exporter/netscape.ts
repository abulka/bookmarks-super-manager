import type { BmNode } from '../types'

function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SKIP_ATTRS = new Set(['ICON', 'ICON_URI', 'FAVICON'])

function extraAttrs(node: BmNode, skipPersonToolbar: boolean): string {
  let out = ''
  if (node.attrs) {
    for (const [k, v] of Object.entries(node.attrs)) {
      if (SKIP_ATTRS.has(k)) continue
      if (skipPersonToolbar && k === 'PERSONAL_TOOLBAR_FOLDER') continue
      out += ` ${k}="${escAttr(v)}"`
    }
  }
  return out
}

function dateAttrs(node: BmNode): string {
  let out = ''
  if (node.addDate) out += ` ADD_DATE="${node.addDate}"`
  if (node.lastMod) out += ` LAST_MODIFIED="${node.lastMod}"`
  return out
}

function serializeNode(node: BmNode, depth: number, lines: string[]): void {
  const pad = '    '.repeat(depth + 1)
  if (node.type === 'link') {
    const href = node.url ? ` HREF="${escAttr(node.url)}"` : ''
    lines.push(`${pad}<DT><A${href}${dateAttrs(node)}${extraAttrs(node, false)}>${escText(node.name)}</A>`)
    return
  }
  lines.push(`${pad}<DT><H3${dateAttrs(node)}${extraAttrs(node, false)}>${escText(node.name)}</H3>`)
  if (node.children.length) {
    lines.push(`${pad}<DL><p>`)
    for (const c of node.children) serializeNode(c, depth + 1, lines)
    lines.push(`${pad}</DL><p>`)
  }
}

/** Serialize the tree to a Chrome-compatible Netscape HTML export. */
export function exportNetscape(root: BmNode, title = 'Bookmarks'): string {
  const lines: string[] = []
  lines.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
  lines.push('<!-- This is an automatically generated file.')
  lines.push('     It will be read and overwritten.')
  lines.push('     DO NOT EDIT! -->')
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
  lines.push(`<TITLE>${escText(title)}</TITLE>`)
  lines.push(`<H1>${escText(title)}</H1>`)
  lines.push('<DL><p>')
  for (const c of root.children) serializeNode(c, 0, lines)
  lines.push('</DL><p>')
  return lines.join('\n') + '\n'
}

/** Export to a plain JSON structure (round-trippable via importJson). */
export function exportJson(root: BmNode): string {
  return JSON.stringify(root, null, 2)
}
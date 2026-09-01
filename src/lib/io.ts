import type { BmNode } from '../types'
import { exportNetscape, exportJson } from '../exporter/netscape'
import { parseFirefoxJson, looksLikeFirefoxJson } from '../parser/firefox'
import { looksLikeNetscape, parseNetscape } from '../parser/netscape'

export interface ImportOutcome {
  root: BmNode
  links: number
  folders: number
  droppedIcons: number
  format: 'netscape' | 'firefox-json' | 'bookmarks-json' | 'unknown'
}

export function importFromText(text: string, _fileName?: string): ImportOutcome {
  const head = text.slice(0, 2000)
  if (looksLikeNetscape(head)) {
    const r = parseNetscape(text)
    return { root: r.root, links: r.links, folders: r.folders, droppedIcons: r.droppedIcons, format: 'netscape' }
  }
  if (looksLikeFirefoxJson(text)) {
    const root = parseFirefoxJson(text)
    const { countNodes } = count(root)
    void countNodes
    return { root, links: countLinks(root), folders: countFolders(root), droppedIcons: 0, format: 'firefox-json' }
  }
  if (text.trim().startsWith('{')) {
    // internal JSON tree export
    try {
      const root = JSON.parse(text) as BmNode
      return { root, links: countLinks(root), folders: countFolders(root), droppedIcons: 0, format: 'bookmarks-json' }
    } catch {
      /* fallthrough */
    }
  }
  return { root: emptyRoot(), links: 0, folders: 0, droppedIcons: 0, format: 'unknown' }
}

export function emptyRoot(): BmNode {
  return { id: 'root', type: 'folder', name: '(root)', children: [] }
}

function countLinks(n: BmNode): number {
  let c = 0
  const walk = (x: BmNode) => {
    if (x.type === 'link') c++
    for (const ch of x.children) walk(ch)
  }
  walk(n)
  return c
}
function countFolders(n: BmNode): number {
  let c = 0
  const walk = (x: BmNode) => {
    if (x.type === 'folder' && x.id !== 'root' && x.name !== '(root)') c++
    for (const ch of x.children) walk(ch)
  }
  walk(n)
  return c
}
function count(n: BmNode): { countNodes: number } {
  let c = 0
  const walk = (x: BmNode) => {
    c++
    for (const ch of x.children) walk(ch)
  }
  walk(n)
  return { countNodes: c }
}

export function download(fileName: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadHtml(root: BmNode, fileName: string, title?: string): void {
  download(fileName ?? 'bookmarks.html', exportNetscape(root, title), 'text/html; charset=UTF-8')
}

export function downloadJson(root: BmNode, fileName: string): void {
  download(fileName ?? 'bookmarks.json', exportJson(root), 'application/json')
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(file, 'UTF-8')
  })
}
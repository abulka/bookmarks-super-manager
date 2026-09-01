import { useDnd, type DropMode, type DropTarget } from '../state/dnd'
import { useDocs } from '../state/docs'
import { initialOf } from './favicon'

export interface DragBegin {
  docId: string
  nodeIds: string[]
  sourceParentId: string
  label: string
  isFolder: boolean
  url?: string
}

const THRESHOLD = 5
const EDGE = 56

let active: {
  begin: DragBegin
  ghost: HTMLElement
  lastRow: HTMLElement | null
} | null = null
let raf = 0
let lastTargetKey = ''
let pending: { move: (e: MouseEvent) => void; up: (e: MouseEvent) => void; key: (e: KeyboardEvent) => void } | null = null

function dnd(): ReturnType<typeof useDnd> {
  return useDnd()
}

/** Build the floating drag ghost. */
function makeGhost(begin: DragBegin): HTMLElement {
  const g = document.createElement('div')
  g.className = 'drag-ghost'
  const icon = document.createElement('span')
  icon.className = 'ghost-tile'
  if (begin.isFolder) {
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h6l2 2h8v9H4z"/></svg>'
  } else {
    icon.textContent = initialOf(begin.label)
  }
  const label = document.createElement('span')
  label.className = 'ghost-name'
  label.textContent = begin.label
  g.appendChild(icon)
  g.appendChild(label)
  if (begin.nodeIds.length > 1) {
    const n = document.createElement('span')
    n.className = 'ghost-count'
    n.textContent = String(begin.nodeIds.length)
    g.appendChild(n)
  }
  document.body.appendChild(g)
  return g
}

function install(handlers: NonNullable<typeof pending>): void {
  clearPending()
  pending = handlers
  window.addEventListener('mousemove', handlers.move, { passive: false })
  window.addEventListener('mouseup', handlers.up)
  window.addEventListener('keydown', handlers.key)
}

function clearPending(): void {
  if (!pending) return
  window.removeEventListener('mousemove', pending.move)
  window.removeEventListener('mouseup', pending.up)
  window.removeEventListener('keydown', pending.key)
  pending = null
}

/**
 * Begin a possible pointer drag from a mousedown. A real drag only starts
 * after the pointer moves more than THRESHOLD px (so clicks and dblclicks
 * keep working untouched); until then nothing happens.
 */
export function prepareDrag(e: MouseEvent, begin: DragBegin, onDrop: (toFolderId: string, anchorId: string | null) => void): void {
  if (e.button !== 0) return
  const startX = e.clientX
  const startY = e.clientY
  let armed = false

  const move = (ev: MouseEvent) => {
    if (!armed) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return
      armed = true
      activate(ev)
    }
    if (!active) return
    ev.preventDefault()
    scheduleUpdate(ev)
  }
  const up = (ev: MouseEvent) => {
    clearPending()
    try {
      if (armed && active) {
        ev.preventDefault()
        finish(ev, onDrop)
      }
    } finally {
      deactivate()
    }
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    clearPending()
    deactivate()
  }
  install({ move, up, key })

  function activate(_ev: MouseEvent): void {
    if (!useDocs().byId(begin.docId)) return
    active = { begin, ghost: makeGhost(begin), lastRow: null }
    document.body.classList.add('bm-dragging')
    dnd().start({
      docId: begin.docId,
      nodeIds: begin.nodeIds,
      sourceParentId: begin.sourceParentId,
      isFolder: begin.isFolder,
    })
  }
}

function scheduleUpdate(ev: MouseEvent): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    updateDrag(ev)
  })
}

function updateDrag(ev: MouseEvent): void {
  if (!active) return
  active.ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 14}px)`
  const d = dnd()

  const hit = document.elementFromPoint(ev.clientX, ev.clientY)
  const row = hit?.closest?.('[data-dropid]') as HTMLElement | null
  if (!row) {
    d.setTarget(null)
    active.lastRow = null
    return
  }
  const id = row.getAttribute('data-dropid') || ''
  if (!id || active.begin.nodeIds.includes(id)) {
    d.setTarget(null)
    active.lastRow = null
    return
  }
  const parentId = row.getAttribute('data-dropparent') || ''
  const kind = row.getAttribute('data-dropkind') || 'link'
  const rect = row.getBoundingClientRect()
  const pct = (ev.clientY - rect.top) / rect.height
  let mode: DropMode
  // the root ("All bookmarks") row is an inside-only target: there is no
  // parent level above it to anchor before/after against
  if (kind === 'root') mode = 'inside'
  else if (kind === 'folder') mode = pct < 0.3 ? 'before' : pct > 0.7 ? 'after' : 'inside'
  else mode = pct < 0.5 ? 'before' : 'after'
  const anchorId = mode === 'inside' ? null : id
  active.lastRow = row
  setTargetSoon({ folderId: id, anchorId, mode, parentId })

  const scroller = (hit as Element | null)?.closest('.cl-scroll, .tree-scroll') as HTMLElement | null
  if (scroller) {
    const srect = scroller.getBoundingClientRect()
    const dy = ev.clientY < srect.top + EDGE ? -14 : ev.clientY > srect.bottom - EDGE ? 14 : 0
    if (dy) scroller.scrollTop += dy
  }
}

function setTargetSoon(t: DropTarget): void {
  const key = `${t.folderId}|${t.mode}|${t.anchorId ?? ''}`
  if (key === lastTargetKey) return
  lastTargetKey = key
  dnd().setTarget(t)
}

function finish(_ev: MouseEvent, onDrop: (toFolderId: string, anchorId: string | null) => void): void {
  const d = dnd()
  const t = d.target
  if (!t || !active) return
  const begin = active.begin
  if (!useDocs().byId(begin.docId)) return

  let toFolder: string
  let anchor: string | null
  if (t.mode === 'inside') {
    toFolder = t.folderId
    anchor = null
  } else {
    toFolder = t.parentId || t.folderId
    anchor = t.mode === 'before' ? t.folderId : nextSiblingId(active.lastRow)
  }
  // dropping back into the same folder at the end is a no-op
  if (toFolder === begin.sourceParentId && t.mode === 'inside' && t.folderId === begin.sourceParentId) {
    return
  }
  if (!toFolder) return
  onDrop(toFolder, anchor)
}

function nextSiblingId(row: HTMLElement | null): string | null {
  let el: Element | null = row
  while (el && (el = el.nextElementSibling)) {
    if (el.getAttribute('data-dropid')) return el.getAttribute('data-dropid')
  }
  return null
}

function deactivate(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  lastTargetKey = ''
  active?.ghost.remove()
  active = null
  document.body.classList.remove('bm-dragging')
  dnd().end()
}
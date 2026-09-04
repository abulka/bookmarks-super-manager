import { useDnd, type DropMode, type DropTarget } from '../state/dnd'
import { useDocs } from '../state/docs'
import { indexTree } from './tree'
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
    active = { begin, ghost: makeGhost(begin) }
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

  const hit = document.elementFromPoint(ev.clientX, ev.clientY)
  const row = hit?.closest?.('[data-dropid]') as HTMLElement | null
  if (!row) {
    clearTarget()
    return
  }
  const id = row.getAttribute('data-dropid') || ''
  if (!id || active.begin.nodeIds.includes(id)) {
    clearTarget()
    return
  }
  const parentId = row.getAttribute('data-dropparent') || ''
  const kind = row.getAttribute('data-dropkind') || 'link'
  const rect = row.getBoundingClientRect()
  const pct = (ev.clientY - rect.top) / rect.height
  let mode: DropMode
  let anchorRow: HTMLElement | null
  // the root ("All bookmarks") row is an inside-only target: there is no
  // parent level above it to anchor before/after against
  if (kind === 'root') {
    mode = 'inside'
    anchorRow = null
  } else if (kind === 'folder' && pct >= 0.3 && pct <= 0.7) {
    mode = 'inside'
    anchorRow = null
  } else if (kind === 'folder' ? pct < 0.3 : pct < 0.5) {
    mode = 'before'
    anchorRow = row
  } else {
    ;({ mode, anchorRow } = gapBelow(row, parentId))
  }
  // never hint at a drop that would change nothing: dropping back into the
  // source folder, or at a gap the selection already occupies, is a silent
  // no-op — showing a target there promises an effect that never happens
  if (mode === 'inside' && id === active.begin.sourceParentId) {
    clearTarget()
    return
  }
  if (mode === 'before' && anchorRow && gapAtCurrentSpot(anchorRow, parentId, active.begin.nodeIds)) {
    clearTarget()
    return
  }
  const anchorId = anchorRow?.getAttribute('data-dropid') ?? null
  setTargetSoon({ folderId: anchorId ?? id, anchorId, mode, parentId })

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

/** Clear the hover target and forget the dedup key so the next target applies. */
function clearTarget(): void {
  lastTargetKey = ''
  dnd().setTarget(null)
}

/**
 * The gap below a row is a single insertion point, so express it as 'before'
 * the next visible sibling (same data-dropparent) — "below A" and "above B"
 * become one target instead of two. Only the parent's last child keeps
 * 'after', which means append at the end of its parent folder.
 */
function gapBelow(row: HTMLElement, parentId: string): { mode: DropMode; anchorRow: HTMLElement | null } {
  let el: Element | null = row
  while ((el = el.nextElementSibling)) {
    if (!el.getAttribute('data-dropid')) continue
    // flattened tree rows: anything in between belongs to the row's own
    // subtree (different data-dropparent), so the first row sharing the
    // parent is exactly the next sibling
    if (el.getAttribute('data-dropparent') === parentId) return { mode: 'before', anchorRow: el as HTMLElement }
  }
  return { mode: 'after', anchorRow: null }
}

/**
 * True when dropping at the gap just above `anchorRow` would leave the dragged
 * selection exactly where it already is (so the gap is adjacent to it and the
 * drop is a silent no-op). Requires every dragged id to live in this parent —
 * a multi-folder selection always has something meaningful to move.
 */
function gapAtCurrentSpot(anchorRow: HTMLElement, parentId: string, dragged: string[]): boolean {
  const anchorId = anchorRow.getAttribute('data-dropid')
  if (!anchorId) return false
  // only same-parent selections can land a no-op gap; a multi-folder selection
  // always has something meaningful to move
  for (const id of dragged) {
    const r = document.querySelector(`[data-dropid="${id}"]`)
    if (!r || r.getAttribute('data-dropparent') !== parentId) return false
  }
  const draggedSet = new Set(dragged)
  // gap directly above a dragged row: the drop would re-drop the item on itself
  if (draggedSet.has(anchorId)) return true
  // walk up over consecutive dragged siblings; the block must be the selection
  let el: Element | null = anchorRow
  let covered = 0
  while ((el = el.previousElementSibling)) {
    if (el.getAttribute('data-dropparent') !== parentId) continue // subtree rows of preceding siblings
    const id = el.getAttribute('data-dropid')
    if (!id || !draggedSet.has(id)) break
    covered++
  }
  return covered === draggedSet.size
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
    // 'before' anchors on the row below the gap; 'after' appends at the end —
    // both land in the hovered row's parent folder. Never treat the anchor id
    // (a sibling row, not a folder) as the destination; an unresolvable parent
    // means the row was stale — ignore the drop instead of mis-filing it.
    toFolder = t.parentId || parentFolderOf(begin.docId, t.folderId)
    anchor = t.mode === 'before' ? t.folderId : null
  }
  // dropping back into the same folder at the end is a no-op
  if (toFolder === begin.sourceParentId && t.mode === 'inside' && t.folderId === begin.sourceParentId) {
    return
  }
  if (!toFolder) return
  onDrop(toFolder, anchor)
}

/** Real parent folder of a node id in the doc's tree ('' when unknown). */
function parentFolderOf(docId: string, id: string): string {
  const doc = useDocs().byId(docId)
  if (!doc) return ''
  return indexTree(doc.root).parentOf.get(id)?.id ?? ''
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
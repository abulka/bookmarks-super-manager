import { defineStore } from 'pinia'
import { useDocs } from './docs'
import { useUi } from './ui'
import { findNode, indexTree, isDescendant, namePath } from '../lib/tree'
import { applyRemove, restoreRemove } from '../lib/mutations'

export type ClipMode = 'cut' | 'copy'

/** One transfer unit: `ids` are direct children of `parentId` in the source doc. */
export interface TransferGroup {
  parentId: string
  ids: string[]
}

/**
 * A just-performed same-file *copy* paste. The UI uses this to offer a
 * one-click conversion: the pasted clones are removed and the originals are
 * moved into the target folder instead (i.e. "undo the duplicate, move the
 * originals"). `groups` are the resolved source parents of the copy.
 */
export interface LastCopyPaste {
  tgtDocId: string
  tgtFolderId: string
  groups: TransferGroup[]
  /** the fresh ids this paste inserted into tgtFolderId */
  cloneIds: string[]
}

/**
 * Cut/copy/paste state, scoped to a source document. Transient by design: a
 * transfer that survives a reload would only confuse. A transfer may span
 * multiple source parents (e.g. a ⇧-range selection of tree folders); each
 * group is moved/duplicated with its own source folder in one undo step.
 * Pasting into the *same* document moves/duplicates within it; pasting into
 * a *different* document copies the subtrees (with fresh ids) into the
 * target — a cut removes them from the source.
 */
export const useClipboard = defineStore('clipboard', {
  state: () => ({
    srcDocId: null as string | null,
    groups: [] as TransferGroup[],
    mode: 'cut' as ClipMode,
    lastPaste: null as LastCopyPaste | null,
  }),
  getters: {
    has(state): boolean {
      return state.srcDocId !== null && state.groups.length > 0
    },
    active(state): boolean {
      return state.srcDocId !== null
    },
    /** flat list of every captured id, in capture order */
    ids(state): string[] {
      return state.groups.flatMap((g) => g.ids)
    },
    /** source folder of the first group ('' when the clipboard is empty) */
    srcParentId(state): string | null {
      return state.groups[0]?.parentId ?? null
    },
    /** human-readable source of the transfer, e.g. "Favs › Dev" ('' when empty) */
    sourcePath(state): string {
      if (!state.srcDocId || !state.groups.length) return ''
      const doc = useDocs().byId(state.srcDocId)
      if (!doc) return ''
      const first = state.groups[0]!
      const src = findNode(doc.root, first.parentId)
      const path = src && src.id !== doc.root.id ? namePath(doc.root, first.parentId).join(' › ') : doc.root.name
      return state.groups.length > 1 ? `${path} (+${state.groups.length - 1} more)` : path
    },
    /** what is on the clipboard, e.g. `2 items`, `Folder “Favs”` */
    summary(state): string {
      const doc = state.srcDocId ? useDocs().byId(state.srcDocId) : undefined
      if (!doc) return ''
      const ids = state.groups.flatMap((g) => g.ids)
      if (ids.length === 1) {
        const n = findNode(doc.root, ids[0])
        if (n) return n.type === 'folder' ? `Folder “${n.name}”` : `“${n.name}”`
      }
      return `${ids.length} item${ids.length === 1 ? '' : 's'}`
    },
  },
  actions: {
    /** capture a single-parent transfer (list items or one tree folder) */
    capture(docId: string, ids: string[], srcParentId: string, mode: ClipMode): void {
      this.captureGroups(docId, [{ parentId: srcParentId, ids }], mode)
    },
    /** capture a transfer that may span several source folders (grouped) */
    captureGroups(docId: string, groups: TransferGroup[], mode: ClipMode): void {
      const clean = groups.filter((g) => g.ids.length)
      this.srcDocId = docId
      this.groups = clean.map((g) => ({ parentId: g.parentId, ids: [...g.ids] }))
      this.mode = mode
      this.lastPaste = null
      console.debug(`[clipboard] ${mode} ${this.ids.length} from ${clean.length} parent(s) (${docId})`)
    },
    clear(): void {
      this.srcDocId = null
      this.groups = []
      this.lastPaste = null
    },
    /** capture the currently selected items of a doc's visible folder for a move; returns the count */
    cutSelection(docId: string): number {
      return this.captureVisible(docId, 'cut')
    },
    /** capture the currently selected items of a doc's visible folder for duplication; returns the count */
    copySelection(docId: string): number {
      return this.captureVisible(docId, 'copy')
    },
    /** shared: the toolbar acts on the visible folder's selection; with nothing
     *  (valid) selected it falls back to the folder being viewed itself */
    captureVisible(docId: string, mode: ClipMode): number {
      const doc = useDocs().byId(docId)
      const folder = doc ? findNode(doc.root, doc.currentFolderId) : null
      if (!doc || !folder || folder.type !== 'folder') return 0
      // the list keeps a sticky selection across folder navigation; capture only
      // what belongs to the folder being displayed, or the clipboard would point
      // at a parent that does not contain the captured ids
      const ids = doc.selected.filter((id) => folder.children.some((c) => c.id === id))
      if (ids.length) {
        this.capture(doc.id, ids, folder.id, mode)
        return ids.length
      }
      // nothing selected in this folder → act on the folder itself
      if (folder.id === doc.root.id) return 0 // top level ("All bookmarks") can't be cut/copied as a unit
      const { parentOf } = indexTree(doc.root)
      const parent = parentOf.get(folder.id)
      if (!parent || parent.type !== 'folder') return 0
      this.capture(doc.id, [folder.id], parent.id, mode)
      return 1
    },
    /** paste into the doc's current folder, before its first selected row if any; returns moved/duplicated count */
    pasteCurrent(docId: string): number {
      const doc = useDocs().byId(docId)
      if (!doc) return 0
      const sel = doc.selected[0] ?? null
      const anchor = this.mode === 'cut' && sel && this.ids.includes(sel) ? null : sel
      return this.pasteInto(docId, doc.currentFolderId, anchor)
    },
    /**
     * Transfer the stored items into a folder of tgtDocId (before `anchorId`
     * or appended). Same-doc cut keeps the fast in-document move; anything
     * else (same-doc copy, cross-doc copy/cut) clones with fresh ids. One
     * undo step covers all source groups.
     * Returns the number of items transferred (0 = nothing happened; the
     * clipboard survives refusals, and is only cleared when it has been
     * consumed or its sources are gone).
     */
    pasteInto(tgtDocId: string, folderId: string, anchorId: string | null): number {
      const docs = useDocs()
      if (!this.srcDocId) return 0
      const srcDoc = docs.byId(this.srcDocId)
      const tgtDoc = docs.byId(tgtDocId)
      if (!srcDoc || !tgtDoc) return 0

      // resolve every group against its parent, dropping ids that vanished
      const groups: TransferGroup[] = []
      for (const g of this.groups) {
        const src = g.parentId ? findNode(srcDoc.root, g.parentId) : null
        if (!src || src.type !== 'folder') continue
        const ids = g.ids.filter((id) => src.children.some((c) => c.id === id))
        if (ids.length) groups.push({ parentId: g.parentId, ids })
      }
      if (!groups.length) {
        this.clear()
        return 0
      }
      const tgt = findNode(tgtDoc.root, folderId)
      if (!tgt || tgt.type !== 'folder') return 0
      const anchor = anchorId && !this.ids.includes(anchorId) ? anchorId : null
      const allIds = groups.flatMap((g) => g.ids)

      // a transfer can't land inside one of its own (or a descendant's)
      // subtrees — refusing keeps the clipboard so the paste can be retried
      if (this.srcDocId === tgtDocId && allIds.some((id) => id === folderId || isDescendant(srcDoc.root, id, folderId))) return 0
      console.debug(`[clipboard] paste ${this.mode} ${allIds.length} → ${tgtDocId}/${folderId} anchor:${anchor ?? 'end'}`)

      const u = docs.undoOf(tgtDocId)
      const sameDocCopy = this.mode === 'copy' && this.srcDocId === tgtDocId
      let record: LastCopyPaste | null = null
      if (this.mode === 'cut' && this.srcDocId === tgtDocId) {
        // fast in-document move (keeps original ids)
        u.group('Move', () => {
          for (const g of groups) docs.mutMove(this.srcDocId!, g.parentId, g.ids, folderId, anchor)
        })
      } else if (this.mode === 'cut') {
        u.group('Move', () => {
          for (const g of groups) docs.cutInto(this.srcDocId!, g.parentId, g.ids, tgtDocId, folderId, anchor)
        })
      } else {
        // a copy that lands back in its own file duplicates — record it so the
        // UI can offer to convert the paste into a move instead
        const beforeIds = new Set(tgt.children.map((c) => c.id))
        u.group('Paste', () => {
          for (const g of groups) docs.copyInto(this.srcDocId!, g.parentId, g.ids, tgtDocId, folderId, anchor)
        })
        if (sameDocCopy) {
          const cloneIds = tgt.children.filter((c) => !beforeIds.has(c.id)).map((c) => c.id)
          if (cloneIds.length) {
            record = {
              tgtDocId,
              tgtFolderId: folderId,
              groups: groups.map((g) => ({ parentId: g.parentId, ids: [...g.ids] })),
              cloneIds,
            }
          }
        }
      }
      this.clear()
      if (record) {
        this.lastPaste = record
        useUi().notify(
          'info',
          `Duplicated ${record.cloneIds.length} item${record.cloneIds.length === 1 ? '' : 's'} in this file — move the originals instead?`,
          { label: 'Move instead', onClick: () => void this.convertCopyPasteToMove() },
          12000
        )
      }
      return allIds.length
    },

    /**
     * Turn the last same-file copy paste into a move: the pasted clones are
     * removed and the originals are relocated into the target folder. The
     * pending 'Paste' step is consumed first so the whole paste-then-correct
     * sequence collapses into ONE undo step — undoing it lands straight back
     * on the pre-paste state, with no leftover duplicate.
     * Returns the number of clones converted (0 when no record).
     */
    convertCopyPasteToMove(): number {
      const rec = this.lastPaste
      if (!rec) return 0
      const docs = useDocs()
      const doc = docs.byId(rec.tgtDocId)
      if (!doc) {
        this.lastPaste = null
        return 0
      }
      const tgt = findNode(doc.root, rec.tgtFolderId)
      if (!tgt) {
        this.lastPaste = null
        return 0
      }
      const n = rec.cloneIds.length
      const u = docs.undoOf(rec.tgtDocId)
      // The 'Paste' step that created the clones is the top of the stack.
      // Undoing it puts the originals back in their source — exactly the
      // state before the paste — so the correction below needs no leftover
      // cleanup on its own undo. (If anything else sits on top, keep the old
      // explicit-clone-removal fallback so we never undo the wrong step.)
      const consumed = u.undoLabel === 'Paste'
      if (consumed) u.undo()

      u.group('Move instead', () => {
        if (!consumed && n) {
          const captured = applyRemove(tgt, rec.cloneIds)
          u.push({
            label: 'Remove duplicates',
            undo: () => restoreRemove(tgt, captured),
            redo: () => applyRemove(tgt, rec.cloneIds),
          })
        }
        for (const g of rec.groups) {
          if (g.parentId === rec.tgtFolderId) continue
          const src = findNode(doc.root, g.parentId)
          if (!src || src.type !== 'folder') continue
          docs.mutMove(rec.tgtDocId, g.parentId, g.ids, rec.tgtFolderId, null)
        }
      })
      this.lastPaste = null
      return n
    },
  },
})
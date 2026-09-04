import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { BookmarkDoc, BmNode, DocView, Stats } from '../types'
import { uid } from '../lib/id'
import { readFileAsText, importFromText } from '../lib/io'
import { findDuplicates, findNode, indexTree, isDescendant, sortFolder, walk } from '../lib/tree'
import { applyMove, applyRemove, cloneNodes, indexOf, restoreRemove } from '../lib/mutations'
import { rewriteUrl } from '../lib/urlrewrite'
import { UndoStack } from './undo'
import { isChromeExt, clearBaseline } from '../lib/backend/chrome'

const WORKSPACES_KEY = 'bm.workspace.v1'
const DOC_PREFIX = 'bm.doc.v1.'

// Undo stacks live OUTSIDE the reactive store: creating one lazily inside a
// computed (`undoStack` in App.vue) would mutate reactive state during render
// and can drive a re-render loop.
const undoStacks = new Map<string, UndoStack>()

const SKULL = '❌'
const DEAD_MARK = new RegExp(`\\s*[❌☠]`)

interface WorkspaceMeta {
  tabs: string[]
  activeDocId: string | null
}

export interface DocStats extends Stats {}

type FullStats = DocStats & { dupMembers: number }

export const useDocs = defineStore('docs', {
  state: () => ({
    docs: [] as BookmarkDoc[],
    tabs: [] as string[],
    activeDocId: null as string | null,
    initialised: false,
    /** incremented on every tree mutation so light computeds can depend on it */
    treeVersion: 0,
    _saveTimers: {} as Record<string, ReturnType<typeof setTimeout>>,
  }),
  getters: {
    activeDoc(): BookmarkDoc | null {
      return this.docs.find((d) => d.id === this.activeDocId) ?? null
    },
    hasDocs(): boolean {
      return this.docs.length > 0
    },
  },
  actions: {
    byId(id: string): BookmarkDoc | undefined {
      return this.docs.find((d) => d.id === id)
    },
    undoOf(docId: string): UndoStack {
      let s = undoStacks.get(docId)
      if (!s) {
        s = new UndoStack()
        undoStacks.set(docId, s)
      }
      return s
    },

    touch(docId: string, dirty = true): void {
      this.treeVersion++
      const doc = this.byId(docId)
      if (doc && dirty) doc.dirty = true
      // the live Chrome doc is ephemeral — never schedule an IndexedDB save
      if (!doc || doc.ephemeral) return
      const t = this._saveTimers[docId]
      if (t) clearTimeout(t)
      this._saveTimers[docId] = setTimeout(() => this.saveDoc(docId), 400)
    },

    /** the document's content is now safe on disk (exported); drop the dirty flag */
    markExported(docId: string): void {
      const doc = this.byId(docId)
      if (doc) doc.dirty = false
    },

    /** Fire every pending debounced IndexedDB save now (page hide / unload). */
    flushSaves(): void {
      for (const docId of Object.keys(this._saveTimers)) {
        clearTimeout(this._saveTimers[docId])
        delete this._saveTimers[docId]
        void this.saveDoc(docId)
      }
    },

    /** force-recompute light dependents (used after undo/redo). */
    bump(): void {
      this.treeVersion++
    },

    /** Cancel all pending debounced IndexedDB saves (used in tests/teardown). */
    dispose(): void {
      for (const k of Object.keys(this._saveTimers)) {
        clearTimeout(this._saveTimers[k])
        delete this._saveTimers[k]
      }
      undoStacks.clear()
    },

    // ---- document lifecycle -------------------------------------------------
    async init(): Promise<void> {
      if (this.initialised) return
      try {
        const meta = (await idbGet(WORKSPACES_KEY)) as WorkspaceMeta | undefined
        if (meta && meta.tabs.length) {
          const docs: BookmarkDoc[] = []
          for (const id of meta.tabs) {
            const d = (await idbGet(DOC_PREFIX + id)) as BookmarkDoc | undefined
            if (d) {
              this.prepareDoc(d)
              docs.push(d)
            }
          }
          this.docs = docs
          this.tabs = docs.map((d) => d.id)
          this.activeDocId = meta.activeDocId && this.tabs.includes(meta.activeDocId) ? meta.activeDocId : this.tabs[0] ?? null
        }
      } catch {
        /* corrupted storage: start fresh */
      }
      this.initialised = true
      // in the extension, the live Chrome doc is always opened fresh from
      // chrome.bookmarks — never from a stored snapshot
      if (isChromeExt()) {
        try {
          await this.openChromeDoc(!this.docs.length)
        } catch {
          /* bookmarks API unavailable — plain extension session */
        }
      }
    },

    prepareDoc(doc: BookmarkDoc): void {
      if (!doc.selected) doc.selected = []
      if (!doc.treeSel) doc.treeSel = []
      if (!doc.collapsed) doc.collapsed = {}
      if (!doc.revealRev) doc.revealRev = 0
      if (!doc.lastRevealAt) doc.lastRevealAt = 0
      if (doc.dirty === undefined) doc.dirty = false
      if (!doc.root) doc.root = { id: uid(), type: 'folder', name: '(root)', children: [] }
    },

    /** Collapse every folder so large libraries don't render fully open on first view. */
    collapseAllClosed(root: BmNode): Record<string, boolean> {
      const c: Record<string, boolean> = {}
      for (const n of walk(root)) if (n.type === 'folder') c[n.id] = true
      return c
    },

    async saveDoc(docId: string): Promise<void> {
      const doc = this.byId(docId)
      if (!doc || doc.ephemeral) return
      // strip reactivity + deep-copy from the RAW tree: JSON.stringify of a
      // reactive Pinia proxy walks getters for every node, which is ~10-50x
      // slower than the plain object on large libraries
      await idbSet(DOC_PREFIX + docId, JSON.parse(JSON.stringify(toRaw(doc))))
    },

    async persistWorkspace(): Promise<void> {
      // ephemeral docs (the live Chrome tab) must never be part of the
      // persisted workspace, so a stale snapshot can never be restored
      const tabs = this.tabs.filter((id) => !this.byId(id)?.ephemeral)
      const activeDocId = this.activeDocId && this.byId(this.activeDocId)?.ephemeral ? null : this.activeDocId
      await idbSet(WORKSPACES_KEY, JSON.parse(JSON.stringify({ tabs, activeDocId })))
    },

    addDoc(doc: BookmarkDoc): string {
      this.prepareDoc(doc)
      this.docs.push(doc)
      this.tabs.push(doc.id)
      this.activeDocId = doc.id
      this.saveDoc(doc.id)
      this.persistWorkspace()
      return doc.id
    },

    newBlankDoc(): string {
      const created = Math.floor(Date.now() / 1000)
      const toolbar: BmNode = {
        id: uid(),
        type: 'folder',
        name: 'Bookmarks bar',
        addDate: created,
        attrs: { PERSONAL_TOOLBAR_FOLDER: 'true' },
        children: [],
      }
      // modern Chrome has no "Other bookmarks" folder — everything that isn't
      // in the bar lives directly under "All bookmarks" (the root)
      const doc: BookmarkDoc = {
        id: uid(),
        fileName: `bookmarks ${new Date().toISOString().slice(0, 10)}.html`,
        title: 'Bookmarks',
        importedAt: Date.now(),
        root: { id: uid(), type: 'folder', name: '(root)', children: [toolbar] },
        view: 'home',
        currentFolderId: toolbar.id,
        collapsed: { [toolbar.id]: false },
        selected: [],
        treeSel: [],
        searchQuery: '',
        revealRev: 0,
        lastRevealAt: 0,
      }
      // a blank doc has no file on disk yet — closing it without exporting loses it
      doc.dirty = true
      return this.addDoc(doc)
    },

    async openFiles(files: File[]): Promise<number> {
      let n = 0
      for (const file of files) {
        try {
          const text = await readFileAsText(file)
          this.openFromText(text, file.name)
          n++
        } catch (e) {
          console.error('Failed to open', file.name, e)
        }
      }
      return n
    },

    openFromText(text: string, fileName: string): string {
      const out = importFromText(text, fileName)
      if (out.format === 'unknown') return ''
      const root = out.root
      const collapsed = this.collapseAllClosed(root)
      if (root.children[0]) collapsed[root.children[0].id] = false
      const doc: BookmarkDoc = {
        id: uid(),
        fileName,
        title: fileName.replace(/\.(html|htm|json)$/i, ''),
        importedAt: Date.now(),
        root,
        view: 'home',
        currentFolderId: root.children[0]?.id ?? root.id,
        collapsed,
        selected: [],
        treeSel: [],
        searchQuery: '',
        revealRev: 0,
        lastRevealAt: 0,
      }
      // start with toolbar folder expanded
      return this.addDoc(doc)
    },

    async openChromeDoc(activate = true): Promise<string> {
      const { fetchChromeTree, setBaseline, CHROME_DOC_ID, chromeRootToNode } = await import('../lib/backend/chrome')
      if (this.byId(CHROME_DOC_ID)) {
        if (activate) this.activeDocId = CHROME_DOC_ID
        this.persistWorkspace()
        return CHROME_DOC_ID
      }
      const tree = await fetchChromeTree()
      const root = chromeRootToNode(tree)
      const collapsed = this.collapseAllClosed(root)
      if (root.children[0]) collapsed[root.children[0].id] = false
      const doc: BookmarkDoc = {
        id: CHROME_DOC_ID,
        fileName: 'chrome bookmarks',
        title: 'Chrome bookmarks',
        importedAt: Date.now(),
        root,
        view: 'home',
        currentFolderId: root.children[0]?.id ?? root.id,
        collapsed,
        selected: [],
        treeSel: [],
        searchQuery: '',
        revealRev: 0,
        lastRevealAt: 0,
        ephemeral: true,
        dirty: false,
      }
      this.prepareDoc(doc)
      this.docs.push(doc)
      this.tabs.push(doc.id)
      if (activate) this.activeDocId = doc.id
      setBaseline(doc.id, tree)
      this.persistWorkspace()
      return doc.id
    },

    /**
     * Rebuild the live Chrome doc from a fresh chrome tree (external changes
     * detected, or an explicit reload). Local edits are discarded: the undo
     * stack is cleared and the dirty flag reset. UI state (collapsed folders)
     * survives for ids that still exist.
     */
    replaceChromeRoot(docId: string, root: BmNode): void {
      const doc = this.byId(docId)
      if (!doc || !doc.ephemeral) return
      doc.root = root
      doc.collapsed = this.collapseAllClosed(root)
      if (root.children[0]) doc.collapsed[root.children[0].id] = false
      doc.selected = []
      doc.treeSel = []
      if (!findNode(root, doc.currentFolderId)) doc.currentFolderId = root.children[0]?.id ?? root.id
      this.undoOf(docId).clear()
      doc.dirty = false
      this.bump()
    },

    closeDoc(docId: string): void {
      const doc = this.byId(docId)
      const i = this.tabs.indexOf(docId)
      this.docs = this.docs.filter((d) => d.id !== docId)
      this.tabs = this.tabs.filter((t) => t !== docId)
      undoStacks.delete(docId)
      if (this.activeDocId === docId) {
        const next = this.tabs[Math.max(0, i - 1)] ?? this.tabs[0] ?? null
        this.activeDocId = next
      }
      if (doc && !doc.ephemeral) void idbDel(DOC_PREFIX + docId)
      else clearBaseline(docId)
      void this.persistWorkspace()
    },

    duplicateDoc(docId: string): string {
      const doc = this.byId(docId)
      if (!doc) return ''
      const copy: BookmarkDoc = JSON.parse(JSON.stringify(doc))
      copy.id = uid()
      copy.ephemeral = false // a duplicate is a standalone snapshot, persisted like any file doc
      copy.fileName = doc.fileName.replace(/\.html$/, '') + '-copy.html'
      copy.collapsed = {}
      copy.selected = []
      copy.searchQuery = ''
      copy.view = 'manager'
      this.prepareDoc(copy)
      this.addDoc(copy)
      return copy.id
    },

    activate(docId: string): void {
      this.activeDocId = docId
      this.persistWorkspace()
    },

    renameDoc(docId: string, name: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      doc.fileName = name.replace(/\.(html|htm|json)$/i, '') || name
      doc.title = doc.fileName.replace(/\.(html|htm|json)$/i, '')
      this.saveDoc(docId)
    },

    // ---- navigation / view --------------------------------------------------
    setView(docId: string, view: DocView): void {
      const doc = this.byId(docId)
      if (!doc) return
      doc.view = view
    },
    setCurrentFolder(docId: string, folderId: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      doc.currentFolderId = folderId
      doc.view = 'manager'
    },
    setSearch(docId: string, q: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      doc.searchQuery = q
      if (q.trim()) doc.view = 'search'
    },
    toggleCollapse(docId: string, folderId: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      doc.collapsed[folderId] = !doc.collapsed[folderId]
      this.touch(docId, false)
      this.persistWorkspace()
    },
    setCollapsed(docId: string, folderId: string, collapsed: boolean): void {
      const doc = this.byId(docId)
      if (!doc) return
      doc.collapsed[folderId] = collapsed
    },
    expandAll(docId: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      for (const n of walk(doc.root)) if (n.type === 'folder') doc.collapsed[n.id] = false
      doc.collapsed[doc.root.id] = false
      this.touch(docId, false)
    },
    collapseAll(docId: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      for (const n of walk(doc.root)) if (n.type === 'folder') doc.collapsed[n.id] = true
      doc.collapsed[doc.root.id] = true
      this.touch(docId, false)
    },

    select(docId: string, ids: string[], additive: boolean): void {
      const doc = this.byId(docId)
      if (!doc) return
      if (additive) {
        const set = new Set(doc.selected)
        for (const id of ids) (set.has(id) ? set.delete(id) : set.add(id))
        doc.selected = [...set]
      } else {
        doc.selected = [...ids]
      }
    },
    clearSelection(docId: string): void {
      const doc = this.byId(docId)
      if (doc) doc.selected = []
    },

    revealPath(docId: string, nodeId: string, parentId?: string): void {
      const doc = this.byId(docId)
      if (!doc) return
      const { parentOf } = indexTree(doc.root)
      let cur = parentId ?? parentOf.get(nodeId)?.id
      let hops = 0
      // hop cap: legacy docs with duplicate ids can cycle the parent map
      while (cur && cur !== doc.root.id && parentOf.has(cur) && hops++ < 10000) {
        doc.collapsed[cur] = false
        cur = parentOf.get(cur)?.id
      }
      if (parentId) {
        doc.currentFolderId = parentId
      } else {
        const p = parentOf.get(nodeId)
        if (p) doc.currentFolderId = p.id
      }
      doc.selected = [nodeId]
      doc.view = 'manager'
      doc.revealRev = (doc.revealRev ?? 0) + 1
      doc.lastRevealAt = Date.now()
      this.persistWorkspace()
    },

    // ---- mutation helpers ---------------------------------------------------
    privateUndo(docId: string): UndoStack {
      return this.undoOf(docId)
    },
    mutRename(docId: string, id: string, name: string): void {
      const doc = this.byId(docId)
      const n = doc && findNode(doc.root, id)
      if (!doc || !n) return
      const old = n.name
      if (old === name) return
      // renaming while stripping the dead marker also revives the bookmark
      const wasDead = !!n.dead
      const stripped = wasDead && !name.includes(SKULL) && !name.includes('☠')
      n.name = name
      if (stripped) n.dead = false
      this.undoOf(docId).push({
        label: 'Rename',
        undo: () => {
          n!.name = old
          if (stripped) n!.dead = true
        },
        redo: () => {
          n!.name = name
          if (stripped) n!.dead = false
        },
      })
      this.touch(docId)
    },
    mutSetUrl(docId: string, id: string, url: string): void {
      const doc = this.byId(docId)
      const n = doc && findNode(doc.root, id)
      if (!doc || !n || n.type !== 'link') return
      const old = n.url ?? ''
      n.url = url
      this.undoOf(docId).push({
        label: 'Edit URL',
        undo: () => (n!.url = old),
        redo: () => (n!.url = url),
      })
      this.touch(docId)
    },
    mutClearDead(docId: string, id: string): void {
      const doc = this.byId(docId)
      const n = doc && findNode(doc.root, id)
      if (!doc || !n) return
      const had = n.dead
      const oldName = n.name
      n.dead = false
      n.name = n.name.replace(DEAD_MARK, '')
      this.undoOf(docId).push({
        label: 'Restore',
        undo: () => {
          n!.dead = had
          n!.name = oldName
        },
        redo: () => {
          n!.dead = false
          n!.name = n!.name.replace(DEAD_MARK, '')
        },
      })
      this.touch(docId)
    },
    mutCreateFolder(docId: string, parentId: string, name: string, index?: number): string {
      const doc = this.byId(docId)
      const p = doc && findNode(doc.root, parentId)
      if (!doc || !p || p.type !== 'folder') return ''
      const node: BmNode = { id: uid(), type: 'folder', name: name || 'New folder', addDate: Math.floor(Date.now() / 1000), children: [] }
      const at = index ?? p.children.length
      p.children.splice(at, 0, node)
      const u = this.undoOf(docId)
      u.push({
        label: 'New folder',
        undo: () => {
          const i = indexOf(p, node.id)
          if (i >= 0) p.children.splice(i, 1)
        },
        redo: () => {
          if (!p.children.includes(node)) p.children.splice(at, 0, node)
        },
      })
      this.touch(docId)
      return node.id
    },
    mutCreateLink(docId: string, parentId: string, name: string, url: string, index?: number): string {
      const doc = this.byId(docId)
      const p = doc && findNode(doc.root, parentId)
      if (!doc || !p || p.type !== 'folder') return ''
      const node: BmNode = { id: uid(), type: 'link', name: name || url || 'Untitled', url, addDate: Math.floor(Date.now() / 1000), children: [] }
      const at = index ?? p.children.length
      p.children.splice(at, 0, node)
      const u = this.undoOf(docId)
      u.push({
        label: 'New bookmark',
        undo: () => {
          const i = indexOf(p, node.id)
          if (i >= 0) p.children.splice(i, 1)
        },
        redo: () => {
          if (!p.children.includes(node)) p.children.splice(at, 0, node)
        },
      })
      this.touch(docId)
      return node.id
    },
    mutDelete(docId: string, ids: string[]): void {
      const doc = this.byId(docId)
      if (!doc || !ids.length) return
      const { parentOf } = indexTree(doc.root)
      // group by parent
      const groups = new Map<string, string[]>()
      for (const id of ids) {
        const p = parentOf.get(id)
        if (p) {
          const arr = groups.get(p.id) ?? []
          arr.push(id)
          groups.set(p.id, arr)
        }
      }
      const u = this.undoOf(docId)
      u.group('Delete', () => {
        for (const [pid, list] of groups) {
          const p = findNode(doc.root, pid)
          if (!p) continue
          const captured = applyRemove(p, list)
          u.push({
            label: 'Delete',
            undo: () => restoreRemove(p, captured),
            redo: () => applyRemove(p, list),
          })
        }
      })
      this.clearSelection(docId)
      this.touch(docId)
    },
    mutMove(docId: string, sourceParentId: string, ids: string[], targetParentId: string, anchorId: string | null): void {
      const doc = this.byId(docId)
      if (!doc || !ids.length) return
      const src = findNode(doc.root, sourceParentId)
      const tgt = findNode(doc.root, targetParentId)
      if (!src || !tgt || src.type !== 'folder' || tgt.type !== 'folder') return
      for (const id of ids) {
        if (id === tgt.id || isDescendant(doc.root, id, tgt.id)) return // cannot drop into itself or its own subtree
      }
      if (src === tgt && ids.includes(anchorId ?? '')) return
      const nodeSet = new Set(ids)
      // reconstruct original order + successors for a perfect reverse
      const orderedNodes = src.children.filter((c) => nodeSet.has(c.id))
      const ordered = orderedNodes.map((c) => c.id)
      const successorOf = new Map<string, string | null>()
      for (let i = 0; i < src.children.length; i++) {
        const c = src.children[i]
        if (!nodeSet.has(c.id)) continue
        let s: string | null = null
        for (let j = i + 1; j < src.children.length; j++) {
          if (!nodeSet.has(src.children[j].id)) {
            s = src.children[j].id
            break
          }
        }
        successorOf.set(c.id, s)
      }
      applyMove(src, ids, tgt, anchorId)
      const u = this.undoOf(docId)
      u.push({
        label: 'Move',
        undo: () => {
          for (let i = tgt.children.length - 1; i >= 0; i--) if (nodeSet.has(tgt.children[i].id)) tgt.children.splice(i, 1)
          for (const n of orderedNodes) {
            const s = successorOf.get(n.id) ?? null
            if (s) {
              const i = src.children.findIndex((c) => c.id === s)
              if (i >= 0) src.children.splice(i, 0, n)
              else src.children.push(n)
            } else {
              src.children.push(n)
            }
          }
        },
        redo: () => applyMove(src, ordered, tgt, anchorId),
      })
      this.touch(docId)
    },
    mutSort(docId: string, folderId: string, by: 'name' | 'url' | 'added'): void {
      const doc = this.byId(docId)
      const p = doc && findNode(doc.root, folderId)
      if (!doc || !p || p.type !== 'folder') return
      const before = p.children.map((c) => c.id)
      const order = sortFolder(p.children, by)
      const sortedIds = order.map((c) => c.id)
      p.children = order
      const u = this.undoOf(docId)
      u.push({
        label: `Sort by ${by}`,
        undo: () => {
          p.children = before
            .map((id) => p.children.find((c) => c.id === id))
            .filter((c): c is BmNode => !!c)
        },
        redo: () => {
          p.children = sortedIds
            .map((id) => p.children.find((c) => c.id === id))
            .filter((c): c is BmNode => !!c)
        },
      })
      this.touch(docId)
    },

    // ---- cross-document transfer -------------------------------------------
    /**
     * Clone `ids` (children of `sourceParentId` in srcDoc) into a folder of
     * tgtDoc, before `anchorId` or appended. Source is untouched. The undo
     * entry lives in the target document's stack.
     */
    copyInto(srcDocId: string, sourceParentId: string, ids: string[], tgtDocId: string, folderId: string, anchorId: string | null): number {
      const srcDoc = this.byId(srcDocId)
      const tgtDoc = this.byId(tgtDocId)
      if (!srcDoc || !tgtDoc) return 0
      const src = findNode(srcDoc.root, sourceParentId)
      const tgt = findNode(tgtDoc.root, folderId)
      if (!src || !tgt || src.type !== 'folder' || tgt.type !== 'folder') return 0
      if (srcDoc === tgtDoc) {
        // duplicates can't land inside the subtree being copied
        for (const id of ids) if (id === folderId || isDescendant(srcDoc.root, id, folderId)) return 0
      }
      const nodes = ids.map((id) => src.children.find((c) => c.id === id)).filter((n): n is BmNode => !!n)
      if (!nodes.length) return 0
      const clones = cloneNodes(nodes)
      const anchorIdx = anchorId ? tgt.children.findIndex((c) => c.id === anchorId) : -1
      const at = anchorIdx === -1 ? tgt.children.length : anchorIdx
      tgt.children.splice(at, 0, ...clones)
      const u = this.undoOf(tgtDocId)
      const cloneIds = clones.map((c) => c.id)
      const removeClones = () => {
        for (let i = tgt.children.length - 1; i >= 0; i--) if (cloneIds.includes(tgt.children[i].id)) tgt.children.splice(i, 1)
      }
      u.push({
        label: 'Paste',
        undo: removeClones,
        redo: () => tgt.children.splice(Math.min(at, tgt.children.length), 0, ...clones),
      })
      this.touch(tgtDocId)
      return nodes.length
    },

    /**
     * Move `ids` (children of `sourceParentId` in srcDoc) into a folder of
     * tgtDoc. Copies land in the target with fresh ids; the originals are
     * removed from the source. One undo step (in the target's stack) restores
     * both documents.
     */
    cutInto(srcDocId: string, sourceParentId: string, ids: string[], tgtDocId: string, folderId: string, anchorId: string | null): number {
      const srcDoc = this.byId(srcDocId)
      const tgtDoc = this.byId(tgtDocId)
      if (!srcDoc || !tgtDoc) return 0
      const src = findNode(srcDoc.root, sourceParentId)
      const tgt = findNode(tgtDoc.root, folderId)
      if (!src || !tgt || src.type !== 'folder' || tgt.type !== 'folder') return 0
      const nodes = ids.map((id) => src.children.find((c) => c.id === id)).filter((n): n is BmNode => !!n)
      if (!nodes.length) return 0
      const clones = cloneNodes(nodes)
      const captured = applyRemove(src, ids)
      const anchorIdx = anchorId ? tgt.children.findIndex((c) => c.id === anchorId) : -1
      const at = anchorIdx === -1 ? tgt.children.length : anchorIdx
      tgt.children.splice(at, 0, ...clones)
      const cloneIds = clones.map((c) => c.id)
      const removeClones = () => {
        for (let i = tgt.children.length - 1; i >= 0; i--) if (cloneIds.includes(tgt.children[i].id)) tgt.children.splice(i, 1)
      }
      const u = this.undoOf(tgtDocId)
      u.push({
        label: 'Move',
        undo: () => {
          removeClones()
          restoreRemove(src, captured)
        },
        redo: () => {
          applyRemove(src, ids)
          tgt.children.splice(Math.min(at, tgt.children.length), 0, ...clones)
        },
      })
      this.touch(srcDocId)
      this.touch(tgtDocId)
      return nodes.length
    },

    // ---- duplicates ---------------------------------------------------------
    statsFor(docId: string): FullStats {
      const doc = this.byId(docId)
      if (!doc) return { links: 0, folders: 0, uniqueUrls: 0, duplicateGroups: 0, deadLinks: 0, dupMembers: 0 }
      const root = toRaw(doc.root)
      let links = 0
      let folders = 0
      let deadLinks = 0
      for (const n of walk(root)) {
        if (n.type === 'link') {
          links++
          if (n.dead) deadLinks++
        } else folders++
      }
      const dup = findDuplicates(root)
      return {
        links,
        folders,
        uniqueUrls: dup.uniqueUrls,
        duplicateGroups: dup.groups.length,
        deadLinks,
        dupMembers: dup.totalDuplicates + dup.groups.length,
      }
    },

    // ---- link checker helpers -----------------------------------------------
    markDeadNames(docId: string, ids: string[]): void {
      const doc = this.byId(docId)
      if (!doc || !ids.length) return
      const u = this.undoOf(docId)
      u.group(`Mark ${ids.length} dead`, () => {
        for (const id of ids) {
          const n = findNode(doc.root, id)
          if (!n || n.type !== 'link' || n.dead) continue
          n.dead = true
          if (!n.name.includes(SKULL)) n.name = `${n.name} ${SKULL}`
          u.push({
            label: 'Mark dead',
            undo: () => {
              n.dead = false
              n.name = n.name.replace(DEAD_MARK, '')
            },
            redo: () => {
              n.dead = true
              if (!n.name.includes(SKULL)) n.name = `${n.name} ${SKULL}`
            },
          })
        }
      })
      this.touch(docId)
    },
    /** Apply a link check: mark `deadIds` dead and revive any checked link that
     *  came back alive (so stale ❌ flags from earlier checks get cleared). */
    reconcileDead(docId: string, deadIds: string[], checkedIds: string[]): void {
      const doc = this.byId(docId)
      if (!doc || !checkedIds.length) return
      const deadSet = new Set(deadIds)
      const u = this.undoOf(docId)
      u.group(`Link check (${checkedIds.length})`, () => {
        for (const id of checkedIds) {
          const n = findNode(doc.root, id)
          if (!n || n.type !== 'link') continue
          if (deadSet.has(id)) {
            if (!n.dead) {
              n.dead = true
              if (!n.name.includes(SKULL)) n.name = `${n.name} ${SKULL}`
              u.push({
                label: 'Mark dead',
                undo: () => {
                  n.dead = false
                  n.name = n.name.replace(DEAD_MARK, '')
                },
                redo: () => {
                  n.dead = true
                  if (!n.name.includes(SKULL)) n.name = `${n.name} ${SKULL}`
                },
              })
            }
          } else if (n.dead) {
            n.dead = false
            n.name = n.name.replace(DEAD_MARK, '')
            u.push({
              label: 'Mark alive',
              undo: () => {
                n.dead = true
                if (!n.name.includes(SKULL)) n.name = `${n.name} ${SKULL}`
              },
              redo: () => {
                n.dead = false
                n.name = n.name.replace(DEAD_MARK, '')
              },
            })
          }
        }
      })
      this.touch(docId)
    },
    /** Rewrite links to their current URLs where a rule applies (see lib/urlrewrite).
     *  Revives any previously-dead link whose URL was rewritten. Returns the count. */
    rewriteLinks(docId: string, ids?: string[]): number {
      const doc = this.byId(docId)
      if (!doc) return 0
      const want = ids && ids.length ? new Set(ids) : null
      const u = this.undoOf(docId)
      let count = 0
      u.group(`Rewrite ${want ? ids!.length : 'dead'} links`, () => {
        const visit = (n: BmNode): void => {
          if (n.type === 'link' && n.url && (!want || want.has(n.id))) {
            const nr = rewriteUrl(n.url)
            if (nr && nr !== n.url) {
              const old = n.url
              const wasDead = n.dead
              n.url = nr
              if (wasDead) {
                n.dead = false
                n.name = n.name.replace(DEAD_MARK, '')
              }
              u.push({
                label: 'Rewrite link',
                undo: () => {
                  n.url = old
                  if (wasDead) {
                    n.dead = true
                    if (!n.name.includes(SKULL)) n.name = `${n.name} ${SKULL}`
                  }
                },
                redo: () => {
                  n.url = nr
                  if (wasDead) {
                    n.dead = false
                    n.name = n.name.replace(DEAD_MARK, '')
                  }
                },
              })
              count++
            }
          }
          for (const c of n.children) visit(c)
        }
        visit(doc.root)
      })
      if (count) this.touch(docId)
      return count
    },
    collectDead(docId: string, ids: string[], targetFolderId?: string): string {
      const doc = this.byId(docId)
      if (!doc || !ids.length) return ''
      let folder = targetFolderId ? findNode(doc.root, targetFolderId) : undefined
      if (!folder || folder.type !== 'folder') {
        folder = findNode(doc.root, doc.currentFolderId) ?? doc.root
        if (folder.type !== 'folder') folder = doc.root
      }
      const u = this.undoOf(docId)
      let deadId = ''
      u.group('Collect dead links', () => {
        deadId = this.mutCreateFolder(docId, folder.id, `Dead links ${SKULL} ${new Date().toLocaleDateString()}`, 0)
        const deadFolder = findNode(doc.root, deadId)
        if (!deadFolder) return
        for (const id of ids) {
          const n = findNode(doc.root, id)
          if (!n || n.type !== 'link') continue
          const p = indexTree(doc.root).parentOf.get(id)
          if (!p) continue
          this.mutMove(docId, p.id, [id], deadFolder.id, null)
          const m = findNode(doc.root, id)
          if (m) {
            m.dead = true
            if (!m.name.includes(SKULL)) m.name = `${m.name} ${SKULL}`
          }
        }
      })
      this.touch(docId)
      return deadId
    },
  },
})

export type DocsStore = ReturnType<typeof useDocs>
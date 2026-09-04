<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useDocs } from '../../state/docs'
import { useDnd } from '../../state/dnd'
import { useClipboard, type TransferGroup } from '../../state/clipboard'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { groupByParent, indexTree, folderCounts, namePath, toolbarFolder, topmostIds } from '../../lib/tree'
import { matchQuery, tokenizeQuery } from '../../lib/search'
import { prepareDrag } from '../../lib/drag'
import { confirmDelete } from '../../lib/confirmDelete'
import type { BmNode } from '../../types'
import ContextMenu from '../shared/ContextMenu.vue'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const dnd = useDnd()
const clip = useClipboard()
const ui = useUi()
const icon = (name: string) => useIcon(name)
const contextRef = ref<InstanceType<typeof ContextMenu> | null>(null)
const scrollRef = ref<HTMLElement>()
const flashingId = ref('')
let flashTimer: ReturnType<typeof setTimeout>

const doc = computed(() => docs.byId(props.docId))
const query = ref('')

/** after a "Show in tree" reveal: scroll the containing folder into view and flash it */
function revealFocus(): void {
  const id = doc.value?.currentFolderId
  if (!id) return
  nextTick(() => {
    const el = scrollRef.value?.querySelector(`[data-dropid="${id}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    flashingId.value = id
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (flashingId.value = ''), 1400)
  })
}
watch(() => doc.value?.revealRev, () => revealFocus())
onMounted(() => {
  // the pane remounts on the view transition; only flash if a reveal just happened
  if (Date.now() - (doc.value?.lastRevealAt ?? 0) < 700) {
    setTimeout(revealFocus, 60)
  }
})

const idx = computed(() => {
  docs.treeVersion
  return doc.value ? indexTree(doc.value.root) : null
})

/** parent folder id for a row rendered in the tree (drop target resolution) */
function rowParentId(n: BmNode): string {
  return idx.value?.parentOf.get(n.id)?.id ?? doc.value?.root.id ?? ''
}

/** the ≡ chevron only makes sense for folders that actually contain subfolders */
function hasSubfolders(n: BmNode): boolean {
  return n.type === 'folder' && n.children.some((c) => c.type === 'folder')
}

// ---- sidebar width splitter ----
const savedW = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('bm.sidebarWidth') || 0) : 0
const paneW = ref(savedW > 220 ? savedW : 300)
function startSplit(e: MouseEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  const startX = e.clientX
  const startW = paneW.value
  document.body.classList.add('bm-resizing')
  const move = (ev: MouseEvent) => {
    paneW.value = Math.min(560, Math.max(220, startW + ev.clientX - startX))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    document.body.classList.remove('bm-resizing')
    if (typeof localStorage !== 'undefined') localStorage.setItem('bm.sidebarWidth', String(paneW.value))
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

interface Row {
  node: BmNode
  depth: number
  match: boolean
  expanded: boolean
  /** virtual marker row: the "All bookmarks" section root (the store root) */
  isRoot?: boolean
  /** display label override for virtual rows */
  label?: string
}

const rows = computed<Row[]>(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const collapsed = d.collapsed
  const tokens = tokenizeQuery(query.value)
  const out: Row[] = []

  if (!tokens.length) {
    const bar = toolbarFolder(d.root)
    const walk = (n: BmNode, depth: number): void => {
      for (const c of n.children) {
        if (c.type !== 'folder') continue
        out.push({ node: c, depth, match: false, expanded: !collapsed[c.id] })
        if (!collapsed[c.id]) walk(c, depth + 1)
      }
    }
    // section 1: the bookmarks bar (its own root, sibling of "All bookmarks")
    if (bar) {
      out.push({ node: bar, depth: 0, match: false, expanded: !collapsed[bar.id] })
      if (!collapsed[bar.id]) walk(bar, 1)
    }
    // section 2: "All bookmarks" = everything except the bar
    out.push({ node: d.root, depth: 0, match: false, expanded: !collapsed[d.root.id], isRoot: true, label: 'Other bookmarks' })
    if (!collapsed[d.root.id]) {
      for (const c of d.root.children) {
        if (c.type !== 'folder') continue
        if (bar && c.id === bar.id) continue
        out.push({ node: c, depth: 1, match: false, expanded: !collapsed[c.id] })
        if (!collapsed[c.id]) walk(c, 2)
      }
    }
    return out
  }

  // filter mode: show matches plus everything on their ancestor path, expanded
  const cache = new Map<string, number>()
  const matchesIn = (n: BmNode): number => {
    if (cache.has(n.id)) return cache.get(n.id)!
    let m = matchQuery(tokens, n.name) ? 1 : 0
    for (const c of n.children) m += matchesIn(c)
    cache.set(n.id, m)
    return m
  }
  const walk = (n: BmNode, depth: number): void => {
    for (const c of n.children) {
      if (matchesIn(c) === 0) continue
      out.push({
        node: c,
        depth,
        match: matchQuery(tokens, c.name),
        expanded: c.type === 'folder',
      })
      if (c.type === 'folder') walk(c, depth + 1)
    }
  }
  walk(d.root, 0)
  return out
})

watch(
  () => props.docId,
  () => (query.value = '')
)

const counts = computed(() => {
  docs.treeVersion
  return doc.value ? folderCounts(doc.value.root) : new Map()
})

function selectFolder(id: string): void {
  docs.setCurrentFolder(props.docId, id)
}
/** counts for a row, excluding the bar subtree from the "All bookmarks" root */
function rowCount(r: Row): number {
  const d = doc.value
  if (!d) return 0
  if (!r.isRoot) return counts.value.get(r.node.id)?.links ?? 0
  const total = counts.value.get(d.root.id)?.links ?? 0
  const bar = toolbarFolder(d.root)
  return bar ? total - (counts.value.get(bar.id)?.links ?? 0) : total
}
function rowDeadCount(r: Row): number {
  const d = doc.value
  if (!d) return 0
  if (!r.isRoot) return counts.value.get(r.node.id)?.dead ?? 0
  const total = counts.value.get(d.root.id)?.dead ?? 0
  const bar = toolbarFolder(d.root)
  return bar ? total - (counts.value.get(bar.id)?.dead ?? 0) : total
}
function toggle(n: BmNode): void {
  if (n.type !== 'folder') return
  docs.toggleCollapse(props.docId, n.id)
}

// ---------- drag & drop (pointer-based) ----------
function rowDropHover(n: BmNode, mode: 'before' | 'inside' | 'after'): string | null {
  return dnd.target?.folderId === n.id && dnd.target?.mode === mode ? mode : null
}
watch(
  () => dnd.target,
  (t) => {
    if (t && t.mode === 'inside') {
      // auto-expand a folder hovered for >450ms while dragging
      clearTimeout(autoExpandTimer)
      autoExpandTimer = setTimeout(() => {
        if (dnd.target?.folderId === t.folderId && doc.value) {
          doc.value.collapsed[t.folderId] = false
        }
      }, 450)
    } else {
      clearTimeout(autoExpandTimer)
    }
  }
)
let autoExpandTimer: ReturnType<typeof setTimeout>

/** multi-selection of tree folders (separate from the navigation highlight) */
const rangeAnchor = ref('')

const treeSel = computed(() => doc.value?.treeSel ?? [])

function setTreeSel(ids: string[]): void {
  if (doc.value) doc.value.treeSel = ids
}

/** modifier-aware row click: ⌘/Ctrl toggles, ⇧ ranges, plain navigates + clears */
function onRowClick(e: MouseEvent, n: BmNode): void {
  // the virtual "All bookmarks" root is navigated to, never multi-selected
  if (n.id === doc.value?.root.id) {
    rangeAnchor.value = ''
    setTreeSel([])
    selectFolder(n.id)
    return
  }
  if (e.metaKey || e.ctrlKey) {
    const set = new Set(treeSel.value)
    // A plain-click-then-⌘-click sequence must select the anchor too,
    // matching ⇧-range behaviour. Only seed when the multi-select is empty.
    if (!set.size && rangeAnchor.value && rangeAnchor.value !== n.id) {
      set.add(rangeAnchor.value)
    }
    if (set.has(n.id)) set.delete(n.id)
    else set.add(n.id)
    setTreeSel([...set])
    return
  }
  if (e.shiftKey) {
    const order = rows.value.map((r) => r.node.id)
    const to = order.indexOf(n.id)
    if (to < 0) return
    let base = order.indexOf(rangeAnchor.value)
    if (base < 0) {
      const cur = order.indexOf(n.id)
      const sel = treeSel.value.map((id) => order.indexOf(id)).filter((i) => i >= 0)
      base = sel.length ? Math.min(...sel) : cur
    }
    const lo = Math.min(base, to)
    const hi = Math.max(base, to)
    setTreeSel(order.slice(lo, hi + 1))
    return
  }
  rangeAnchor.value = n.id
  setTreeSel([])
  selectFolder(n.id)
}

function onDragStartRow(e: MouseEvent, n: BmNode): void {
  const t = e.target as HTMLElement
  if (t.closest('.tr-chev, button, input')) return
  const parent = idx.value!.parentOf.get(n.id)
  if (!parent) return
  // dragging a multi-selected folder drags the topmost of the selection:
  // a selected folder inside another selected folder moves implicitly with
  // its ancestor, so only the ancestors are listed explicitly
  let ids = [n.id]
  if (treeSel.value.includes(n.id)) {
    const top = topmostIds(idx.value!.parentOf, treeSel.value)
    ids = top.includes(n.id) ? top : [n.id]
  }
  const groups = groupByParent(idx.value!.parentOf, ids)
  if (!groups.length) return
  prepareDrag(
    e,
    {
      docId: props.docId,
      nodeIds: ids,
      sourceParentId: parent.id,
      label: n.name,
      isFolder: ids.length === 1 && n.type === 'folder',
      url: n.url,
    },
    (toFolderId, anchorId) => {
      const d = doc.value
      if (!d) return
      docs.undoOf(d.id).group('Move', () => {
        for (const g of groups) docs.mutMove(d.id, g.parentId, g.ids, toFolderId, anchorId)
      })
    }
  )
}

function onContextMenu(e: MouseEvent, n: BmNode): void {
  e.preventDefault()
  e.stopPropagation()
  const d = doc.value
  if (!d) return
  const isRoot = n.id === d.root.id
  const items: ({ label: string; icon?: string; shortcut?: string; danger?: boolean; disabled?: boolean; action: () => void } | 'sep')[] = []
  if (n.type === 'folder') {
    items.push({ label: 'Open folder', icon: 'FolderOpen', action: () => selectFolder(n.id) })
    if (!isRoot) items.push({ label: 'Show in tree', icon: 'ListTree', action: () => revealInTree(n) })
    items.push('sep')
    items.push({ label: 'New folder inside', icon: 'FolderPlus', action: () => ui.openModal('newFolder', { docId: props.docId, folderId: n.id }) })
    items.push({ label: 'New bookmark inside', icon: 'Plus', action: () => ui.openModal('newBookmark', { docId: props.docId, folderId: n.id }) })
    if (!isRoot) items.push({ label: 'Rename…', icon: 'Pencil', action: () => ui.openModal('editNode', { docId: props.docId, node: n }) })
    if (!isRoot) items.push({ label: 'Sort by name', icon: 'Type', action: () => docs.mutSort(props.docId, n.id, 'name') })
    if (!isRoot) items.push({ label: 'Copy', icon: 'CopyPlus', shortcut: '⌘C', action: () => copyTreeFolders(foldersOf(n)) })
    if (!isRoot) items.push({ label: 'Cut', icon: 'Scissors', shortcut: '⌘X', action: () => cutTreeFolders(foldersOf(n)) })
    items.push({ label: 'Paste', icon: 'ClipboardPaste', disabled: !clip.has, action: () => pasteInto(n) })
    items.push('sep')
    items.push({ label: 'Check links in folder', icon: 'Network', action: () => {
      const list: { id: string; url: string }[] = []
      const walk = (x: BmNode) => {
        if (x.type === 'link' && x.url) list.push({ id: x.id, url: x.url })
        for (const c of x.children) walk(c)
      }
      walk(n)
      import('../../state/checker').then(({ useChecker }) => useChecker().start(props.docId, list, false))
    } })
  } else {
    items.push({ label: 'Reveal', icon: 'ListTree', action: () => {
      const parent = idx.value!.parentOf.get(n.id)
      if (parent) {
        selectFolder(parent.id)
        docs.select(props.docId, [n.id], false)
      }
    } })
    items.push({ label: n.dead ? 'Mark as alive' : 'Mark dead', icon: n.dead ? 'Eye' : 'Skull', action: () => {
      if (n.dead) docs.mutClearDead(props.docId, n.id)
      else docs.markDeadNames(props.docId, [n.id])
    } })
  }
  if (!isRoot) {
    items.push('sep')
    items.push({ label: 'Copy path', icon: 'Clipboard', action: () => {
      const path = namePath(d.root, n.id).join(' / ')
      navigator.clipboard?.writeText(path).then(() => ui.notify('info', 'Path copied'))
    } })
    items.push({ label: 'Delete', icon: 'Trash2', danger: true, shortcut: 'Del', action: () => {
      confirmDelete(props.docId, [n.id], { kind: 'info', text: 'Deleted' })
    } })
  }
  contextRef.value?.show({ x: e.clientX, y: e.clientY, items, title: n.name })
}

/** select the item in the list and scroll the tree to it */
function revealInTree(n: BmNode): void {
  docs.revealPath(props.docId, n.id)
}

/** paste the clipboard into a folder (appended) */
function pasteInto(n: BmNode): void {
  if (!clip.has) {
    ui.notify('error', 'Nothing to paste — cut or copy some items first')
    return
  }
  const moved = clip.pasteInto(props.docId, n.id, null)
  if (moved > 0) ui.notify('success', `Pasted ${moved} item${moved === 1 ? '' : 's'}`)
  else if (clip.srcDocId === null) ui.notify('error', 'Items no longer exist — clipboard cleared')
  else ui.notify('error', 'Nothing to paste here')
}

// ---------------- cut / copy / paste (multi-folder) ----------------
/** reduce a tree selection to its transfer groups (topmost ids per parent) */
function treeGroupsFor(ids: string[]): TransferGroup[] {
  return groupByParent(idx.value!.parentOf, ids)
}
/** act on the whole multi-selection when the right-clicked row is part of it, else just that row */
function foldersOf(n: BmNode): string[] {
  return treeSel.value.includes(n.id) && treeSel.value.length > 1 ? treeSel.value : [n.id]
}
/** cut rows dim in the tree (copies stay normal-looking) */
const isTreeCut = (id: string): boolean => clip.mode === 'cut' && clip.srcDocId === props.docId && clip.ids.includes(id)

function copyTreeFolders(ids: string[]): void {
  const d = doc.value
  if (!d) return
  const groups = treeGroupsFor(ids)
  if (!groups.length) {
    ui.notify('error', 'Nothing to copy here')
    return
  }
  clip.captureGroups(d.id, groups, 'copy')
  ui.notify('info', `${clip.summary} copied from “${clip.sourcePath}” — press ⌘V to paste`)
}

function cutTreeFolders(ids: string[]): void {
  const d = doc.value
  if (!d) return
  const groups = treeGroupsFor(ids)
  if (!groups.length) {
    ui.notify('error', 'Nothing to cut here')
    return
  }
  clip.captureGroups(d.id, groups, 'cut')
  ui.notify('info', `${clip.summary} cut from “${clip.sourcePath}” — press ⌘V to paste`)
}

/** toolbar paste: into the single selected tree folder, else the folder open in the list */
function pasteTree(): void {
  const d = doc.value
  if (!d) return
  if (!clip.has) {
    ui.notify('error', 'Nothing to paste — cut or copy some items first')
    return
  }
  const target = treeSel.value.length === 1 ? treeSel.value[0] : d.currentFolderId
  const moved = clip.pasteInto(d.id, target, null)
  if (moved > 0) ui.notify('success', `Pasted ${moved} item${moved === 1 ? '' : 's'}`)
  else if (clip.srcDocId === null) ui.notify('error', 'Items no longer exist — clipboard cleared')
  else ui.notify('error', 'Nothing to paste here')
}
</script>

<template>
  <aside v-if="doc" class="tree-pane" :data-ver="docs.treeVersion" :style="{ width: paneW + 'px' }">
    <div class="tree-search">
      <component :is="icon('Search')" :size="14" />
      <input v-model="query" placeholder="Filter tree" />
      <button v-if="query" class="mini-x" @click="query = ''"><component :is="icon('X')" :size="13" /></button>
    </div>

    <div class="tree-scroll" ref="scrollRef">
      <div
        v-for="r in rows"
        :key="r.isRoot ? '__root__' : r.node.id"
        class="tree-row"
        :data-dropid="r.node.id"
        :data-dropparent="rowParentId(r.node)"
        :data-dropkind="r.isRoot ? 'root' : r.node.type"
        :class="{
          selected: doc.currentFolderId === r.node.id,
          multi: treeSel.includes(r.node.id),
          open: r.node.type === 'folder' && r.expanded,
          drophover: dnd.target?.folderId === r.node.id && dnd.session?.docId === props.docId,
          match: r.match,
          flash: flashingId === r.node.id,
          cut: isTreeCut(r.node.id),
          behind: dnd.session?.docId === props.docId && treeSel.includes(r.node.id) && !dnd.session?.nodeIds.includes(r.node.id),
        }"
        :data-drophover="rowDropHover(r.node, 'before') ? 'before' : rowDropHover(r.node, 'inside') ? 'inside' : rowDropHover(r.node, 'after') ? 'after' : undefined"
        :style="{ paddingLeft: r.depth * 14 + 6 + 'px' }"
        @click="onRowClick($event, r.node)"
        @contextmenu.prevent="onContextMenu($event, r.node)"
        @mousedown="onDragStartRow($event, r.node)"
      >
        <span
          v-if="hasSubfolders(r.node)"
          class="tr-chev"
          @click.stop="toggle(r.node)"
        >
          <component :is="icon('ChevronRight')" :size="14" />
        </span>
        <span v-else class="tr-chev-spacer" />
        <span class="folder-tile small">
          <component :is="icon(r.node.type === 'folder' ? 'Folder' : 'Link2')" :size="12" />
        </span>
        <span class="tr-name" :class="{ 'has-match': r.match }">{{ r.label ?? r.node.name }}</span>
        <span v-if="r.node.type === 'folder'" class="tr-count" :class="{ warn: rowDeadCount(r) > 0 }">
          {{ rowCount(r) }}
        </span>
        <span v-if="rowDeadCount(r) > 0" class="tr-count ok">❌ {{ rowDeadCount(r) }}</span>
      </div>

      <div v-if="!rows.length" class="tree-empty">No folders here</div>
    </div>

    <div class="tree-foot">
      <span v-if="treeSel.length" class="tf-count">{{ treeSel.length }} selected</span>
      <button class="icon-btn" title="Copy selected folders (⌘C)" :disabled="!treeSel.length" @click="copyTreeFolders(treeSel)">
        <component :is="icon('CopyPlus')" :size="13" />
      </button>
      <button class="icon-btn" title="Cut selected folders (⌘X)" :disabled="!treeSel.length" @click="cutTreeFolders(treeSel)">
        <component :is="icon('Scissors')" :size="13" />
      </button>
      <button class="icon-btn" title="Paste (⌘V)" :disabled="!clip.has" @click="pasteTree">
        <component :is="icon('ClipboardPaste')" :size="13" />
      </button>
      <span class="tf-spacer" />
      <button class="toolbar-btn" @click="docs.expandAll(props.docId)"><component :is="icon('FolderOpen')" :size="14" /> Expand all</button>
      <button class="toolbar-btn" @click="docs.collapseAll(props.docId)"><component :is="icon('FolderClosed')" :size="14" /> Collapse</button>
    </div>

    <ContextMenu ref="contextRef" />

    <div class="splitbar" title="Drag to resize" @mousedown="startSplit"></div>
  </aside>
</template>

<style scoped>
.tree-pane {
  width: 300px;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--surface);
  position: relative;
  flex: none;
}
.splitbar {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -4px;
  width: 9px;
  cursor: col-resize;
  z-index: 8;
}
.splitbar::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 120ms var(--ease);
}
.splitbar:hover::after {
  background: var(--accent);
}
.tree-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 10px 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-3);
}
.tree-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-softer);
}
.tree-search input {
  border: none;
  outline: none;
  flex: 1;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  min-width: 0;
}
.mini-x {
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: inline-flex;
}
.tree-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 5px 12px;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 6px;
  border-radius: var(--radius-s);
  cursor: pointer;
  user-select: none;
  position: relative;
  color: var(--text-2);
  white-space: nowrap;
}
.tree-row:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.tree-row.selected {
  background: var(--accent-soft);
  color: var(--text);
}
/* every multi-selected row shares the anchored row's fill + a crisp outline,
   so a ⌘-clicked group and its anchor all read as one selection */
.tree-row.multi,
.tree-row.selected.multi {
  background: var(--accent-soft);
  color: var(--text);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.tree-row.match .tr-name {
  color: var(--accent);
}
.tree-row.flash {
  animation: bm-tree-flash 1.4s ease both;
}
@keyframes bm-tree-flash {
  0%,
  20% {
    background: var(--accent);
    color: #fff;
  }
  65% {
    background: var(--accent-soft);
    color: var(--text);
  }
  100% {
    background: transparent;
  }
}
.tr-chev {
  display: inline-flex;
  color: var(--text-3);
  transition: transform 120ms var(--ease);
  flex: none;
  width: 14px;
}
.tree-row.open .tr-chev {
  transform: rotate(90deg);
}
.tr-chev-spacer {
  width: 14px;
  flex: none;
}
.tr-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tr-count {
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  background: var(--surface3);
  border-radius: var(--radius-full);
  padding: 0 6px;
  height: 15px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}
.tr-count.warn {
  background: var(--danger-soft);
  color: var(--danger);
}
.tr-count.ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.tree-row.drophover[data-drophover='inside'] {
  background: var(--accent-softer);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
/* straight insertion line across the row edge — box-shadow would follow the
   row's rounded corners and curve at the ends */
.tree-row.drophover[data-drophover='before']::after,
.tree-row.drophover[data-drophover='after']::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
}
.tree-row.drophover[data-drophover='before']::after {
  top: 0;
}
.tree-row.drophover[data-drophover='after']::after {
  bottom: 0;
}
.tree-empty {
  padding: 30px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
}
.tree-foot {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}
.tree-foot .toolbar-btn {
  padding: 0 6px;
  font-size: 11.5px;
}
.tf-count {
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  background: var(--surface3);
  border-radius: var(--radius-full);
  padding: 0 8px;
  height: 17px;
  line-height: 17px;
  font-variant-numeric: tabular-nums;
}
.tf-spacer {
  flex: 1;
}
.tree-row.cut {
  opacity: 0.5;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.tree-row.behind {
  opacity: 0.45;
}
</style>
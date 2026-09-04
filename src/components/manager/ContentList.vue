<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocs } from '../../state/docs'
import { useDnd } from '../../state/dnd'
import { useClipboard } from '../../state/clipboard'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { findNode, namePath, toolbarFolder, mobileFolder, otherFolder } from '../../lib/tree'
import { formatDate } from '../../lib/date'
import { hostOf } from '../../lib/url'
import { prepareDrag } from '../../lib/drag'
import { confirmDelete } from '../../lib/confirmDelete'
import type { BmNode } from '../../types'
import Favicon from '../shared/Favicon.vue'
import ContextMenu from '../shared/ContextMenu.vue'
import FolderPicker from '../shared/FolderPicker.vue'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const dnd = useDnd()
const clip = useClipboard()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.byId(props.docId))
const folder = computed(() => {
  docs.treeVersion
  const d = doc.value
  return d ? findNode(d.root, d.currentFolderId) : null
})
/** the "All bookmarks" view is the root minus the bar & mobile (each is its own root) */
const isRootView = computed(() => !!doc.value && folder.value?.id === doc.value!.root.id)
const children = computed(() => {
  docs.treeVersion
  const kids = folder.value?.children ?? []
  if (isRootView.value) {
    const root = doc.value!.root
    const bar = toolbarFolder(root)
    const mobile = mobileFolder(root)
    // Chrome's real top-level "Other bookmarks" folder mirrors this very view —
    // flatten its children in place so it isn't a redundant "Other bookmarks"
    // row inside the "All bookmarks" list.
    const otherTop = otherFolder(root)
    const out: BmNode[] = []
    for (const c of kids) {
      if (bar && c.id === bar.id) continue
      if (mobile && c.id === mobile.id) continue
      if (otherTop && c.id === otherTop.id) {
        out.push(...otherTop.children)
        continue
      }
      out.push(c)
    }
    return out
  }
  return kids
})

const editing = ref<{ node: BmNode; field: 'name' | 'url' } | null>(null)
const editText = ref('')
const editInput = ref<HTMLInputElement>()
const listRef = ref<HTMLElement>()
const showPicker = ref(false)
const contextRef = ref<InstanceType<typeof ContextMenu> | null>(null)

const isSelected = (id: string) => doc.value?.selected?.includes(id) ?? false

const flashingId = ref('')
let flashTimer: ReturnType<typeof setTimeout>

/** keep the selected/highlighted row in view (e.g. after "Show in tree").
 *  Scrolling to the *last* selected row means a ⌘-click that extends a
 *  multi-selection anchors on the row just clicked (already in view) instead
 *  of snapping back to the first item far above the viewport. */
function scrollSelectedIntoView(): void {
  const d = doc.value
  if (!d) return
  const id = d.selected[d.selected.length - 1]
  if (!id || !listRef.value) return
  nextTick(() => {
    const el = listRef.value?.querySelector(`[data-dropid="${id}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}
watch(
  () => doc.value?.currentFolderId,
  () => scrollSelectedIntoView(),
  { immediate: true }
)
watch(
  () => doc.value?.selected,
  () => scrollSelectedIntoView(),
  { immediate: true }
)

/** after a "Show in tree" reveal: scroll and flash the revealed row */
function revealFocus(): void {
  setTimeout(() => {
    const d = doc.value
    const id = d?.selected[0]
    if (!id || !listRef.value) return
    nextTick(() => {
      const el = listRef.value?.querySelector(`[data-dropid="${id}"]`) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      flashingId.value = id
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => (flashingId.value = ''), 1400)
    })
  }, 60)
}
watch(() => doc.value?.revealRev, revealFocus)
onMounted(() => {
  // the pane remounts on the view transition; only flash if a reveal just happened
  if (Date.now() - (doc.value?.lastRevealAt ?? 0) < 700) {
    revealFocus()
  }
})

function batchImport(): void {
  ui.openModal('importTarget', { docId: props.docId })
}

function childFolderCount(n: BmNode): number {
  return n.type === 'folder' ? n.children.filter((c) => c.type === 'folder').length : 0
}
function childLinkCount(n: BmNode): number {
  return n.type === 'folder' ? n.children.filter((c) => c.type === 'link').length : 0
}

function onClickRow(e: MouseEvent, n: BmNode): void {
  // clicking another item exits inline editing (commits first)
  if (editing.value) commitEdit()
  const d = doc.value
  if (!d) return
  if (e.metaKey || e.ctrlKey) {
    docs.select(d.id, [n.id], true)
  } else if (e.shiftKey) {
    const list = children.value
    const lastSel = d.selected[d.selected.length - 1]
    const from = list.findIndex((c) => c.id === (lastSel || n.id))
    const to = list.findIndex((c) => c.id === n.id)
    if (from >= 0 && to >= 0) {
      const ids = list.slice(Math.min(from, to), Math.max(from, to) + 1).map((c) => c.id)
      docs.select(d.id, ids, false)
    } else {
      docs.select(d.id, [n.id], false)
    }
  } else {
    docs.select(d.id, [n.id], false)
    // put keyboard focus on the list so arrows / F2 / Enter work immediately
    listRef.value?.focus()
    // a plain click declares "I'm working in the list" — an old tree
    // multi-selection must not keep hijacking ⌘C/⌘X/⌘V
    d.treeSel = []
  }
}

/** double-click: reveal in tree for links, dive into folders (ignores the action buttons) */
function onDblClick(e: MouseEvent, n: BmNode): void {
  const t = e.target as HTMLElement
  if (t.closest('button, input, a, .bm-actions')) return
  if (n.type === 'folder') {
    docs.setCurrentFolder(props.docId, n.id)
  } else if (n.type === 'link') {
    revealInTree(n)
  }
}

/** expand the tree path and select/highlight this item in the manager */
function revealInTree(n: BmNode): void {
  docs.revealPath(props.docId, n.id)
}

// While inline-editing, Escape cancels from anywhere (window level) and
// Enter commits. Nothing else is swallowed while editing.
function onEditKey(e: KeyboardEvent): void {
  if (!editing.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    editing.value = null
  } else if (e.key === 'Enter') {
    e.preventDefault()
    commitEdit()
  }
}
watch(editing, (v) => {
  if (v) window.addEventListener('keydown', onEditKey)
  else window.removeEventListener('keydown', onEditKey)
})

function onRowKey(e: KeyboardEvent): void {
  if (editing.value) return
  // never turn keystrokes typed into an input/editable into list shortcuts
  const et = e.target as HTMLElement | null
  if (et?.closest?.('input, textarea, select, [contenteditable]')) return
  const d = doc.value
  if (!d || !children.value.length) return
  const list = children.value
  const idx = list.findIndex((c) => c.id === d.selected[0])
  const cur = idx >= 0 ? idx : 0
  let next = cur
  // copy path is Alt+C (physical key): on macOS ⌥C reports a special character
  // as `key` (e.g. "ç"), so match the physical key and modifiers up front
  if (e.code === 'KeyC' && e.altKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault()
    copyPath(list[cur])
    return
  }
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      next = Math.min(list.length - 1, cur + 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      next = Math.max(0, cur - 1)
      break
    case 'Enter':
      e.preventDefault()
      openNode(list[cur])
      return
    case 'F2':
      e.preventDefault()
      startEdit(list[cur], 'name')
      return
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      deleteSelected()
      return
    case 'a':
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        docs.select(d.id, list.map((c) => c.id), false)
      }
      return
    default:
      return
  }
  if (next !== cur) {
    if (e.shiftKey) {
      // range selection: from the earliest row of the current selection to `next`
      const sel = d.selected
      let base = cur
      for (const id of sel) {
        const i = list.findIndex((c) => c.id === id)
        if (i >= 0 && i < base) base = i
      }
      const lo = Math.min(base, next)
      const hi = Math.max(base, next)
      next = hi
      docs.select(d.id, list.slice(lo, hi + 1).map((c) => c.id), false)
    } else {
      docs.select(d.id, [list[next].id], false)
    }
  }
}

function openNode(n: BmNode): void {
  if (n.type === 'folder') docs.setCurrentFolder(props.docId, n.id)
  else if (n.url) window.open(n.url, '_blank', 'noopener')
}

function startEdit(n: BmNode, field: 'name' | 'url'): void {
  editing.value = { node: n, field }
  editText.value = field === 'url' ? n.url || '' : n.name
  nextTick(() => {
    // refs inside v-for are collected into an array, so unwrap the single input
    const el = (Array.isArray(editInput.value) ? editInput.value[0] : editInput.value) as HTMLInputElement | undefined
    if (el) {
      el.focus()
      el.select?.()
    }
  })
}
function commitEdit(): void {
  const e = editing.value
  if (!e) return
  const t = editText.value.trim()
  if (e.field === 'name' && t && t !== e.node.name) docs.mutRename(props.docId, e.node.id, t)
  else if (e.field === 'url' && t !== (e.node.url || '')) docs.mutSetUrl(props.docId, e.node.id, t)
  editing.value = null
}

function copyUrl(n: BmNode): void {
  if (!n.url) return
  navigator.clipboard?.writeText(n.url).then(() => ui.notify('info', 'URL copied'))
}

/** copy the item's location in the tree, e.g. "Bookmarks bar / Favs / Mail".
 *  If `n` is part of a multi-selection, copy all selected paths (one per line). */
function copyPath(n: BmNode): void {
  const d = doc.value
  if (!d) return
  const sel = d.selected
  const ids = sel.length > 1 && sel.includes(n.id) ? sel : [n.id]
  const text = ids.map((id) => namePath(d.root, id).join(' / ')).join('\n')
  navigator.clipboard?.writeText(text).then(() =>
    ui.notify('info', ids.length > 1 ? `Copied ${ids.length} paths` : 'Path copied'),
  )
}
/** copy the current folder's location in the tree */
function copyFolderPath(): void {
  const d = doc.value
  if (!d || !folder.value) return
  copyPath(folder.value)
}
function openExternal(n: BmNode): void {
  if (n.url) window.open(n.url, '_blank', 'noopener')
}
/** select every row in the current folder */
function selectAll(): void {
  const d = doc.value
  if (!d) return
  docs.select(d.id, children.value.map((c) => c.id), false)
}
/** select only the dead links in the current folder */
function selectAllDead(): void {
  const d = doc.value
  if (!d) return
  const ids = children.value.filter((c) => c.type === 'link' && c.dead).map((c) => c.id)
  docs.select(d.id, ids, false)
  if (!ids.length) ui.notify('info', 'No dead links in this folder')
}
function deleteSelected(): void {
  const d = doc.value
  if (!d || !d.selected.length) return
  confirmDelete(d.id, d.selected, { kind: 'info', text: `Deleted ${d.selected.length} item${d.selected.length === 1 ? '' : 's'}` })
}
/** selected links that currently carry the ❌ dead marker */
const selectedDeadIds = computed(() => {
  const d = doc.value
  if (!d) return [] as string[]
  return d.selected.filter((id) => {
    const n = findNode(d.root, id)
    return !!n && n.type === 'link' && n.dead
  })
})
function restoreSelected(): void {
  const d = doc.value
  if (!d || !selectedDeadIds.value.length) return
  const ids = selectedDeadIds.value
  docs.undoOf(d.id).group(`Revive ${ids.length}`, () => {
    for (const id of ids) docs.mutClearDead(d.id, id)
  })
  ui.notify('success', `Revived ${ids.length} link${ids.length === 1 ? '' : 's'}`)
}

// ---------------- cut / copy / paste ----------------
/** cut rows dim in the source tab (copies stay normal-looking) */
const isCut = (id: string): boolean => clip.mode === 'cut' && clip.srcDocId === props.docId && clip.ids.includes(id)

function cutSelected(): void {
  const d = doc.value
  if (!d) return
  const n = clip.cutSelection(d.id)
  if (n) {
    const from = clip.sourcePath ? ` from "${clip.sourcePath}"` : ''
    ui.notify('info', `${clip.summary} cut${from} — navigate and press ⌘V to paste`)
  } else {
    ui.notify('error', 'Nothing to cut here')
  }
}

function copySelected(): void {
  const d = doc.value
  if (!d) return
  try {
    const n = clip.copySelection(d.id)
    if (n) {
      const from = clip.sourcePath ? ` from "${clip.sourcePath}"` : ''
      ui.notify('info', `${clip.summary} copied${from} — press ⌘V in any tab to paste`)
    } else {
      ui.notify('error', 'Nothing to copy here')
    }
  } catch (err) {
    console.error('[copy]', err)
    ui.notify('error', 'Copy failed — see console')
  }
}

/** paste the clipboard into the current folder, before the selected row if any */
function paste(): void {
  const d = doc.value
  if (!d) return
  if (!clip.has) {
    ui.notify('error', 'Nothing to paste — cut or copy some items first')
    return
  }
  try {
    const n = clip.pasteCurrent(d.id)
    if (n > 0) ui.notify('success', `Pasted ${n} item${n === 1 ? '' : 's'}`)
    else if (clip.srcDocId === null) ui.notify('error', 'Items no longer exist — clipboard cleared')
    else ui.notify('error', 'Nothing to paste here')
  } catch (err) {
    console.error('[paste]', err)
    ui.notify('error', 'Paste failed — see console')
  }
}

function openMenu(e: MouseEvent, n: BmNode): void {
  e.preventDefault()
  // reverted
  const d = doc.value
  if (!d) return
  if (!isSelected(n.id)) docs.select(d.id, [n.id], false)
  const items: any[] = []
  if (n.type === 'link') {
    items.push({ label: 'Show in tree', icon: 'ListTree', action: () => revealInTree(n) })
    items.push({ label: 'Open', icon: 'ExternalLink', action: () => openNode(n) })
  } else {
    items.push({ label: 'Open folder', icon: 'FolderOpen', action: () => openNode(n) })
    items.push({ label: 'Show in tree', icon: 'ListTree', action: () => revealInTree(n) })
  }
  if (n.type === 'link' && n.url) {
    items.push({ label: 'Copy URL', icon: 'Copy', action: () => copyUrl(n) })
  }
  items.push({ label: 'Copy path', icon: 'Clipboard', shortcut: '⌥C', action: () => copyPath(n) })
  items.push('sep')
  items.push({ label: 'Copy', icon: 'CopyPlus', shortcut: '⌘C', action: () => copySelected() })
  items.push({ label: 'Cut', icon: 'Scissors', shortcut: '⌘X', action: () => cutSelected() })
  items.push('sep')
  items.push({ label: 'Edit…', icon: 'Pencil', shortcut: 'F2', action: () => startEdit(n, 'name') })
  items.push({ label: 'Move to folder…', icon: 'FolderPlus', action: () => {
    showPicker.value = true
  } })
  if (n.type === 'folder') {
    items.push({ label: 'New folder inside', icon: 'FolderPlus', action: () => ui.openModal('newFolder', { docId: props.docId, folderId: n.id }) })
    items.push({ label: 'Sort by name', icon: 'Type', action: () => docs.mutSort(props.docId, n.id, 'name') })
    items.push({ label: 'Check links in folder', icon: 'Network', action: () => checkFolder(n) })
  } else {
    items.push('sep')
    items.push({ label: n.dead ? 'Mark as alive' : 'Mark dead', icon: n.dead ? 'Eye' : 'Skull', action: () => {
      if (n.dead) docs.mutClearDead(props.docId, n.id)
      else docs.markDeadNames(props.docId, [n.id])
    } })
    items.push({ label: 'Check link', icon: 'Network', action: () => checkLink(n) })
  }
  items.push({ label: 'Delete', icon: 'Trash2', danger: true, shortcut: 'Del', action: () => {
    confirmDelete(props.docId, isSelected(n.id) ? [...new Set([...d!.selected, n.id])] : [n.id], { kind: 'info', text: 'Deleted' })
  } })
  contextRef.value?.show({ x: e.clientX, y: e.clientY, items, title: n.name })
}

function checkFolder(n: BmNode): void {
  const items: { id: string; url: string }[] = []
  const walk = (x: BmNode) => {
    if (x.type === 'link' && x.url) items.push({ id: x.id, url: x.url })
    for (const c of x.children) walk(c)
  }
  walk(n)
  import('../../state/checker').then(({ useChecker }) => {
    const c = useChecker()
    c.start(props.docId, items, false)
  })
}
function checkLink(n: BmNode): void {
  import('../../state/checker').then(({ useChecker }) => {
    useChecker().start(props.docId, [{ id: n.id, url: n.url || '' }], false)
  })
}

function pickFolder(folderId: string): void {
  const d = doc.value
  if (!d || !d.selected) return
  docs.mutMove(d.id, folder.value!.id, d.selected, folderId, null)
  showPicker.value = false
  ui.notify('success', 'Moved')
}

// ---------------- drag & drop ----------------
function rowDrop(id: string, mode: 'before' | 'inside' | 'after'): string | null {
  if (!dnd.session || dnd.session.docId !== props.docId) return null
  return dnd.target?.folderId === id && dnd.target?.mode === mode ? mode : null
}

function onSourceDragstart(e: MouseEvent, n: BmNode): void {
  const d = doc.value
  if (!d || !folder.value) return
  const t = e.target as HTMLElement
  if (t.closest('button, input, textarea, .bm-actions')) return
  // modifier-pressed mousedowns leave selection to the click handler, so ⌘/⇧
  // clicks can accumulate a multi-selection instead of being clobbered here
  if ((e.metaKey || e.ctrlKey || e.shiftKey) && !isSelected(n.id)) return
  let ids: string[]
  if (isSelected(n.id)) ids = [...d.selected]
  else {
    ids = [n.id]
    docs.select(d.id, ids, false)
  }
  prepareDrag(
    e,
    {
      docId: d.id,
      nodeIds: ids,
      sourceParentId: folder.value.id,
      label: n.name,
      isFolder: ids.length === 1 && n.type === 'folder',
      url: n.url,
    },
    (toFolderId, anchorId) => {
      docs.mutMove(d.id, folder.value!.id, ids, toFolderId, anchorId)
    }
  )
}

function sortMenu(e: MouseEvent): void {
  const d = doc.value
  if (!d || !folder.value) return
  // stop the opening click from bubbling to the document, where ContextMenu's
  // click-outside close-handler would immediately dismiss the menu we just opened
  e.stopPropagation()
  contextRef.value?.show({
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: 'Sort by name', icon: 'Type', action: () => docs.mutSort(props.docId, folder.value!.id, 'name') },
      { label: 'Sort by URL', icon: 'Link2', action: () => docs.mutSort(props.docId, folder.value!.id, 'url') },
      { label: 'Sort by date', icon: 'Calendar', action: () => docs.mutSort(props.docId, folder.value!.id, 'added') },
    ],
  })
}

const totalCount = computed(() => children.value.length)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEditKey)
})
</script>

<template>
  <div
    v-if="doc && folder"
    ref="listRef"
    class="content-list"
    :data-ver="docs.treeVersion"
    tabindex="0"
    @click.self="docs.clearSelection(doc.id)"
    @keydown="onRowKey"
  >
    <div class="cl-head">
      <span class="cl-title truncate">
        <component :is="icon('Folder')" :size="16" />
        {{ isRootView ? 'Other bookmarks' : folder.name || 'Other bookmarks' }}
        <span class="cl-count">{{ totalCount }} items</span>
      </span>
      <div class="cl-actions">
        <button class="toolbar-btn" @click="ui.openModal('newFolder', { docId, folderId: folder.id })">
          <component :is="icon('FolderPlus')" :size="14" /> New folder
        </button>
        <button class="toolbar-btn" @click="ui.openModal('newBookmark', { docId, folderId: folder.id })">
          <component :is="icon('Plus')" :size="14" /> Bookmark
        </button>
        <button class="icon-btn" title="Sort" @click="sortMenu">
          <component :is="icon('List')" :size="15" />
        </button>
        <button class="icon-btn" title="Check links in this folder" @click="checkFolder(folder)">
          <component :is="icon('Network')" :size="15" />
        </button>
        <button class="icon-btn" title="Copy folder path" @click="copyFolderPath">
          <component :is="icon('Folders')" :size="15" />
        </button>
        <button class="toolbar-btn" title="Select all" @click="selectAll">
          <component :is="icon('Check')" :size="14" /> Select all
        </button>
        <button class="toolbar-btn" title="Select all dead links in this folder" @click="selectAllDead">
          <component :is="icon('Skull')" :size="14" /> Select dead
        </button>
        <button class="icon-btn" title="Copy (⌘C)" @click="copySelected">
          <component :is="icon('CopyPlus')" :size="15" />
        </button>
        <button class="icon-btn" title="Cut (⌘X)" @click="cutSelected">
          <component :is="icon('Scissors')" :size="15" />
        </button>
        <button class="icon-btn" title="Paste (⌘V)" @click="paste">
          <component :is="icon('ClipboardPaste')" :size="15" />
        </button>
        <button v-if="doc.selected.length" class="toolbar-btn danger" @click="deleteSelected">
          <component :is="icon('Trash2')" :size="14" /> Delete ({{ doc.selected.length }})
        </button>
        <button v-if="selectedDeadIds.length" class="toolbar-btn" title="Clear the ❌ dead marker on the selected links (keep the bookmarks)" @click="restoreSelected">
          <component :is="icon('Eye')" :size="14" /> Revive ({{ selectedDeadIds.length }})
        </button>
      </div>
    </div>

    <div class="cl-scroll">
      <template v-if="children.length">
        <div
          v-for="n in children"
          :key="n.id"
          class="bm-row"
          :data-dropid="n.id"
          :data-dropparent="folder.id"
          :data-dropkind="n.type"
          :class="{
            selected: isSelected(n.id),
            'folder-row': n.type === 'folder',
            'dead-marked': n.type === 'link' && n.dead,
            dragging: dnd.session?.nodeIds.includes(n.id),
            flashing: flashingId === n.id,
            cut: isCut(n.id),
            drophover: rowDrop(n.id, 'before') || rowDrop(n.id, 'inside') || rowDrop(n.id, 'after'),
          }"
          :data-drophover="rowDrop(n.id, 'before') ? 'before' : rowDrop(n.id, 'inside') ? 'inside' : rowDrop(n.id, 'after') ? 'after' : undefined"
          @click="onClickRow($event, n)"
          @dblclick="onDblClick($event, n)"
          @contextmenu.prevent="openMenu($event, n)"
          @mousedown="onSourceDragstart($event, n)"
        >
          <Favicon v-if="n.type === 'link'" :url="n.url" :name="n.name" :size="18" />
          <span v-else class="folder-tile">
            <component :is="icon('Folder')" :size="15" />
          </span>

          <input
            v-if="editing && editing.node.id === n.id && editing.field === 'name'"
            ref="editInput"
            v-model="editText"
            class="inline-edit"
            @click.stop
            @keydown.enter.stop.prevent="commitEdit"
            @keydown.esc.stop.prevent="editing = null"
            @blur="commitEdit"
          />
          <span v-else class="bm-name">
            <span class="nm" :class="{ dead: n.type === 'link' && n.dead }">{{ n.name }}</span>
          </span>

          <input
            v-if="editing && editing.node.id === n.id && editing.field === 'url'"
            ref="editInput"
            v-model="editText"
            class="inline-edit url-edit"
            @click.stop
            @keydown.enter.stop.prevent="commitEdit"
            @keydown.esc.stop.prevent="editing = null"
            @blur="commitEdit"
          />
          <span v-else-if="n.type === 'link'" class="bm-url">
            {{ hostOf(n.url || '') }}
          </span>
          <span v-else class="bm-url folder-meta">{{ childFolderCount(n) }} folder{{ childFolderCount(n) === 1 ? '' : 's' }}, {{ childLinkCount(n) }} links</span>

          <span class="bm-date">{{ formatDate(n.addDate) }}</span>

          <span class="bm-actions">
            <button class="icon-btn" title="Show in tree" @click.stop="revealInTree(n)">
              <component :is="icon('ListTree')" :size="13" />
            </button>
            <button v-if="n.type === 'link' && n.url" class="icon-btn" title="Check link" @click.stop="checkLink(n)">
              <component :is="icon('Network')" :size="13" />
            </button>
            <button v-if="n.type === 'link' && n.url" class="icon-btn" title="Open" @click.stop="openExternal(n)">
              <component :is="icon('ExternalLink')" :size="13" />
            </button>
            <button v-if="n.type === 'link' && n.url" class="icon-btn" title="Copy URL" @click.stop="copyUrl(n)">
              <component :is="icon('Copy')" :size="13" />
            </button>
            <button class="icon-btn" title="Copy path" @click.stop="copyPath(n)">
              <component :is="icon('Clipboard')" :size="13" />
            </button>
            <button class="icon-btn" title="Edit" @click.stop="startEdit(n, 'name')">
              <component :is="icon('Pencil')" :size="13" />
            </button>
            <button v-if="n.type === 'link'" class="icon-btn" title="Edit name & URL" @click.stop="ui.openModal('editNode', { docId, node: n })">
              <component :is="icon('PencilSparkles')" :size="13" />
            </button>
            <button class="icon-btn danger" title="Delete" @click.stop="confirmDelete(doc.id, [n.id])">
              <component :is="icon('Trash2')" :size="13" />
            </button>
          </span>
        </div>
      </template>

      <div v-else class="cl-empty">
        <component :is="icon('Inbox')" :size="42" class="ce-icon" />
        <h3>This folder is empty</h3>
        <p>Add a folder to organise, or a bookmark you visit a lot.</p>
        <div class="ce-actions">
          <button class="btn" @click="ui.openModal('newFolder', { docId, folderId: folder.id })">
            <component :is="icon('FolderPlus')" :size="14" /> New folder
          </button>
          <button class="btn primary" @click="ui.openModal('newBookmark', { docId, folderId: folder.id })">
            <component :is="icon('Plus')" :size="14" /> Add bookmark
          </button>
          <button class="btn" @click="batchImport">
            <component :is="icon('Upload')" :size="14" /> Import…
          </button>
        </div>
      </div>
    </div>

    <ContextMenu ref="contextRef" />
    <FolderPicker v-if="showPicker" :doc-id="docId" :exclude-id="folder.id" @close="showPicker = false" @picked="pickFolder" />
  </div>
</template>

<style scoped>
.content-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}
.cl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px 6px;
  flex: none;
}
.cl-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 650;
  color: var(--text);
  min-width: 0;
}
.cl-count {
  font-size: 11.5px;
  color: var(--text-3);
  font-weight: 500;
}
.cl-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.cl-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 2px 12px 40px;
}
.bm-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: default;
  user-select: none;
  transition: background var(--speed) var(--ease);
}
.bm-row.flashing {
  animation: bm-list-flash 1.4s ease both;
}
.bm-row.cut {
  opacity: 0.5;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
@keyframes bm-list-flash {
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
.bm-row:hover {
  background: var(--surface-hover);
}
.bm-row.selected {
  background: var(--accent-soft);
}
.bm-row.selected::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}
.bm-row.dragging {
  opacity: 0.4;
}
.bm-row.drophover[data-drophover='inside'] {
  background: var(--accent-softer);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
/* straight insertion line across the row edge — box-shadow would follow the
   row's rounded corners and curve at the ends */
.bm-row.drophover[data-drophover='before']::after,
.bm-row.drophover[data-drophover='after']::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
}
.bm-row.drophover[data-drophover='before']::after {
  top: 0;
}
.bm-row.drophover[data-drophover='after']::after {
  bottom: 0;
}
.bm-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
}
.bm-name .nm {
  overflow: hidden;
  text-overflow: ellipsis;
}
.bm-name .nm.dead {
  color: var(--danger);
}
.bm-url {
  flex: none;
  width: 170px;
  color: var(--text-3);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  direction: rtl;
}
.folder-meta {
  color: var(--text-3);
  direction: ltr;
  text-align: right;
}
.bm-date {
  flex: none;
  width: 92px;
  text-align: right;
  color: var(--text-3);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.bm-actions {
  flex: none;
  display: none;
  align-items: center;
  gap: 1px;
  margin-left: 2px;
}
.bm-row:hover .bm-actions {
  display: inline-flex;
}
.dead-marked {
  background: var(--dead-bg);
}
.inline-edit {
  flex: 1;
  border: none;
  height: 24px;
  border-radius: 5px;
  font-size: inherit;
  color: var(--text);
  outline: none;
  padding: 0 6px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--accent);
  min-width: 0;
}
.inline-edit.url-edit {
  flex: 0 0 240px;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.cl-empty {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ce-icon {
  color: var(--text-3);
  opacity: 0.6;
}
.cl-empty h3 {
  margin: 6px 0 0;
  color: var(--text);
  font-size: 16px;
}
.cl-empty p {
  margin: 0 0 8px;
  color: var(--text-3);
  font-size: 13px;
}
.ce-actions {
  display: flex;
  gap: 8px;
}

/* count helpers live in setup */
</style>
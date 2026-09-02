<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDocs } from './state/docs'
import { usePrefs } from './state/prefs'
import { useUi } from './state/ui'
import { useClipboard } from './state/clipboard'
import { useIcon } from './lib/icons'
import { groupByParent, indexTree } from './lib/tree'
import { loadSampleNames, fetchSampleText } from './lib/samples'
import type { BookmarkDoc } from './types'
import TabStrip from './components/chrome/TabStrip.vue'
import Toolbar from './components/chrome/Toolbar.vue'
import BookmarksBar from './components/chrome/BookmarksBar.vue'
import ManagerView from './components/views/ManagerView.vue'
import SearchView from './components/views/SearchView.vue'
import DuplicatesView from './components/views/DuplicatesView.vue'
import DeadLinksView from './components/views/DeadLinksView.vue'
import CheckerPanel from './components/shared/CheckerPanel.vue'
import Toasts from './components/shared/Toasts.vue'
import Modal from './components/shared/Modal.vue'
import DropZone from './components/shared/DropZone.vue'

const docs = useDocs()
const prefs = usePrefs()
const ui = useUi()
const clip = useClipboard()
const icon = (name: string) => useIcon(name)

const active = computed(() => docs.activeDoc)
const stats = computed(() => {
  docs.treeVersion
  return docs.activeDocId ? docs.statsFor(docs.activeDocId) : null
})
const undoStack = computed<ReturnType<typeof docs.undoOf> | null>(() =>
  docs.activeDocId ? docs.undoOf(docs.activeDocId) : null
)

// which pane (tree vs list) the user last interacted with; resolves what
// ⌘C/⌘X/⌘V refer to when both panes are showing. The tree only wins when it
// actually has a multi-selection — otherwise the list rules apply.
const lastPane = ref<'tree' | 'list'>('list')
function trackPane(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (!t) return
  if (t.closest('.tree-pane')) lastPane.value = 'tree'
  else if (t.closest('.content-list')) lastPane.value = 'list'
}

/** tree folders are the only rows in the tree; effective = topmost selected */
function treeClipboardMode(d: BookmarkDoc): 'tree' | 'list' {
  return lastPane.value === 'tree' && !!d.treeSel?.length ? 'tree' : 'list'
}
function captureTree(d: BookmarkDoc, mode: 'cut' | 'copy'): number {
  const groups = groupByParent(indexTree(d.root).parentOf, d.treeSel ?? [])
  if (!groups.length) return 0
  clip.captureGroups(d.id, groups, mode)
  return groups.flatMap((g) => g.ids).length
}
function copyNow(d: BookmarkDoc): void {
  if (treeClipboardMode(d) === 'tree') {
    const n = captureTree(d, 'copy')
    if (!n) ui.notify('error', 'Nothing to copy here')
    else {
      const from = clip.sourcePath ? ` from “${clip.sourcePath}”` : ''
      ui.notify('info', `${clip.summary} copied${from} — press ⌘V in any tab to paste`)
    }
    return
  }
  const n = clip.copySelection(d.id)
  if (!n) ui.notify('error', 'Nothing to copy here')
  else {
    const from = clip.sourcePath ? ` from “${clip.sourcePath}”` : ''
    ui.notify('info', `${clip.summary} copied${from} — press ⌘V in any tab to paste`)
  }
}
function cutNow(d: BookmarkDoc): void {
  if (treeClipboardMode(d) === 'tree') {
    const n = captureTree(d, 'cut')
    if (!n) ui.notify('error', 'Nothing to cut here')
    else {
      const from = clip.sourcePath ? ` from “${clip.sourcePath}”` : ''
      ui.notify('info', `${clip.summary} cut${from} — navigate and press ⌘V to paste`)
    }
    return
  }
  const n = clip.cutSelection(d.id)
  if (!n) ui.notify('error', 'Nothing to cut here')
  else {
    const from = clip.sourcePath ? ` from “${clip.sourcePath}”` : ''
    ui.notify('info', `${clip.summary} cut${from} — navigate and press ⌘V to paste`)
  }
}
function pasteNow(d: BookmarkDoc): void {
  if (!clip.has) {
    ui.notify('error', 'Nothing to paste — cut or copy some items first')
    return
  }
  // single tree-selected folder → into it; otherwise the list's usual rules
  const n = lastPane.value === 'tree' && d.treeSel?.length === 1 ? clip.pasteInto(d.id, d.treeSel[0], null) : clip.pasteCurrent(d.id)
  if (n > 0) ui.notify('success', `Pasted ${n} item${n === 1 ? '' : 's'}`)
  else if (clip.srcDocId === null) ui.notify('error', 'Cut items no longer exist — clipboard cleared')
  else ui.notify('error', 'Nothing to paste here')
}

function openFiles(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.html,.htm,.json'
  input.multiple = true
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    if (!files.length) return
    const n = await docs.openFiles(files)
    if (n) ui.notify('success', `Opened ${n} file${n === 1 ? '' : 's'} as tab${n === 1 ? '' : 's'}`)
  }
  input.click()
}

function undo(): void {
  if (!docs.activeDocId) return
  docs.undoOf(docs.activeDocId).undo()
  docs.bump()
}
function redo(): void {
  if (!docs.activeDocId) return
  docs.undoOf(docs.activeDocId).redo()
  docs.bump()
}

function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey
  const tag = (e.target as HTMLElement).tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

  // ESC deselects in layers: first the list selection, then the tree multi-select
  if (e.key === 'Escape') {
    const d = docs.activeDoc
    if (!d || d.view !== 'manager' || inInput || ui.modal) return
    if (document.querySelector('.context-menu')) return // the menu already closes on ESC
    if (d.selected.length) {
      docs.clearSelection(d.id)
      return
    }
    if (d.treeSel?.length) d.treeSel = []
    return
  }

  if (!mod) return
  const docId = docs.activeDocId
  if (!docId) return
  if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    if (inInput) return
    docs.undoOf(docId).undo()
  } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
    e.preventDefault()
    if (inInput) return
    docs.undoOf(docId).redo()
  } else if (e.key.toLowerCase() === 'f' && !inInput) {
    e.preventDefault()
    ;(window as any).__focusOmnibox?.()
  } else if (e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'v') {
    // cut/copy/paste work regardless of focus in the manager view (list OR tree)
    if (inInput) return
    const d = docs.activeDoc
    if (!d || d.view !== 'manager') return
    e.preventDefault()
    if (e.key.toLowerCase() === 'c') {
      copyNow(d)
    } else if (e.key.toLowerCase() === 'x') {
      cutNow(d)
    } else {
      pasteNow(d)
    }
  }
}

// edits up to 400ms old sit in a debounced save; flush them when the page
// hides or the window closes so nothing is lost
function flushSaves(): void {
  docs.flushSaves()
}
function onVisibility(): void {
  if (document.visibilityState === 'hidden') flushSaves()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousedown', trackPane, true)
  window.addEventListener('beforeunload', flushSaves)
  document.addEventListener('visibilitychange', onVisibility)
  loadSamples()
})

function openStats(): void {
  if (!docs.activeDocId) return
  ui.openModal('stats', { docId: docs.activeDocId })
}

const samples = ref<string[]>([])
const loadingSamples = ref(false)
async function loadSamples(): Promise<void> {
  if (loadingSamples.value) return
  loadingSamples.value = true
  samples.value = await loadSampleNames()
  loadingSamples.value = false
}
async function openSample(name: string): Promise<void> {
  const text = await fetchSampleText(name)
  if (text == null) return
  const id = docs.openFromText(text, name)
  if (id) ui.notify('success', `Opened ${name}`)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousedown', trackPane, true)
  window.removeEventListener('beforeunload', flushSaves)
  document.removeEventListener('visibilitychange', onVisibility)
})

const viewComponent = computed(() => {
  const d = active.value
  if (!d) return null
  switch (d.view) {
    // "Home" is now the Manager view — the app opens straight into the file manager.
    case 'home':
    case 'manager':
      return ManagerView
    case 'dupes':
      return DuplicatesView
    case 'dead':
      return DeadLinksView
    case 'search':
      return SearchView
    default:
      return ManagerView
  }
})
</script>

<template>
  <div class="app-shell">
    <TabStrip />
    <Toolbar />
    <BookmarksBar v-if="prefs.showBookmarksBar" />

    <div class="page-wrap">
      <template v-if="active">
        <CheckerPanel />
        <Transition name="view" mode="out-in">
          <component :is="viewComponent" :key="active?.id + active?.view" :doc-id="active?.id" />
        </Transition>
      </template>

      <div v-else class="empty-state">
        <component :is="icon('Bookmark')" :size="64" class="es-icon" />
        <h2>Your bookmarks, managed</h2>
        <p class="es-sub">
          Open your exported bookmarks — Netscape HTML from Chrome, Safari, Edge or Firefox, or a Firefox
          JSON backup. You'll get a Chrome-like bookmarks bar, a tree manager, duplicates finder, link checker
          and full drag &amp; drop reorganisation. Everything stays on this computer.
        </p>
        <div class="samples">
          <button class="sample-chip" @click="openFiles">
            <component :is="icon('FolderOpen')" :size="16" /> Open bookmark files…
          </button>
          <button class="sample-chip ghost" @click="docs.newBlankDoc()">
            <component :is="icon('Plus')" :size="16" /> Start a fresh library
          </button>
        </div>
        <template v-if="samples.length">
          <p class="sample-label">Try it with a copy of the files in this folder:</p>
          <div class="samples">
            <button v-for="s in samples" :key="s" class="sample-chip" @click="openSample(s)">
              <component :is="icon('FilePlus2')" :size="15" />
              <span class="truncate" :style="{ maxWidth: '220px' }">{{ s }}</span>
            </button>
          </div>
        </template>
        <p class="es-hint">…or just drop the files anywhere on this window.</p>
      </div>
    </div>

      <div class="status-bar">
        <template v-if="stats">
          <button class="stat stat-link" title="Open library statistics" @click="openStats">
            <b>{{ stats.links }}</b> bookmarks
          </button>
          <span class="stat"><b>{{ stats.folders }}</b> folders</span>
          <span class="stat"><b>{{ stats.uniqueUrls }}</b> unique</span>
          <button v-if="stats.duplicateGroups" class="stat stat-link warn-stat" title="View duplicate bookmarks" @click="active && docs.setView(active.id, 'dupes')">
            <b>{{ stats.duplicateGroups }}</b> duplicate groups
          </button>
          <button v-if="stats.deadLinks" class="stat stat-link dead-stat" title="View all {{ stats.deadLinks }} dead links across every folder" @click="active && docs.setView(active.id, 'dead')">
            <b>{{ stats.deadLinks }}</b> dead ❌
          </button>
        </template>
        <span v-if="clip.has && active" class="clip-chip">
          <component :is="icon(clip.mode === 'copy' ? 'CopyPlus' : 'Scissors')" :size="12" />
          <button class="cc-main" :title="`Paste ${clip.summary} into the current folder`" @click="pasteNow(active)">
            {{ clip.summary }} {{ clip.mode === 'copy' ? 'copied' : 'cut' }}{{ clip.sourcePath ? ` from “${clip.sourcePath}”` : '' }}
          </button>
          <button class="cc-x" title="Cancel" @click="clip.clear()">
            <component :is="icon('X')" :size="12" />
          </button>
        </span>
      <span class="spacer" />
      <button class="icon-btn" title="Undo" :disabled="!undoStack?.canUndo" @click="undo">
        <component :is="icon('Undo2')" :size="15" />
      </button>
      <button class="icon-btn" title="Redo" :disabled="!undoStack?.canRedo" @click="redo">
        <component :is="icon('RotateCcw')" :size="15" />
      </button>
      <span class="kbd hint">⌘Z</span>
    </div>

    <Toasts />
    <Modal />
    <DropZone />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 100vw;
  overflow: hidden;
  background: var(--bg-grad);
}
.page-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  background: var(--bg);
}
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px;
  text-align: center;
  color: var(--text-2);
}
.es-icon {
  color: var(--text-3);
  opacity: 0.7;
  margin-bottom: 6px;
}
.empty-state h2 {
  margin: 0;
  font-size: 24px;
  color: var(--text);
  font-weight: 700;
  letter-spacing: -0.2px;
}
.es-sub {
  max-width: 460px;
  line-height: 1.65;
  margin: 0;
}
.samples {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.sample-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  transition: all 140ms;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}
.sample-chip:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.sample-chip.ghost {
  border-style: dashed;
  background: transparent;
}
.es-hint {
  color: var(--text-3);
  font-size: 12px;
  margin-top: 4px;
}
.status-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 30px;
  padding: 0 12px;
  background: var(--chrome-line);
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  white-space: nowrap;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11.5px;
  cursor: default;
  padding: 2px 6px;
  border-radius: 5px;
  pointer-events: none;
}
/* clickable stats (open a view / the stats sheet) — styled as buttons */
.stat-link {
  cursor: pointer;
  pointer-events: auto;
  border: 1px solid var(--border);
  background: var(--surface2);
}
.stat-link:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--accent);
}
.stat-link b {
  color: var(--text);
  font-weight: 700;
}
.stat b {
  color: var(--text);
  font-weight: 600;
}
.stat.warn-stat b {
  color: var(--warn);
}
.stat.dead-stat b {
  color: var(--danger);
}
.spacer {
  flex: 1;
}
.clip-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 4px 0 8px;
  border-radius: var(--radius-full);
  background: var(--accent-softer);
  border: 1px solid var(--accent);
  color: var(--text);
  max-width: 320px;
  flex: none;
}
.clip-chip .cc-main {
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clip-chip .cc-main:hover {
  color: var(--accent);
}
.clip-chip .cc-x {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  padding: 2px;
  border-radius: 50%;
}
.clip-chip .cc-x:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.hint {
  margin-left: 4px;
}
.view-enter-active,
.view-leave-active {
  transition: opacity 120ms var(--ease);
}
.view-enter-from,
.view-leave-to {
  opacity: 0;
}
</style>
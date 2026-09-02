<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocs } from '../../state/docs'
import { usePrefs } from '../../state/prefs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { loadSampleNames, fetchSampleText } from '../../lib/samples'
import { crumbPath, indexTree, namePath } from '../../lib/tree'

const docs = useDocs()
const prefs = usePrefs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const editing = ref(false)
const text = ref('')
const omni = ref<HTMLInputElement>()

// session-only nav history per document
const history: Record<string, string[]> = {}
const histPos: Record<string, number> = {}
function pushHistory(docId: string, key: string): void {
  const h = (history[docId] ??= [])
  h.length = (histPos[docId] ?? 0) + 1
  h.push(key)
  histPos[docId] = h.length - 1
}

const active = computed(() => docs.activeDoc)
const locationKey = computed(() => {
  const d = active.value
  if (!d) return ''
  switch (d.view) {
    case 'search':
      return `search?q=${d.searchQuery}`
    case 'dupes':
      return 'duplicates'
    case 'dead':
      return 'dead-links'
    default:
      // home/manager both show the file manager
      return `folder/${d.currentFolderId}`
  }
})

watch(locationKey, (k, prev) => {
  if (k && k !== prev && docs.activeDocId) pushHistory(docs.activeDocId, k)
})

const locationUrl = computed(() => {
  docs.treeVersion
  const d = active.value
  if (!d) return 'bookmarks://'
  const key = locationKey.value
  if (key === 'home') return 'bookmarks://home'
  if (key === 'duplicates') return 'bookmarks://tools/duplicates'
  if (key === 'dead-links') return 'bookmarks://tools/dead-links'
  if (key.startsWith('search')) return `bookmarks://search/${d.searchQuery}`
  const crumbs = crumbPath(d.root, d.currentFolderId).map((c) => c.name)
  return 'bookmarks://' + (crumbs.length ? crumbs.join('/') : 'Other bookmarks')
})

function beginEdit(): void {
  const d = active.value
  if (!d) return
  editing.value = true
  text.value = d.view === 'search' ? d.searchQuery : ''
  requestAnimationFrame(() => omni.value?.select())
}

function go(key: string): void {
  const d = active.value
  if (!d) return
  const k = key || text.value.trim()
  if (!k) return
  const t = k.replace(/^bookmarks:\/\//, '').trim()
  if (t.startsWith('search/')) {
    docs.setSearch(d.id, t.slice(7))
    return
  }
  if (t === 'home' || t === '') {
    docs.setView(d.id, 'home')
    return
  }
  // try to resolve a folder by path
  const idx = indexTree(d.root).byId
  const parts = t.split('/').filter(Boolean)
  const pathKey = parts.join('/').toLowerCase()
  for (const [id, node] of [...idx]) {
    if (node.type === 'folder') {
      const names = namePath(d.root, id)
        .map((n) => n.toLowerCase())
        .join('/')
      if (names === pathKey || names.endsWith('/' + pathKey)) {
        docs.setCurrentFolder(d.id, id)
        return
      }
    }
  }
  // fall back to search
  docs.setSearch(d.id, t)
}

function onOmniEnter(): void {
  go(text.value)
  editing.value = false
}

function back(): void {
  const id = docs.activeDocId
  if (!id) return
  const pos = histPos[id] ?? 0
  if (pos <= 0) return
  histPos[id] = pos - 1
  applyKey(history[id]![pos - 1])
}
function forward(): void {
  const id = docs.activeDocId
  if (!id) return
  const pos = histPos[id] ?? 0
  const h = history[id] ?? []
  if (pos >= h.length - 1) return
  histPos[id] = pos + 1
  applyKey(h[pos + 1])
}
function applyKey(key: string): void {
  const d = active.value
  if (!d || !key) return
  if (key === 'home') d.view = 'home'
  else if (key === 'duplicates') d.view = 'dupes'
  else if (key === 'dead-links') d.view = 'dead'
  else if (key.startsWith('search?')) d.view = 'search'
  else if (key.startsWith('folder/')) docs.setCurrentFolder(d.id, key.slice(7))
}

function refresh(): void {
  const d = active.value
  if (!d) return
  ui.notify('info', 'Rewriting tree…')
  d.collapsed = { ...d.collapsed }
}

function openFilePicker(): void {
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

function exportCurrent(): void {
  const d = active.value
  if (!d) return
  ui.openModal('export', { docId: d.id })
}

// spotlight: press cmd/ctrl+L or cmd/ctrl+F to focus omnibox
interface GlobalWindow {
  __focusOmnibox?: () => void
}
const g = window as GlobalWindow
g.__focusOmnibox = beginEdit

// ---- sample library popover ----
const samples = ref<string[]>([])
const samplesOpen = ref(false)
const samplesLoading = ref(false)

async function toggleSamples(): Promise<void> {
  if (samplesOpen.value) {
    samplesOpen.value = false
    return
  }
  if (!samples.value.length && !samplesLoading.value) {
    samplesLoading.value = true
    samples.value = await loadSampleNames()
    samplesLoading.value = false
  }
  samplesOpen.value = true
}
async function pickSample(name: string): Promise<void> {
  samplesOpen.value = false
  const text = await fetchSampleText(name)
  if (text == null) {
    ui.notify('error', `Couldn't load ${name}`)
    return
  }
  const id = docs.openFromText(text, name)
  if (id) ui.notify('success', `Opened ${name}`)
}
function onSampleDocDown(e: MouseEvent): void {
  const t = e.target as HTMLElement | null
  if (samplesOpen.value && t && !t.closest('.sample-wrap')) samplesOpen.value = false
}
function onSampleKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') samplesOpen.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onSampleDocDown)
  window.addEventListener('keydown', onSampleKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onSampleDocDown)
  window.removeEventListener('keydown', onSampleKey)
})
</script>

<template>
  <div class="toolbar" :data-ver="docs.treeVersion">
    <div class="toolbar-group">
      <button class="icon-btn" title="Back" :disabled="(histPos[docs.activeDocId ?? ''] ?? 0) <= 0" @click="back">
        <component :is="icon('ArrowLeft')" :size="17" />
      </button>
      <button class="icon-btn" title="Forward" @click="forward">
        <component :is="icon('ArrowRight')" :size="17" />
      </button>
      <button class="icon-btn" title="Reload" @click="refresh">
        <component :is="icon('RefreshCw')" :size="16" />
      </button>
    </div>

    <div class="omnibox" :class="{ focused: editing }" @click="beginEdit" @focusout="editing = false">
      <span class="omnibox-icon">
        <component :is="icon(locationKey.startsWith('search') || editing ? 'Search' : 'Star')" :size="15" />
      </span>
      <template v-if="editing && active">
        <input
          ref="omni"
          v-model="text"
          placeholder="Search bookmarks, or type a folder path"
          spellcheck="false"
          @keydown.enter="onOmniEnter"
          @keydown.esc="editing = false"
          @click.stop
        />
      </template>
      <template v-else>
        <span class="omnibox-path truncate">{{ locationUrl }}</span>
      </template>
    </div>

    <div class="toolbar-group">
      <button class="toolbar-btn" :class="{ active: active?.view === 'home' || active?.view === 'manager' }" title="File manager" @click="active && docs.setView(active.id, 'manager')">
        <component :is="icon('Layers')" :size="15" />
        Manager
      </button>
      <button class="toolbar-btn" :class="{ active: active?.view === 'dupes' }" title="Duplicate bookmarks" @click="active && docs.setView(active.id, 'dupes')">
        <component :is="icon('Copy')" :size="15" />
        Dups
      </button>
      <button class="toolbar-btn" :class="{ active: active?.view === 'dead' }" title="Dead links" @click="active && docs.setView(active.id, 'dead')">
        <component :is="icon('Skull')" :size="15" />
        Dead
      </button>
    </div>

    <div class="toolbar-group">
      <div class="sample-wrap">
        <button class="icon-btn" title="Open a sample library" @click="toggleSamples">
          <component :is="icon('FlaskConical')" :size="16" />
        </button>
        <div v-if="samplesOpen" class="sample-pop">
          <div class="sp-title">Sample libraries</div>
          <button v-if="samplesLoading" class="sp-item" disabled>Loading…</button>
          <template v-else-if="samples.length">
            <button v-for="s in samples" :key="s" class="sp-item" @click="pickSample(s)">
              <component :is="icon('FilePlus2')" :size="14" />
              <span class="sp-name">{{ s }}</span>
            </button>
          </template>
          <div v-else class="sp-empty">No samples available</div>
        </div>
      </div>
      <button class="icon-btn" title="Open file" @click="openFilePicker">
        <component :is="icon('FolderOpen')" :size="16" />
      </button>
      <button class="icon-btn" title="Export…" @click="exportCurrent">
        <component :is="icon('Download')" :size="16" />
      </button>
      <button class="icon-btn" title="Import into current file" @click="active && ui.openModal('importTarget', { docId: active.id })">
        <component :is="icon('Upload')" :size="16" />
      </button>
    </div>

    <div class="toolbar-group">
      <button class="icon-btn" title="About & help" @click="ui.openModal('about')">
        <component :is="icon('CircleHelp')" :size="16" />
      </button>
      <button class="icon-btn" :title="prefs.theme === 'dark' ? 'Light theme' : 'Dark theme'" @click="prefs.toggleTheme()">
        <component :is="icon(prefs.theme === 'dark' ? 'Sun' : 'Moon')" :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  margin-right: 8px;
  border-right: 1px solid var(--border);
}
.toolbar-group:last-child {
  border-right: none;
  margin-right: 0;
  padding-right: 0;
}

.omnibox {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  background: var(--surface2);
  border: 1px solid var(--border);
  transition: border-color var(--speed) var(--ease), background var(--speed) var(--ease), box-shadow var(--speed) var(--ease);
  cursor: text;
  min-width: 120px;
}
.omnibox.focused {
  background: var(--surface);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-softer);
}
.omnibox input {
  border: none;
  background: transparent;
  color: var(--text);
  outline: none;
  flex: 1;
  font-size: 13px;
  min-width: 0;
}
.omnibox-icon {
  color: var(--text-3);
  display: inline-flex;
  flex: none;
}
.omnibox-path {
  color: var(--text-3);
  font-size: 12px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sample-wrap {
  position: relative;
  display: inline-flex;
}
.sample-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 80;
  min-width: 230px;
  max-width: 300px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-lg);
  padding: 5px;
  animation: pop-in 110ms var(--ease);
}
.sp-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-3);
  padding: 6px 10px 3px;
  font-weight: 700;
}
.sp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: var(--radius-s);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.sp-item:hover {
  background: var(--accent-soft);
}
.sp-item:disabled {
  opacity: 0.5;
}
.sp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-empty {
  padding: 12px;
  color: var(--text-3);
  text-align: center;
  font-size: 12px;
}
</style>
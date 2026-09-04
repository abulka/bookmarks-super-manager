<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useDocs } from '../../state/docs'
import { usePrefs } from '../../state/prefs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { loadSampleNames, fetchSampleText } from '../../lib/samples'
import { crumbPath, indexTree, namePath } from '../../lib/tree'
import { isChromeExt, chromeBackend, getBaseline, setBaseline, plainEquals, chromeRootToNode } from '../../lib/backend/chrome'
import { planApply, applyToChrome } from '../../lib/backend/chromeSync'
import type { BookmarkDoc } from '../../types'

const docs = useDocs()
const prefs = usePrefs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const editing = ref(false)
const text = ref('')
const omni = ref<HTMLInputElement>()

// session-only nav history per document
const history = reactive<Record<string, string[]>>({})
const histPos = reactive<Record<string, number>>({})
function pushHistory(docId: string, key: string): void {
  const h = (history[docId] ??= [])
  const pos = histPos[docId] ?? 0
  if (h.length > pos + 1) h.length = pos + 1
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
  if (!k || k === prev) return
  const id = docs.activeDocId
  if (!id) return
  if (history[id]?.[histPos[id]] === k) return
  pushHistory(id, k)
})

const seeded: Record<string, boolean> = {}
watch(
  () => docs.activeDocId,
  (id) => {
    if (!id || seeded[id]) return
    seeded[id] = true
    const k = locationKey.value
    if (k && !history[id]?.length) pushHistory(id, k)
  },
  { immediate: true }
)

const canBack = computed(() => (histPos[docs.activeDocId ?? ''] ?? 0) > 0)
const canForward = computed(() => {
  const id = docs.activeDocId ?? ''
  const pos = histPos[id] ?? 0
  return pos < (history[id]?.length ?? 0) - 1
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

async function refresh(): Promise<void> {
  const d = active.value
  if (!d) return
  // on the live Chrome tab, Reload really reloads: re-read chrome.bookmarks
  // (confirm first when unapplied edits would be discarded)
  if (d.ephemeral && isChromeExt()) {
    await reloadFromChrome(d, !!d.dirty)
    return
  }
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

// ---- Apply to Chrome (live doc, extension only) ---------------------------
const isChromeDoc = computed(() => !!active.value?.ephemeral && isChromeExt())
const applyingNow = ref(false)

/**
 * Real reload for the live Chrome tab: re-reads chrome.bookmarks and replaces
 * the tab's tree. Unapplied edits are discarded, so a dirty doc confirms
 * first. This is the recovery path when Apply is blocked by outside changes.
 */
async function reloadFromChrome(d: BookmarkDoc, confirmFirst: boolean): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      const backend = chromeBackend()
      const fresh = await backend.getTree()
      const baseline = getBaseline(d.id)
      if (baseline && plainEquals(baseline, fresh)) {
        ui.notify('info', 'Already up to date with Chrome — nothing to reload.')
        return
      }
      docs.replaceChromeRoot(d.id, chromeRootToNode(fresh))
      setBaseline(d.id, fresh)
      ui.notify('success', 'Reloaded — this tab now shows the current Chrome bookmarks.')
    } catch {
      ui.notify('error', 'Could not read the Chrome bookmarks — try again in a moment.', undefined, 6000)
    }
  }
  if (!confirmFirst) {
    await run()
    return
  }
  ui.openModal('confirm', {
    title: 'Reload from Chrome?',
    message:
      "Chrome's bookmarks always take priority over this tab. Reloading replaces the tab with the current Chrome bookmarks and discards the unapplied edits in this tab — they cannot be recovered. To keep a copy of your edits, export the tab first. Cancel leaves the tab unchanged, but its edits still cannot be applied.",
    confirmLabel: 'Discard edits and reload',
    danger: true,
    onConfirm: run,
  })
}

async function apply(d: BookmarkDoc, backend: ReturnType<typeof chromeBackend>, summary: string): Promise<void> {
  const r = await applyToChrome(d, backend)
  if (r.ok) {
    setBaseline(d.id, r.tree)
    docs.markExported(d.id)
    docs.bump()
    ui.notify('success', `Applied to Chrome: ${summary}`)
  } else {
    const n = r.failures.length
    ui.notify(
      'error',
      `Applied with ${n} failure${n === 1 ? '' : 's'}. Chrome and this tab still differ — nothing was lost: the tab stays dirty, and pressing Apply to Chrome again re-diffs and retries only what is missing.`,
      undefined,
      0,
    )
  }
}

async function onApplyToChrome(): Promise<void> {
  const d = active.value
  if (!d || !isChromeDoc.value || applyingNow.value) return
  applyingNow.value = true
  try {
    let backend: ReturnType<typeof chromeBackend>
    try {
      backend = chromeBackend()
    } catch {
      ui.notify('error', 'chrome.bookmarks is not available in this context')
      return
    }
    let plan
    try {
      plan = await planApply(d.root, getBaseline(d.id), backend)
    } catch {
      ui.notify('error', 'Could not read the current Chrome bookmarks')
      return
    }
    if (plan.blocked) {
      ui.notify(
        "error",
        "The Chrome bookmarks changed since this tab was loaded, and Chrome always takes priority — the edits in this tab can no longer be applied. Click the ↻ Reload button to start from the current bookmarks (your edits here are discarded), then redo your changes.",
        undefined,
        0,
      )
      return
    }
    if (!plan.ops.length) {
      docs.markExported(d.id)
      ui.notify('success', 'Chrome bookmarks are already in sync')
      return
    }
    const c = plan.counts
    const parts: string[] = []
    if (c.created) parts.push(`create ${c.created}`)
    if (c.updated) parts.push(`rename/edit ${c.updated}`)
    if (c.moved) parts.push(`move ${c.moved}`)
    if (c.deleted) parts.push(`DELETE ${c.deleted}`)
    const summary = parts.join(', ')
    if (prefs.skipApplyConfirm) {
      await apply(d, backend, summary)
      return
    }
    ui.openModal('confirm', {
      title: 'Apply to Chrome?',
      message: `This writes to your real Chrome bookmarks: ${summary}.`,
      confirmLabel: 'Apply to Chrome',
      danger: c.deleted > 0,
      checkbox: { label: `Don't ask again` },
      onConfirm: async (checked?: boolean) => {
        if (checked) prefs.skipApplyConfirm = true
        await apply(d, backend, summary)
      },
    })
  } finally {
    applyingNow.value = false
  }
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
function onGlobalKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (samplesOpen.value) {
    samplesOpen.value = false
    return
  }
  const d = active.value
  if (d && d.view === 'search') {
    editing.value = false
    docs.setView(d.id, 'manager')
  }
}
onMounted(() => {
  document.addEventListener('mousedown', onSampleDocDown)
  window.addEventListener('keydown', onGlobalKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onSampleDocDown)
  window.removeEventListener('keydown', onGlobalKey)
})
</script>

<template>
  <div class="toolbar" :data-ver="docs.treeVersion">
    <div class="toolbar-group">
      <button class="icon-btn" title="Back" :disabled="!canBack" @click="back">
        <component :is="icon('ArrowLeft')" :size="17" />
      </button>
      <button class="icon-btn" title="Forward" :disabled="!canForward" @click="forward">
        <component :is="icon('ArrowRight')" :size="17" />
      </button>
      <button
        class="icon-btn"
        :title="isChromeDoc ? (active?.dirty ? 'Reload from Chrome — discards unapplied edits' : 'Reload from Chrome') : 'Reload'"
        @click="refresh"
      >
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
      <button
        v-if="isChromeDoc"
        class="toolbar-btn apply-btn"
        :class="{ active: active?.dirty }"
        :title="active?.dirty ? 'Write your changes back to Chrome' : 'No changes to apply'"
        :disabled="!active?.dirty || applyingNow"
        @click="onApplyToChrome"
      >
        <component :is="icon('CloudUpload')" :size="15" />
        Apply to Chrome
      </button>
      <button class="icon-btn" title="Settings" @click="ui.openModal('settings')">
        <component :is="icon('Settings2')" :size="16" />
      </button>
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
.apply-btn {
  position: relative;
  color: var(--text-2);
}
.apply-btn:disabled {
  opacity: 0.4;
}
.apply-btn:not(:disabled) {
  background: var(--ok);
  color: var(--ok-ink);
  font-weight: 600;
  box-shadow: 0 0 0 3px var(--ok-soft);
}
.apply-btn:not(:disabled):hover {
  filter: brightness(1.08);
}
/* gentle attention pulse while the button is actionable */
.apply-btn:not(:disabled)::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ok-soft);
  z-index: -1;
  animation: apply-pulse 2.6s var(--ease) infinite;
}
@keyframes apply-pulse {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  70%,
  100% {
    opacity: 0;
    transform: scale(1.28);
  }
}
@media (prefers-reduced-motion: reduce) {
  .apply-btn:not(:disabled)::after {
    animation: none;
  }
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
<script setup lang="ts">
import { computed, ref } from 'vue'
import { toRaw } from 'vue'
import { useDocs } from '../../state/docs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { findDuplicates } from '../../lib/tree'
import { confirmDelete } from '../../lib/confirmDelete'
import { formatDate } from '../../lib/date'
import { hostOf, isPrivateHost } from '../../lib/url'
import type { BmNode } from '../../types'
import type { DupGroup } from '../../lib/tree'
import Favicon from '../shared/Favicon.vue'
import FolderPicker from '../shared/FolderPicker.vue'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.byId(props.docId))
const groupState = ref<Record<string, boolean>>({})
const showPicker = ref(false)
const pickGroupKey = ref('')

const dupReport = computed(() => {
  docs.treeVersion
  return doc.value ? findDuplicates(toRaw(doc.value.root)) : null
})
const groups = computed(() => dupReport.value?.groups ?? [])

const sameFolderOnly = ref(false)
const filteredGroups = computed(() => {
  if (!sameFolderOnly.value) return groups.value
  return groups.value.filter((g) => g.members.every((m) => sameLeafKey(m.parentPathNames)))
})
function sameLeafKey(pathNames: string[]): string {
  return pathNames.join('\u0000')
}

const hideLocal = ref(false)
const hostState = ref<Record<string, boolean>>({})

interface HostSection {
  host: string
  groups: DupGroup[]
}

const hostSections = computed<HostSection[]>(() => {
  const gs = filteredGroups.value.filter((g) => !hideLocal.value || !isPrivateHost(hostOf(g.url)))
  const byHost = new Map<string, HostSection>()
  for (const g of gs) {
    const host = hostOf(g.url)
    let s = byHost.get(host)
    if (!s) {
      s = { host, groups: [] }
      byHost.set(host, s)
    }
    s.groups.push(g)
  }
  const sections = [...byHost.values()]
  sections.sort((a, b) => totalCopies(b) - totalCopies(a) || a.host.localeCompare(b.host))
  return sections
})

function totalCopies(s: HostSection): number {
  return s.groups.reduce((n, g) => n + g.members.length, 0)
}

const shownCount = computed(() => {
  let extras = 0
  for (const s of hostSections.value) for (const g of s.groups) extras += g.members.length - 1
  return { extras, groups: hostSections.value.reduce((n, s) => n + s.groups.length, 0) }
})

function openHost(host: string): void {
  // undefined means "expanded by default" (see host-body v-if)
  hostState.value[host] = hostState.value[host] === false
}

// ---- actions ----
function keepNewest(g: (typeof groups.value)[number]): void {
  const d = doc.value
  if (!d) return
  const newest = [...g.members].sort((a, b) => (b.node.addDate ?? 0) - (a.node.addDate ?? 0))[0]
  const removeIds = g.members.filter((m) => m.node.id !== newest.node.id).map((m) => m.node.id)
  if (removeIds.length) {
    confirmDelete(d.id, removeIds, { kind: 'success', text: `Removed ${removeIds.length} duplicate${removeIds.length === 1 ? '' : 's'}, kept newest` })
  }
}
function deleteAll(g: (typeof groups.value)[number]): void {
  const d = doc.value
  if (!d) return
  const ids = g.members.map((m) => m.node.id)
  confirmDelete(d.id, ids.slice(1), { kind: 'info', text: `Removed ${ids.length - 1} duplicates (kept one per URL)` })
}
function revealPath(m: (typeof groups.value)[number]['members'][number]): void {
  docs.revealPath(props.docId, m.node.id)
}
function openGroup(g: (typeof groups.value)[number]): void {
  groupState.value[g.key] = !groupState.value[g.key]
}
function moveGroup(g: (typeof groups.value)[number]): void {
  pickGroupKey.value = g.key
  showPicker.value = true
}
function pickFolder(folderId: string): void {
  const d = doc.value
  if (!d) return
  const g = groups.value.find((x) => x.key === pickGroupKey.value)
  if (g) {
    docs.undoOf(d.id).group('Move duplicates', () => {
      for (const m of g.members) {
        const parent = findSomeParent(d.root, m.node.id)
        docs.mutMove(d.id, parent, [m.node.id], folderId, null)
      }
    })
    docs.setView(d.id, 'manager')
    ui.notify('success', 'Moved duplicates')
  }
  showPicker.value = false
}
function findSomeParent(root: BmNode, id: string): string {
  const stk = [root]
  while (stk.length) {
    const cur = stk.pop()!
    for (const c of cur.children) {
      if (c.id === id) return cur.id
      if (c.type === 'folder') stk.push(c)
    }
  }
  return root.id
}

function keepNewestAll(): void {
  const d = doc.value
  if (!d || !dupReport.value) return
  const removeIds: string[] = []
  for (const g of dupReport.value.groups) {
    const newest = [...g.members].sort((a, b) => (b.node.addDate ?? 0) - (a.node.addDate ?? 0))[0]
    for (const m of g.members) if (m.node.id !== newest.node.id) removeIds.push(m.node.id)
  }
  confirmDelete(d.id, removeIds, { kind: 'success', text: `Consolidated: removed ${removeIds.length} duplicate copies` })
}
</script>

<template>
  <div v-if="doc" class="dups-view" :data-ver="docs.treeVersion">
    <div class="dups-head">
      <div class="dh-title">
        <component :is="icon('Copy')" :size="16" />
        Duplicate bookmarks
        <span v-if="dupReport" class="dh-count">{{ shownCount.extras }} extra copies in {{ shownCount.groups }} groups</span>
      </div>
      <div class="dh-actions">
        <label class="toggle">
          <input v-model="sameFolderOnly" type="checkbox" />
          <span>Same folder only</span>
        </label>
        <label class="toggle">
          <input v-model="hideLocal" type="checkbox" />
          <span>Hide local/dev hosts</span>
        </label>
        <button v-if="groups.length" class="btn sm" :disabled="!dupReport!.totalDuplicates" @click="keepNewestAll">
          <component :is="icon('BookmarkCheck')" :size="14" />
          Consolidate all (keep newest)
        </button>
      </div>
    </div>

    <div class="dup-list">
      <div v-if="!hostSections.length" class="empty-list">
        <component :is="icon('BookmarkCheck')" :size="44" />
        <p>No duplicates{{ sameFolderOnly ? ' in the same folder' : '' }}{{ hideLocal ? ' on public hosts' : '' }}. Nice and tidy.</p>
      </div>

      <div v-for="sec in hostSections" :key="sec.host" class="host-group">
        <button class="host-header" @click="openHost(sec.host)">
          <Favicon :url="'https://' + sec.host" :name="sec.host" :size="16" />
          <span class="hh-name truncate">{{ sec.host }}</span>
          <span class="hh-count">{{ sec.groups.length }} groups · {{ totalCopies(sec) }} copies</span>
          <span class="dg-caret"><component :is="icon('ChevronDown')" :size="14" /></span>
        </button>

        <Transition name="fade">
          <div v-if="hostState[sec.host] !== false" class="host-body">
            <div v-for="g in sec.groups" :key="g.key" class="dup-group">
              <button class="dup-header" @click="openGroup(g)">
                <Favicon :url="g.url" :name="g.url" :size="17" />
                <span class="dg-name truncate">{{ g.members[0].node.name }}</span>
                <span class="dg-host">{{ hostOf(g.url) }}</span>
                <span class="dg-n">{{ g.members.length }}×</span>
                <span class="dg-caret"><component :is="icon('ChevronDown')" :size="14" /></span>
              </button>

              <Transition name="fade">
                <div v-if="groupState[g.key]" class="dup-body">
                  <div class="dup-guide">Select which copies to keep → you can drag to re-arrange too</div>
                  <div
                    v-for="m in g.members"
                    :key="m.node.id"
                    class="dup-row"
                    :class="{ selected: doc.selected.includes(m.node.id) }"
                    @click="docs.select(doc.id, [m.node.id], true)"
                    @dblclick="revealPath(m)"
                  >
                    <span class="dr-path truncate">{{ m.parentPathNames.join(' › ') || 'Top level' }}</span>
                    <span class="dr-date">{{ formatDate(m.node.addDate) }}</span>
                    <span class="dr-actions">
                      <button class="icon-btn" title="Reveal" @click.stop="revealPath(m)"><component :is="icon('ListTree')" :size="13" /></button>
                    </span>
                  </div>
                  <div class="dup-footer">
                    <button class="btn sm primary" @click="keepNewest(g)">
                      <component :is="icon('BookmarkCheck')" :size="13" /> Keep newest
                    </button>
                    <button class="btn sm" @click="moveGroup(g)">
                      <component :is="icon('FolderPlus')" :size="13" /> Move all to folder…
                    </button>
                    <button class="btn sm danger" @click="deleteAll(g)">
                      <component :is="icon('Trash2')" :size="13" /> Remove copies
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <FolderPicker v-if="showPicker" :doc-id="docId" @close="showPicker = false" @picked="pickFolder" />
  </div>
</template>

<style scoped>
.dups-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dups-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex: none;
  flex-wrap: wrap;
}
.dh-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
}
.dh-count {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
}
.dh-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}
.dup-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 60px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.host-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--surface);
  overflow: hidden;
  /* inside the scrollable flex .dup-list, overflow:hidden would otherwise
     make min-height:auto resolve to 0 and collapse every group to its border */
  flex-shrink: 0;
}
.host-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: none;
  cursor: pointer;
  background: var(--surface2);
  color: var(--text);
  width: 100%;
  text-align: left;
}
.host-header:hover {
  background: var(--surface-hover);
}
.hh-name {
  flex: 1;
  font-size: 13.5px;
  font-weight: 650;
  min-width: 0;
}
.hh-count {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
  background: var(--surface3);
  border-radius: 999px;
  padding: 1px 9px;
}
.host-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
}
.dup-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--surface);
  overflow: hidden;
}
.dup-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  background: var(--surface2);
  color: var(--text);
  width: 100%;
  text-align: left;
}
.dup-header:hover {
  background: var(--surface-hover);
}
.dg-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  min-width: 0;
}
.dg-host {
  color: var(--text-3);
  font-size: 11.5px;
  flex: none;
}
.dg-n {
  flex: none;
  font-size: 11px;
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 999px;
  padding: 0 8px;
  height: 17px;
  line-height: 17px;
  font-weight: 700;
}
.dg-caret {
  color: var(--text-3);
  display: inline-flex;
  flex: none;
}
.dup-guide {
  margin: 10px auto 0;
  display: inline-flex;
  width: max-content;
  padding: 3px 14px;
  border-radius: 999px;
  color: var(--text-3);
  font-size: 11.5px;
}
.dup-body {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dup-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  padding-right: 40px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--speed) var(--ease);
}
.dup-row:hover {
  background: var(--surface-hover);
}
.dup-row.selected {
  background: var(--accent-soft);
}
.dr-path {
  color: var(--text-2);
  font-size: 12.5px;
  flex: 1;
  min-width: 0;
}
.dr-date {
  color: var(--text-3);
  font-size: 11px;
  flex: none;
}
.dr-actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  flex: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--speed) var(--ease);
}
.dup-row:hover .dr-actions {
  opacity: 1;
  visibility: visible;
}
.dup-footer {
  display: flex;
  gap: 8px;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--border);
}
.empty-list {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
</style>
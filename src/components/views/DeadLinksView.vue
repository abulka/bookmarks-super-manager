<script setup lang="ts">
import { computed } from 'vue'
import { useDocs } from '../../state/docs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { hostOf } from '../../lib/url'
import type { BmNode } from '../../types'
import Favicon from '../shared/Favicon.vue'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.byId(props.docId))

interface DeadItem {
  node: BmNode
  pathNames: string[]
}
const deadItems = computed<DeadItem[]>(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return []
  const out: DeadItem[] = []
  const stk: { n: BmNode; names: string[] }[] = d.root.children.map((c) => ({ n: c, names: [c.name] }))
  while (stk.length) {
    const cur = stk.pop()!
    for (const c of cur.n.children) {
      if (c.type === 'link' && c.dead) {
        out.push({ node: c, pathNames: cur.names })
      }
      if (c.type === 'folder') stk.push({ n: c, names: [...cur.names, c.name] })
    }
  }
  out.sort((a, b) => (a.node.name || '').localeCompare(b.node.name || ''))
  return out
})

function refreshCheck(): void {
  const d = doc.value
  if (!d) return
  const items: { id: string; url: string }[] = []
  const visit = (n: BmNode) => {
    if (n.type === 'link' && n.url) items.push({ id: n.id, url: n.url })
    for (const c of n.children) visit(c)
  }
  visit(d.root)
  import('../../state/checker').then(({ useChecker }) => {
    useChecker().start(d.id, items, false)
  })
}
function collectAll(): void {
  const ids = deadItems.value.map((x) => x.node.id)
  docs.collectDead(props.docId, ids)
  ui.notify('success', `Collected ${ids.length} dead links into a folder`)
}
function purgeAll(): void {
  const ids = deadItems.value.map((x) => x.node.id)
  docs.mutDelete(props.docId, ids)
  ui.notify('success', `Purged ${ids.length} dead links`)
}
function restoreAll(): void {
  const ids = deadItems.value.map((x) => x.node.id)
  docs.undoOf(props.docId).group(`Restore ${ids.length}`, () => {
    for (const id of ids) docs.mutClearDead(props.docId, id)
  })
  ui.notify('success', `Restored ${ids.length} bookmarks`)
}
function restoreSelected(): void {
  const d = doc.value
  if (!d || !d.selected.length) return
  const ids = d.selected
  docs.undoOf(d.id).group(`Restore ${ids.length}`, () => {
    for (const id of ids) docs.mutClearDead(d.id, id)
  })
  ui.notify('success', `Restored ${ids.length} bookmark${ids.length === 1 ? '' : 's'}`)
}
function rewriteAll(): void {
  const d = doc.value
  if (!d) return
  // rewrite the current selection if any, otherwise every dead link
  const ids = d.selected.length ? d.selected : undefined
  const n = docs.rewriteLinks(props.docId, ids)
  if (n) ui.notify('success', `Rewrote ${n} link${n === 1 ? '' : 's'} to current URLs`)
  else ui.notify('info', 'No rewritable links found')
}
function openExternal(n: BmNode): void {
  if (n.url) window.open(n.url, '_blank', 'noopener')
}
function selectAll(): void {
  docs.select(
    doc.value!.id,
    deadItems.value.map((x) => x.node.id),
    false,
  )
}
function clearSelection(): void {
  docs.clearSelection(doc.value!.id)
}
function onRowClick(e: MouseEvent, id: string): void {
  const d = doc.value
  if (!d) return
  if (e.metaKey || e.ctrlKey || e.shiftKey) docs.select(d.id, [id], true)
  else docs.select(d.id, [id], false)
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    selectAll()
  }
}
</script>

<template>
  <div v-if="doc" class="dead-view" :data-ver="docs.treeVersion">
    <div class="dead-head">
      <div class="dh-title">
        <component :is="icon('Skull')" :size="16" />
        Dead links
        <span class="dh-count">{{ deadItems.length }} marked</span>
      </div>
      <div class="dh-actions">
        <button class="btn sm" title="Re-check every link in this file and update dead markers" @click="refreshCheck">
          <component :is="icon('Network')" :size="14" /> Check all links
        </button>
        <button v-if="deadItems.length" class="btn sm" title="Clear the ❌ dead marker from every link (bookmarks are kept)" @click="restoreAll">
          <component :is="icon('RotateCcw')" :size="14" /> Revive all
        </button>
        <button v-if="deadItems.length" class="btn sm danger" title="Move every dead link into a 'Dead links' folder for review" @click="collectAll">
          <component :is="icon('FolderPlus')" :size="14" /> Collect into folder
        </button>
        <button v-if="deadItems.length" class="btn sm danger" title="Delete every dead link from this file" @click="purgeAll">
          <component :is="icon('Trash2')" :size="14" /> Purge all {{ deadItems.length }}
        </button>
        <button v-if="deadItems.length" class="btn sm" title="Update URLs to their current location where a rewrite rule applies" @click="rewriteAll">
          <component :is="icon('RefreshCw')" :size="14" /> Rewrite links
        </button>
        <button v-if="deadItems.length" class="btn sm ghost" title="Select every dead link in this file" @click="selectAll">
          <component :is="icon('Check')" :size="14" /> Select all
        </button>
        <button v-if="doc && doc.selected.length" class="btn sm" title="Clear the ❌ dead marker on the selected links (keep them)" @click="restoreSelected">
          <component :is="icon('Eye')" :size="14" /> Restore selected ({{ doc.selected.length }})
        </button>
        <button v-if="doc && doc.selected.length" class="btn sm ghost" title="Clear the current selection" @click="clearSelection">
          <component :is="icon('X')" :size="14" /> Clear ({{ doc.selected.length }})
        </button>
      </div>
    </div>

    <div class="dead-list" @keydown="onKeydown">
      <div v-if="!deadItems.length" class="empty-list">
        <component :is="icon('Skull')" :size="44" />
        <p>Nothing marked dead yet. Run the link checker to find broken bookmarks.</p>
        <button class="btn primary" @click="refreshCheck">
          <component :is="icon('Network')" :size="14" /> Check all links
        </button>
      </div>

      <div v-for="x in deadItems" :key="x.node.id" class="dead-row" :class="{ selected: doc.selected.includes(x.node.id) }" @click="onRowClick($event, x.node.id)">
        <Favicon :url="x.node.url" :name="x.node.name" :size="17" />
        <span class="dr-name truncate">{{ x.node.name }}</span>
        <span class="dr-path truncate">{{ x.pathNames.join(' › ') || 'Top level' }}</span>
        <span class="dr-url truncate">{{ hostOf(x.node.url || '') }}</span>
        <span class="dr-actions">
          <button class="icon-btn" title="Open" @click.stop="openExternal(x.node)"><component :is="icon('ExternalLink')" :size="13" /></button>
          <button class="icon-btn" title="Mark alive" @click.stop="docs.mutClearDead(doc.id, x.node.id)"><component :is="icon('Eye')" :size="13" /></button>
          <button class="icon-btn danger" title="Purge" @click.stop="docs.mutDelete(doc.id, [x.node.id])"><component :is="icon('Trash2')" :size="13" /></button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dead-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dead-head {
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
}
.dh-count {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
}
.dh-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.dead-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px 60px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dead-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: pointer;
  border-left: 3px solid var(--danger);
  background: var(--dead-bg);
}
.dead-row:hover {
  background: var(--danger-soft);
}
.dead-row.selected {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.dr-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--danger);
  font-weight: 500;
}
.dr-path {
  flex: none;
  max-width: 260px;
  color: var(--text-3);
  font-size: 11.5px;
}
.dr-url {
  flex: none;
  width: 150px;
  color: var(--text-3);
  font-size: 11.5px;
}
.dr-actions {
  flex: none;
  display: inline-flex;
  visibility: hidden;
  opacity: 0;
  transition: opacity 120ms var(--ease);
}
.dead-row:hover .dr-actions {
  visibility: visible;
  opacity: 1;
}
.empty-list {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
</style>
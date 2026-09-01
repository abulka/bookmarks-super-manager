<script setup lang="ts">
import { computed } from 'vue'
import { useDocs } from '../../state/docs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { hostOf } from '../../lib/url'
import { namePath } from '../../lib/tree'
import type { BmNode } from '../../types'
import Favicon from '../shared/Favicon.vue'

const props = defineProps<{ docId: string }>()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.byId(props.docId))
const q = computed(() => docs.byId(props.docId)?.searchQuery ?? '')

interface Hit {
  node: BmNode
  folderNames: string[]
}
const results = computed<Hit[]>(() => {
  docs.treeVersion
  const d = doc.value
  const query = q.value.trim().toLowerCase()
  if (!d || !query) return []
  const out: Hit[] = []
  // top-level chrome folders ("Bookmarks bar", "Other bookmarks", …) are searchable too
  for (const c of d.root.children) {
    if (c.type === 'folder' && c.name.toLowerCase().includes(query)) out.push({ node: c, folderNames: [] })
  }
  const stk: { n: BmNode; names: string[] }[] = d.root.children.map((c) => ({ n: c, names: [c.name] }))
  while (stk.length) {
    const { n, names } = stk.pop()!
    // the folder path shown next to a hit drops the top-level chrome folder
    const inFolder = names.length > 1 ? names.slice(1) : names
    for (const c of n.children) {
      const nm = [...names, c.name]
      if (c.type === 'folder') {
        // folders themselves are searchable — the query may target a folder name
        if (c.name.toLowerCase().includes(query)) out.push({ node: c, folderNames: inFolder })
        stk.push({ n: c, names: nm })
      } else if (c.name.toLowerCase().includes(query) || (c.url || '').toLowerCase().includes(query)) {
        out.push({ node: c, folderNames: inFolder })
      }
    }
  }
  return out.slice(0, 500)
})

const grouped = computed(() => {
  const map = new Map<string, Hit[]>()
  for (const h of results.value) {
    const key = h.folderNames.join(' › ') || 'Top level'
    const arr = map.get(key) ?? []
    arr.push(h)
    map.set(key, arr)
  }
  return [...map.entries()]
})

function hl(name: string, q: string): string {
  if (!q) return escapeHtml(name)
  const i = name.toLowerCase().indexOf(q)
  if (i < 0) return escapeHtml(name)
  return escapeHtml(name.slice(0, i)) + '<mark>' + escapeHtml(name.slice(i, i + q.length)) + '</mark>' + escapeHtml(name.slice(i + q.length))
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function reveal(h: Hit): void {
  docs.revealPath(props.docId, h.node.id)
}
function openExternal(n: BmNode): void {
  if (n.url) window.open(n.url, '_blank', 'noopener')
}
function copyUrl(n: BmNode): void {
  navigator.clipboard?.writeText(n.url || '').then(() => ui.notify('info', 'URL copied'))
}
function copyPath(n: BmNode): void {
  const path = namePath(doc.value!.root, n.id).join(' / ')
  navigator.clipboard?.writeText(path).then(() => ui.notify('info', 'Path copied'))
}
</script>

<template>
  <div v-if="doc" class="search-view" :data-ver="docs.treeVersion">
    <div class="search-bar">
      <div class="sb-query">
        <component :is="icon('Search')" :size="16" />
        <span class="sq-text truncate" :title="q">{{ q }}</span>
      </div>
      <span class="sb-count">{{ results.length }} result{{ results.length === 1 ? '' : 's' }}</span>
      <button class="btn sm" @click="docs.setView(doc.id, 'manager')">Manager</button>
    </div>

    <div v-if="q" class="search-results">
      <div v-if="!grouped.length" class="empty-list">
        <component :is="icon('Frown')" :size="40" />
        <p>No bookmarks match “{{ q }}”</p>
      </div>
      <section v-for="[dir, items] in grouped" :key="dir" class="search-group">
        <div class="sg-head">
          <component :is="icon('Folder')" :size="13" />
          {{ dir }}
          <span class="sg-n">{{ items.length }}</span>
        </div>
        <div v-for="h in items" :key="h.node.id" class="search-row" @dblclick="reveal(h)">
          <span v-if="h.node.type === 'folder'" class="sr-folder">
            <component :is="icon('Folder')" :size="16" />
          </span>
          <Favicon v-else :url="h.node.url" :name="h.node.name" :size="16" />
          <span class="sr-name" v-html="hl(h.node.name, (q || '').trim().toLowerCase())" />
          <span v-if="h.node.type === 'link'" class="sr-url">{{ hostOf(h.node.url || '') }}</span>
          <span v-else class="sr-url folder-path">{{ h.folderNames.join(' › ') }}</span>
          <span class="sr-actions">
            <template v-if="h.node.type === 'link'">
              <button class="icon-btn" title="Open" @click.stop="openExternal(h.node)"><component :is="icon('ExternalLink')" :size="13" /></button>
              <button class="icon-btn" title="Copy" @click.stop="copyUrl(h.node)"><component :is="icon('Copy')" :size="13" /></button>
            </template>
            <button class="icon-btn" title="Copy path" @click.stop="copyPath(h.node)"><component :is="icon('Clipboard')" :size="13" /></button>
            <button class="icon-btn" title="Show in tree" @click.stop="reveal(h)"><component :is="icon('ListTree')" :size="13" /></button>
          </span>
        </div>
      </section>
    </div>
    <div v-else-if="!q" class="empty-list">
      <component :is="icon('Search')" :size="40" />
      <p>Search names, URLs and folders — press <b>⌘F</b> and type in the omnibox above.</p>
    </div>
  </div>
</template>

<style scoped>
.search-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex: none;
}
.sb-query {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-3);
}
.sq-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.sb-count {
  color: var(--text-3);
  font-size: 12px;
  flex: none;
}
.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 60px;
}
.search-group {
  margin-bottom: 10px;
}
.sg-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 2;
  border-radius: 6px;
}
.sg-n {
  color: var(--text-3);
  background: var(--surface3);
  border-radius: 999px;
  padding: 0 7px;
  font-size: 10.5px;
  height: 15px;
  line-height: 15px;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: default;
}
.search-row:hover {
  background: var(--surface-hover);
}
.sr-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}
.sr-folder {
  color: var(--accent);
  display: inline-flex;
  flex: none;
}
.sr-url {
  color: var(--text-3);
  font-size: 11.5px;
  flex: none;
  width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  direction: rtl;
}
.sr-url.folder-path {
  direction: ltr;
  text-align: left;
  color: var(--accent-soft);
  font-weight: 600;
}
.sr-actions {
  display: none;
  gap: 1px;
  flex: none;
}
.search-row:hover .sr-actions {
  display: inline-flex;
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
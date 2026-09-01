<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useDocs } from '../../state/docs'
import { useDnd } from '../../state/dnd'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'
import { indexTree } from '../../lib/tree'
import { prepareDrag } from '../../lib/drag'
import type { BmNode } from '../../types'
import Favicon from '../shared/Favicon.vue'
import BarFlyout from './BarFlyout.vue'

const docs = useDocs()
const dnd = useDnd()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const doc = computed(() => docs.activeDoc)
const toolbarFolder = computed<BmNode | null>(() => {
  docs.treeVersion
  const d = doc.value
  if (!d) return null
  const direct = d.root.children.find(
    (c) => c.type === 'folder' && (c.attrs?.PERSONAL_TOOLBAR_FOLDER === 'true' || c.name.toLowerCase().includes('bookmarks bar'))
  )
  return direct ?? d.root.children.find((c) => c.type === 'folder') ?? null
})
const otherFolders = computed<BmNode[]>(() => {
  docs.treeVersion
  const d = doc.value
  const tf = toolbarFolder.value
  if (!d || !tf) return []
  return d.root.children.filter((c) => c.type === 'folder' && c.id !== tf.id)
})

const openMenu = ref<string>('') // node id whose flyout is open
const menuPos = ref<{ x: number; y: number; right?: boolean } | null>(null)
const menuRoot = ref<BmNode[]>([])
const menuTitle = ref('')

/** keep a flyout on-screen: it may be up to ~300px wide */
function fitMenuX(x: number): number {
  return Math.max(8, Math.min(x, window.innerWidth - 308))
}

function openFlyout(node: BmNode, e: MouseEvent): void {
  if (dnd.session) return
  openMenu.value = node.id
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menuRoot.value = node.children
  menuPos.value = { x: fitMenuX(rect.left), y: rect.bottom + 4 }
  void menuTitle
}

function openMore(e: MouseEvent): void {
  if (dnd.session) return
  if (openMenu.value === '__more__') {
    openMenu.value = ''
    return
  }
  openMenu.value = '__more__'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // Chrome-style: "All bookmarks" lists everything that isn't in the toolbar
  menuRoot.value = [...otherFolders.value]
  menuTitle.value = 'All bookmarks'
  menuPos.value = { x: fitMenuX(window.innerWidth - 300), y: rect.bottom + 4, right: true }
}

function closeMenu(): void {
  openMenu.value = ''
}

function openLink(node: BmNode): void {
  const d = doc.value
  if (!d || node.type !== 'link') return
  closeMenu()
  docs.revealPath(d.id, node.id)
  ui.notify('info', `Revealed “${node.name}” in the manager`)
}

function goFolder(node: BmNode): void {
  const d = doc.value
  if (!d) return
  docs.setCurrentFolder(d.id, node.id)
  closeMenu()
}

// draggable from the bar (pointer-based drag)
function onBarDragStart(e: MouseEvent, node: BmNode): void {
  const d = doc.value
  if (!d) return
  const t = e.target as HTMLElement
  if (t.closest('.bar-caret')) return
  const p = canFindParent(d.root, node.id)
  prepareDrag(
    e,
    {
      docId: d.id,
      nodeIds: [node.id],
      sourceParentId: p ?? d.root.id,
      label: node.name,
      isFolder: node.type === 'folder',
      url: node.url,
    },
    (toFolderId, anchorId) => {
      docs.mutMove(d.id, p ?? d.root.id, [node.id], toFolderId, anchorId)
    }
  )
}

function canFindParent(root: BmNode, id: string): string | null {
  const idx = indexTree(root)
  return idx.parentOf.get(id)?.id ?? null
}

const tfName = computed(() => toolbarFolder.value?.name ?? 'Bookmarks bar')

// ---- whole-bar close grace: move off the bar + flyouts and only close after a
// short window during which returning cancels the collapse.
let barCloseT: ReturnType<typeof setTimeout> | undefined
function barLeave(): void {
  clearTimeout(barCloseT)
  barCloseT = setTimeout(() => {
    barCloseT = undefined
    if (!dnd.session) closeMenu()
  }, 350)
}
function barEnter(): void {
  clearTimeout(barCloseT)
}
onBeforeUnmount(() => clearTimeout(barCloseT))
</script>

<template>
  <div v-if="doc" class="bookmarks-bar" :data-ver="docs.treeVersion" @mouseleave="barLeave" @mouseover="barEnter">
    <span class="bms-label">{{ tfName }}</span>

    <template v-for="node in toolbarFolder?.children ?? []" :key="node.id">
      <div
        v-if="node.type === 'link'"
        class="bar-item"
        :class="{ dragging: dnd.session?.nodeIds.includes(node.id) }"
        @click="openLink(node)"
        @mousedown="onBarDragStart($event, node)"
      >
        <Favicon :url="node.url" :name="node.name" :size="15" />
        <span class="truncate">{{ node.name }}</span>
      </div>
      <div
        v-else-if="node.type === 'folder'"
        class="bar-item"
        :class="{ dragging: dnd.session?.nodeIds.includes(node.id) }"
        :data-open="openMenu === node.id ? 'true' : 'false'"
        @click="(e) => openFlyout(node, e)"
        @mouseenter="(e) => openMenu && openFlyout(node, e)"
        @mousedown="onBarDragStart($event, node)"
      >
        <Favicon :name="node.name" :size="15" :url="undefined" />
        <span class="truncate">{{ node.name }}</span>
        <span class="bar-caret"><component :is="icon('ChevronDown')" :size="12" /></span>
      </div>
    </template>

    <div class="flex-1"></div>

    <div
      class="bar-item bar-overflow"
      :data-open="openMenu === '__more__' ? 'true' : 'false'"
      @click="openMore"
      @mouseenter="openMenu && openMore"
    >
      <span class="truncate">All bookmarks</span>
      <span class="bar-caret"><component :is="icon('ChevronDown')" :size="12" /></span>
    </div>

    <BarFlyout
      v-if="openMenu && menuPos"
      :nodes="menuRoot"
      :anchor="menuPos"
      :title="openMenu === '__more__' ? menuTitle : undefined"
      :close="closeMenu"
      :is-open="openMenu"
      @open-link="openLink"
      @open-folder="goFolder"
    />
  </div>
</template>

<style scoped>
.bookmarks-bar {
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 8px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  gap: 2px;
  overflow: hidden;
  position: relative;
  /* creates a stacking context; must be above the sidebar splitter (z 8) so
     flyouts painted here never lose hit-tests to the splitter */
  z-index: 30;
  cursor: default;
}
.bms-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-3);
  margin: 0 8px 0 2px;
  flex: none;
}
.bar-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border-radius: var(--radius-full);
  color: var(--text-2);
  font-size: 12.5px;
  user-select: none;
  white-space: nowrap;
  position: relative;
  transition: background var(--speed) var(--ease), color var(--speed) var(--ease);
  cursor: pointer;
}
.bar-item:hover,
.bar-item[data-open='true'] {
  background: var(--surface-hover);
  color: var(--text);
}
.bar-item[data-open='true'] {
  box-shadow: inset 0 0 0 1px var(--accent-soft);
}
.bar-item.dragging {
  opacity: 0.45;
}
.bar-caret {
  display: inline-flex;
  color: var(--text-3);
  margin-left: -2px;
}
.bar-caret :deep(svg) {
  transition: transform 120ms var(--ease);
}
.bar-item[data-open='true'] .bar-caret :deep(svg) {
  transform: rotate(180deg);
}
.flex-1 {
  flex: 1;
}
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
</style>
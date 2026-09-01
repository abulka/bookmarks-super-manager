<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useIcon } from '../../lib/icons'
import type { BmNode } from '../../types'
import Favicon from '../shared/Favicon.vue'

const props = defineProps<{
  nodes: BmNode[]
  anchor?: { x: number; y: number } | null
  title?: string
  close: () => void
  /** when set, leaving this branch only collapses this level (not the whole menu) */
  onCloseLevel?: () => void
  isOpen: string
  /** submenu cascade direction + the parent item's width (for rightward offset) */
  subDir?: 'right' | 'left'
  subWidth?: number
}>()
const emit = defineEmits<{
  'open-link': [node: BmNode]
  'open-folder': [node: BmNode]
}>()

const icon = (name: string) => useIcon(name)

interface SubPos {
  node: BmNode
  dir: 'right' | 'left'
  x: number // parent item's left edge (flyout outer sits here)
  y: number
  w: number // parent item's width
}

const sub = ref<SubPos | null>(null)
watch(() => props.isOpen, () => {
  sub.value = null
  cancelClose()
})

const OVERLAP = 8
const MENU_LEN = 300 // max menu width, used to decide whether there's room on the right

function urlHost(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function hover(n: BmNode, ev: MouseEvent): void {
  // hovering a plain link must NOT collapse an already-open sibling submenu —
  // you can drift off a folder item without instantly losing its flyout
  if (n.type !== 'folder') {
    poke()
    return
  }
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const vw = window.innerWidth
  // open below-right when there's room, otherwise flip below-left (menus anchored
  // at the right edge like "All bookmarks" cascade leftward instead of overflowing)
  const dir: 'right' | 'left' = r.right + OVERLAP + MENU_LEN <= vw ? 'right' : 'left'
  // aligned to the item's top — vertical viewport fitting is handled after mount
  // in fixY() so the flyout always stays adjacent to the activating item
  sub.value = { node: n, dir, x: r.left, y: r.top - 6, w: r.width }
  cancelClose()
}

// ---- vertical fitting ---------------------------------------------------
// Opens aligned with the activating item, then — if the flyout would run past
// the bottom of the viewport — shifts straight up by exactly the overflow so
// its bottom stays on screen. It keeps overlapping the item, so moving the
// mouse from the item into the flyout is always a continuous path, even for
// folders in a long scrolled parent menu.
const menuEl = ref<HTMLElement | null>(null)
const yFix = ref(0)

function fixY(): void {
  const base = props.anchor?.y ?? 0
  const h = menuEl.value?.getBoundingClientRect().height
  const vh = window.innerHeight
  let y = base
  y = Math.max(4, y)
  if (h) {
    if (y + h > vh - 4) y = Math.max(4, vh - 4 - h)
  } else if (y + 320 > vh - 4) {
    y = Math.max(4, vh - 4 - 320)
  }
  yFix.value = y - base
}
onMounted(() => requestAnimationFrame(fixY))
watch(
  () => props.anchor?.y,
  () => requestAnimationFrame(fixY)
)
watch(
  () => props.nodes.length,
  () => requestAnimationFrame(fixY)
)

/**
 * Horizontal placement of the flyout relative to its anchor.
 * - right:  flyout starts at the item's right edge minus a small overlap
 * - left:   flyout is pushed fully left via translateX(-100%) (relative to its own
 *           width), so its RIGHT edge always lands on the item's LEFT edge plus the
 *           overlap — regardless of how wide the flyout turns out to be. This is what
 *           guarantees there is never a dead gap on leftward cascades.
 */
function menuTransform(): string {
  if (props.subDir === 'left') return `translateX(calc(-100% + ${OVERLAP}px))`
  if (props.subDir === 'right') return `translateX(${Math.max(0, (props.subWidth ?? 0) - OVERLAP)}px)`
  return ''
}

// ---- grace-timer (shared across every nested level) ----
// Any pointer activity over ANY open flyout refreshes `lastActivity`, so a
// pending close keeps being postponed while the user is navigating between
// menu levels (even across tiny gaps like the sidebar splitter). Menus only
// collapse ~400ms after the pointer has truly stopped interacting with them.
const GRACE = 500
let lastActivity = Date.now()
function poke(): void {
  lastActivity = Date.now()
}
/** any pointer movement inside this branch: refresh activity and cancel this
 *  branch's pending close */
function onOver(): void {
  poke()
  cancelClose()
}

let closeTimer: ReturnType<typeof setTimeout> | undefined

function scheduleClose(): void {
  clearTimeout(closeTimer)
  const tick = () => {
    // still tooling around the menus? postpone again
    if (Date.now() - lastActivity < GRACE) {
      closeTimer = setTimeout(tick, 120)
      return
    }
    closeTimer = undefined
    if (props.onCloseLevel) props.onCloseLevel()
    else props.close()
  }
  closeTimer = setTimeout(tick, GRACE)
}
function cancelClose(): void {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = undefined
  }
}
onBeforeUnmount(cancelClose)

/** pointer left the whole outer container → close this level (with grace) */
function onOuterLeave(ev: MouseEvent): void {
  const rt = ev.relatedTarget as Element | null
  if (rt && rt.closest && rt.closest('.bar-menu-outer')) return
  scheduleClose()
}

/** pointer left the item list (but may be over the open submenu) → close the submenu */
function onListLeave(ev: MouseEvent): void {
  const rt = ev.relatedTarget as Element | null
  if (rt && rt.closest && rt.closest('.bar-menu-outer')) return
  sub.value = null
}

function click(n: BmNode): void {
  cancelClose()
  poke()
  props.close()
  if (n.type === 'folder') emit('open-folder', n)
  else emit('open-link', n)
}
</script>

<template>
  <div
    class="bar-menu-outer"
    :style="{ left: (anchor?.x ?? 0) + 'px', top: ((anchor?.y ?? 0) + yFix) + 'px' }"
    @mouseleave="onOuterLeave"
    @mouseover="onOver"
  >
    <div ref="menuEl" class="bar-menu" :class="{ 'bms-flat': !!subDir }" :style="subDir ? { transform: menuTransform() } : undefined" @mouseleave="onListLeave">
      <div v-if="title" class="bmu-title">{{ title }}</div>
      <div
        v-for="n in nodes"
        :key="n.id"
        class="bmi"
        :data-open="sub?.node.id === n.id ? 'true' : 'false'"
        @mouseenter="hover(n, $event)"
        @click="click(n)"
      >
        <Favicon :url="n.type === 'link' ? n.url : undefined" :name="n.name" :size="15" />
        <span class="bmi-name">{{ n.name }}</span>
        <span v-if="n.type === 'folder'" class="bmi-folder"><component :is="icon('ChevronRight')" :size="13" /></span>
        <span v-else class="bmi-host">{{ urlHost(n.url) }}</span>
      </div>
      <div v-if="!nodes.length" class="bmu-empty">Empty folder</div>
    </div>

    <BarFlyout
      v-if="sub"
      :nodes="sub.node.children"
      :anchor="{ x: sub.x, y: sub.y }"
      :sub-dir="sub.dir"
      :sub-width="sub.w"
      :close="props.close"
      :on-close-level="() => (sub = null)"
      :is-open="sub.node.id"
      @open-link="(x) => emit('open-link', x)"
      @open-folder="(x) => emit('open-folder', x)"
    />
  </div>
</template>

<style scoped>
.bar-menu-outer {
  position: fixed;
  z-index: 120;
}
.bar-menu {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-lg);
  min-width: 230px;
  max-width: 300px;
  max-height: 64vh;
  overflow-y: auto;
  overflow-x: clip;
  padding: 5px;
  animation: pop-in 110ms var(--ease);
}
/* submenus carry a horizontal transform for overlap alignment, so they must
   not use the transform-based pop-in animation (opacity fade only) */
.bar-menu.bms-flat {
  animation: fade-in 90ms var(--ease);
}
.bmu-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-3);
  padding: 6px 10px 2px;
  font-weight: 700;
}
.bmu-empty {
  padding: 16px;
  color: var(--text-3);
  text-align: center;
  font-size: 12px;
}
.bmi {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 9px;
  border-radius: var(--radius-s);
  cursor: pointer;
  color: var(--text);
  position: relative;
  font-size: 12.5px;
  user-select: none;
}
.bmi:hover,
.bmi[data-open='true'] {
  background: var(--accent-soft);
}
.bmi-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.bmi-folder {
  color: var(--text-3);
  display: inline-flex;
  flex: none;
}
.bmi-host {
  color: var(--text-3);
  font-size: 10.5px;
  flex: none;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
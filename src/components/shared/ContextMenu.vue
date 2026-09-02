<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, watch } from 'vue'

export interface MenuItem {
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  shortcut?: string
  action: () => void
}
export interface MenuSpec {
  x: number
  y: number
  title?: string
  items: (MenuItem | 'sep')[]
}

const pos = reactive<MenuSpec>({ x: 0, y: 0, items: [] })
const open = reactive({ value: false })

function show(spec: MenuSpec): void {
  pos.x = spec.x
  pos.y = spec.y
  pos.title = spec.title
  pos.items = spec.items
  open.value = true
}
function hide(): void {
  open.value = false
}

const onDocumentClick = () => hide()
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    hide()
    return
  }
  const item = pos.items.find((it) => it !== 'sep' && it.shortcut && shortcutMatches(it.shortcut, e))
  if (item && item !== 'sep') {
    e.preventDefault()
    e.stopPropagation()
    item.action()
    hide()
  }
}

/** match a shortcut string (e.g. "⌥C", "⌘C", "c", "F2") against a keydown event */
function shortcutMatches(shortcut: string, e: KeyboardEvent): boolean {
  const modRe = /[⌥⌘⌃⇧]/g
  const hasMods = /[⌥⌘⌃⇧]/.test(shortcut)
  const plain = shortcut.replace(modRe, '').trim().toLowerCase()
  // legacy bare-letter shortcuts only fire with no modifiers pressed
  if (!hasMods) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
    if (e.key.length !== 1) return false
    return e.key.toLowerCase() === plain
  }
  if (/[⌥]/.test(shortcut) && !e.altKey) return false
  if (/[⌘]/.test(shortcut) && !e.metaKey) return false
  if (/[⌃]/.test(shortcut) && !e.ctrlKey) return false
  if (/[⇧]/.test(shortcut) && !e.shiftKey) return false
  // compare against the physical key: on macOS ⌥C reports a special character as `key`
  const phys = (e.code || e.key).replace(/^(Key|Digit|Numpad)/, '').toLowerCase()
  return phys === plain
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKey)
  window.addEventListener('blur', hide)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', hide)
})

watch(open, (v) => {
  if (v.value) {
    const w = 240
    const h = pos.items.length * 36 + 40
    const vw = window.innerWidth
    const vh = window.innerHeight
    pos.x = Math.min(pos.x, vw - w - 8)
    pos.y = Math.min(pos.y, vh - h - 8)
    pos.x = Math.max(4, pos.x)
    pos.y = Math.max(4, pos.y)
  }
})

defineExpose({ show, hide })

import { useIcon } from '../../lib/icons'
const icon = (name: string) => useIcon(name)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open.value" class="context-menu" :style="{ left: pos.x + 'px', top: pos.y + 'px' }" @click.stop>
        <div v-if="pos.title" class="cm-title">{{ pos.title }}</div>
        <template v-for="(item, i) in pos.items" :key="i">
          <div v-if="item === 'sep'" class="cm-sep" />
          <button v-else class="cm-item" :class="{ danger: item.danger }" :disabled="item.disabled" @click.stop="item.action(); hide()">
            <component :is="icon(item.icon || 'Dot')" v-if="item.icon" :size="15" />
            <span class="cm-label">{{ item.label }}</span>
            <kbd v-if="item.shortcut" class="kbd">{{ item.shortcut }}</kbd>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 250;
  min-width: 210px;
  max-width: 320px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-lg);
  padding: 5px;
  animation: pop-in 100ms var(--ease);
}
.cm-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-3);
  padding: 6px 10px 2px;
  font-weight: 700;
}
.cm-item {
  display: flex;
  align-items: center;
  gap: 9px;
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
.cm-item:hover {
  background: var(--accent-soft);
}
.cm-item.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.cm-item:disabled {
  opacity: 0.4;
  pointer-events: none;
}
.cm-label {
  flex: 1;
}
.cm-sep {
  height: 1px;
  background: var(--border);
  margin: 5px 4px;
}
</style>
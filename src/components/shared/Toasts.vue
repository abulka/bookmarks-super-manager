<script setup lang="ts">
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'

const ui = useUi()
const icon = (name: string) => useIcon(name)
</script>

<template>
  <Teleport to="body">
    <div class="toasts">
      <TransitionGroup name="toast">
        <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.kind">
          <component :is="icon(t.kind === 'success' ? 'Check' : t.kind === 'error' ? 'AlertTriangle' : 'Info')" :size="16" />
          <span>{{ t.text }}</span>
          <button v-if="t.action" class="t-action" @click="t.action!.onClick(); ui.dismiss(t.id)">{{ t.action.label }}</button>
          <button class="t-close" @click="ui.dismiss(t.id)">
            <component :is="icon('X')" :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  bottom: 42px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 300;
  align-items: center;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(540px, 90vw);
  padding: 10px 16px;
  border-radius: var(--radius-m);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  animation: slide-up 160ms var(--ease);
}
.toast.success {
  border-color: var(--ok);
}
.toast.error {
  border-color: var(--danger);
}
.t-action {
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: none;
  padding: 0;
  font-size: 13px;
}
.t-close {
  margin-left: 4px;
  color: var(--text-3);
  cursor: pointer;
  border: none;
  background: none;
  display: inline-flex;
  padding: 0;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 180ms var(--ease);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
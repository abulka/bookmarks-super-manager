<script setup lang="ts">
import { useIcon } from '../../../lib/icons'

interface Payload {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm?: () => void
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const icon = (name: string) => useIcon(name)

function confirm(): void {
  props.payload.onConfirm?.()
  emit('close')
}
</script>

<template>
  <div class="modal">
    <div class="head">
      <component :is="icon(payload.danger ? 'AlertTriangle' : 'Info')" :size="18" :class="{ danger: payload.danger }" />
      <span>{{ payload.title }}</span>
    </div>
    <p v-if="payload.message" class="msg">{{ payload.message }}</p>
    <div class="foot">
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn" :class="{ danger: payload.danger, primary: !payload.danger }" @click="confirm">
        {{ payload.confirmLabel ?? 'OK' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.modal {
  padding: 20px 22px 18px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
}
.head svg.danger {
  color: var(--danger);
}
.msg {
  color: var(--text-2);
  line-height: 1.6;
  margin: 10px 2px 18px;
  font-size: 13px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
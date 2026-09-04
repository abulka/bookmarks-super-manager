<script setup lang="ts">
import { ref } from 'vue'
import { useIcon } from '../../../lib/icons'

interface Payload {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  /** optional "don't ask again"-style checkbox shown above the actions */
  checkbox?: { label: string }
  /** receives the checkbox state (true = checked) when the confirm button is pressed */
  onConfirm?: (checked?: boolean) => void
}
const props = defineProps<{ payload: Payload }>()
const emit = defineEmits<{ close: [] }>()
const icon = (name: string) => useIcon(name)
const checked = ref(false)

function confirm(): void {
  props.payload.onConfirm?.(checked.value)
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
    <label v-if="payload.checkbox" class="chk">
      <input v-model="checked" type="checkbox" />
      <span>{{ payload.checkbox.label }}</span>
    </label>
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
.chk {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -8px 2px 16px;
  font-size: 12.5px;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
}
.chk input {
  accent-color: var(--accent);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
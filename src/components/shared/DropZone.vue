<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useUi } from '../../state/ui'

const ui = useUi()

const dragging = ref(false)
const onBody = (e: DragEvent) => {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  dragging.value = true
}
function onDrop(e: DragEvent): void {
  e.preventDefault()
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return
  // hand off to docs store
  import('../../state/docs').then((m) => {
    const docs = m.useDocs()
    docs.openFiles(files).then((n: number) => {
      ui.notify('success', `Imported ${n} file${n === 1 ? '' : 's'}`)
    })
  })
}

onMounted(() => {
  window.addEventListener('dragover', onBody)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragover', onBody)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="dragging" class="drop-overlay">
      <div class="drop-card">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke-linecap="round" />
        </svg>
        <h2>Drop bookmark files to open</h2>
        <p>Netscape HTML (.html) or Firefox JSON (.json)</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fade-in 140ms var(--ease);
}
.drop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 54px 64px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-l);
  background: var(--surface);
  color: var(--text-2);
  box-shadow: var(--shadow-lg);
  text-align: center;
}
.drop-card h2 {
  margin: 0;
  color: var(--text);
}
.drop-card p {
  margin: 0;
  font-size: 13px;
}
</style>
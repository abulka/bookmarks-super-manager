<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useUi } from '../../state/ui'
import EditNode from './dialogs/EditNode.vue'
import ConfirmBox from './dialogs/ConfirmBox.vue'
import NewFolder from './dialogs/NewFolder.vue'
import NewBookmark from './dialogs/NewBookmark.vue'
import EditDoc from './dialogs/EditDoc.vue'
import ImportTarget from './dialogs/ImportTarget.vue'
import ExportDialog from './dialogs/ExportDialog.vue'
import StatsSheet from './dialogs/StatsSheet.vue'
import AboutDialog from './dialogs/AboutDialog.vue'
import SettingsDialog from './dialogs/SettingsDialog.vue'

const ui = useUi()
const empty = {} as never
function close(): void {
  ui.closeModal()
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.modal" class="modal-mask" @mousedown.self="close">
      <div class="modal" :class="ui.modal.kind" role="dialog">
        <template v-if="ui.modal.kind === 'editNode'">
          <EditNode :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'confirm'">
          <ConfirmBox :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'newFolder'">
          <NewFolder :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'newBookmark'">
          <NewBookmark :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'editDoc'">
          <EditDoc :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'importTarget'">
          <ImportTarget :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'export'">
          <ExportDialog :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'stats'">
          <StatsSheet :payload="((ui.modal.payload ?? empty) as any)" @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'about'">
          <AboutDialog @close="close" />
        </template>
        <template v-else-if="ui.modal.kind === 'settings'">
          <SettingsDialog @close="close" />
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fade-in 120ms var(--ease);
}
.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-lg);
  width: min(460px, calc(100vw - 40px));
  animation: pop-in 150ms var(--ease);
  overflow: hidden;
}
/* the stats sheet needs more room than the default 460px modal */
.modal.stats {
  width: min(600px, calc(100vw - 40px));
}
/* the about/help sheet hosts wider documentation */
.modal.about {
  width: min(720px, calc(100vw - 40px));
  max-height: min(80vh, 720px);
}
/* the settings sheet needs a touch more room than the default */
.modal.settings {
  width: min(480px, calc(100vw - 40px));
}
</style>
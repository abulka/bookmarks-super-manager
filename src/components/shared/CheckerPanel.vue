<script setup lang="ts">
import { computed } from 'vue'
import { useChecker } from '../../state/checker'
import { useDocs } from '../../state/docs'
import { useUi } from '../../state/ui'
import { useIcon } from '../../lib/icons'

const checker = useChecker()
const docs = useDocs()
const ui = useUi()
const icon = (name: string) => useIcon(name)

const pct = computed(() => Math.round(checker.progress * 100))

// Show an Apply button whenever there is something to apply: dead marks to add,
// rewrites, or stale ❌ to restore. A pure restore (all links alive again) has
// no deadIds/rewriteIds, so it must be gated on `restored` too — otherwise the
// only path that revives a previously-dead link is hidden.
const applyLabel = computed(() => {
  if (checker.collect) {
    return checker.deadIds.length ? 'Collect ❌ into folder' : 'Apply'
  }
  if (!checker.restored && !checker.rewriteIds.length) {
    return `Mark ${checker.deadIds.length} dead ❌`
  }
  const parts: string[] = []
  if (checker.deadIds.length) parts.push(`${checker.deadIds.length} dead ❌`)
  if (checker.restored) parts.push(`${checker.restored} restored`)
  if (checker.rewriteIds.length) parts.push(`${checker.rewriteIds.length} rewritten`)
  return `Apply: ${parts.join(', ')}`
})

function apply(): void {
  const checked = checker.checkedIds ?? []
  if (!checked.length) {
    checker.reset()
    return
  }
  const deadIds = [...new Set(checker.deadIds)]
  const rewriteIds = [...new Set(checker.rewriteIds)]
  if (rewriteIds.length) {
    const n = docs.rewriteLinks(checker.docId!, rewriteIds)
    ui.notify('info', `Rewrote ${n} link${n === 1 ? '' : 's'} to current URLs`)
  }
  if (checker.collect && deadIds.length) {
    docs.collectDead(checker.docId!, deadIds)
    docs.setView(checker.docId!, 'dead')
    ui.notify('success', `Checked ${checked.length} links · ${deadIds.length} dead${deadIds.length ? ' collected into a folder' : ''}`)
  } else {
    docs.reconcileDead(checker.docId!, deadIds, checked)
    const alive = checked.length - deadIds.length - rewriteIds.length
    ui.notify(
      'success',
      `Checked ${checked.length} links · ${deadIds.length} dead ❌ · ${alive} alive` +
        (checker.restored ? ` · ${checker.restored} stale ❌ restored` : '') +
        (rewriteIds.length ? ` · ${rewriteIds.length} rewritten` : ''),
    )
  }
  checker.reset()
}
</script>

<template>
  <div v-if="checker.phase !== 'idle'" class="checker-panel">
    <component :is="icon(checker.phase === 'running' ? 'Loader2' : 'Skull')" :size="16" :class="{ spin: checker.phase === 'running' }" />
    <div class="ck-text">
      <b v-if="checker.phase === 'running'">Checking {{ checker.label }}…</b>
      <b v-else>Check complete</b>
      <span class="ck-sub">
        {{ checker.done }}/{{ checker.total }} · {{ checker.alive }} ok · {{ checker.skipped }} skipped
        <template v-if="checker.dead"> · <span class="bad">{{ checker.dead }} dead</span></template>
        <template v-if="checker.restored"> · <span class="ok">{{ checker.restored }} will be restored</span></template>
        <template v-if="checker.rewritten"> · <span class="ok">{{ checker.rewritten }} will be rewritten</span></template>
      </span>
    </div>
    <div class="checker-progress">
      <div class="cp-fill" :style="{ width: pct + '%' }" />
    </div>
    <button v-if="checker.phase === 'running'" class="btn sm" @click="checker.cancel()">Cancel</button>
    <template v-else>
      <button v-if="checker.deadIds.length || checker.rewriteIds.length || checker.restored" class="btn sm" :class="{ danger: checker.collect }" @click="apply">
        {{ applyLabel }}
      </button>
      <button class="btn sm ghost" @click="checker.reset()">Dismiss</button>
    </template>
  </div>
</template>

<style scoped>
.checker-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex: none;
}
.ck-text {
  min-width: 0;
}
.ck-text b {
  display: block;
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
}
.ck-sub {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.bad {
  color: var(--danger);
  font-weight: 600;
}
.ok {
  color: var(--ok);
  font-weight: 600;
}
.checker-progress {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--surface3);
  overflow: hidden;
  min-width: 120px;
}
.cp-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--ok));
  border-radius: 3px;
  transition: width 200ms var(--ease);
}
</style>
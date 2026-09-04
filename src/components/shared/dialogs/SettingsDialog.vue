<script setup lang="ts">
import { computed } from 'vue'
import { usePrefs } from '../../../state/prefs'
import { useIcon } from '../../../lib/icons'

defineEmits<{ close: [] }>()
const prefs = usePrefs()
const icon = (name: string) => useIcon(name)

const askBeforeApply = computed(() => !prefs.skipApplyConfirm)
function toggleAskBeforeApply(): void {
  // the switch reflects "ask before applying"; flipping it inverts the skip flag
  prefs.setSkipApplyConfirm(askBeforeApply.value)
}
</script>

<template>
  <div class="settings">
    <header class="st-head">
      <component :is="icon('Settings2')" :size="18" />
      <span class="st-title">Settings</span>
      <button class="icon-btn" title="Close (Esc)" @click="$emit('close')">
        <component :is="icon('X')" :size="16" />
      </button>
    </header>

    <div class="st-body">
      <section>
        <h2>Appearance</h2>
        <div class="pref-row">
          <div class="pref-text">
            <span class="pref-name">Theme</span>
            <span class="pref-desc">Dark or light colour scheme.</span>
          </div>
          <div class="segmented">
            <button class="seg-item" :class="{ active: prefs.theme === 'dark' }" @click="prefs.setTheme('dark')">Dark</button>
            <button class="seg-item" :class="{ active: prefs.theme === 'light' }" @click="prefs.setTheme('light')">Light</button>
          </div>
        </div>
      </section>

      <section>
        <h2>Interface</h2>
        <div class="pref-row">
          <label class="pref-text" for="pref-bar">
            <span class="pref-name">Preview the bookmarks bar</span>
            <span class="pref-desc">Show the compact Chrome-style bar with quick links at the top.</span>
          </label>
          <button
            id="pref-bar"
            class="switch"
            :class="{ on: prefs.showBookmarksBar }"
            role="switch"
            :aria-checked="prefs.showBookmarksBar"
            @click="prefs.setShowBookmarksBar(!prefs.showBookmarksBar)"
          >
            <span class="knob" />
          </button>
        </div>
      </section>

      <section>
        <h2>Safety</h2>
        <div class="pref-row">
          <label class="pref-text" for="pref-confirm-delete">
            <span class="pref-name">Confirm before deleting bookmarks</span>
            <span class="pref-desc">Ask before removing items. Deletions can still be undone afterwards.</span>
          </label>
          <button
            id="pref-confirm-delete"
            class="switch"
            :class="{ on: prefs.confirmOnDelete }"
            role="switch"
            :aria-checked="prefs.confirmOnDelete"
            @click="prefs.setConfirmOnDelete(!prefs.confirmOnDelete)"
          >
            <span class="knob" />
          </button>
        </div>
        <div class="pref-row">
          <label class="pref-text" for="pref-apply">
            <span class="pref-name">Confirm before applying to Chrome</span>
            <span class="pref-desc">Warn before writing your edits into the real Chrome bookmarks. Turn this off to apply immediately.</span>
          </label>
          <button
            id="pref-apply"
            class="switch"
            :class="{ on: askBeforeApply }"
            role="switch"
            :aria-checked="askBeforeApply"
            @click="toggleAskBeforeApply"
          >
            <span class="knob" />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.st-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 15px;
  font-weight: 600;
}
.st-head > :first-child {
  color: var(--accent);
}
.st-title {
  flex: 1;
}
.st-body {
  padding: 6px 24px 18px 20px;
}
.st-body section {
  margin: 14px 0 0;
}
.st-body h2 {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-3);
  margin: 0 0 6px;
}
.pref-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 2px;
}
.pref-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}
.pref-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.pref-desc {
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.45;
}
.switch {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface3);
  cursor: pointer;
  padding: 0;
  transition: background 140ms var(--ease), border-color 140ms var(--ease);
}
.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-3);
  transition: transform 140ms var(--ease), background 140ms var(--ease);
}
.switch.on {
  background: var(--ok);
  border-color: var(--ok);
}
.switch.on .knob {
  transform: translateX(16px);
  background: #fff;
}
</style>
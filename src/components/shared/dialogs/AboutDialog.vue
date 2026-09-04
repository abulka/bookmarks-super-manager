<script setup lang="ts">
import { ref } from 'vue'
import { useIcon } from '../../../lib/icons'
import { checkForUpdateNow, updaterEnabled } from '../../../lib/updater'

defineEmits<{ close: [] }>()
const icon = (name: string) => useIcon(name)

const version = __APP_VERSION__
const canCheck = updaterEnabled()
const checking = ref(false)
const checkNote = ref('')

async function check() {
  checking.value = true
  checkNote.value = ''
  const status = await checkForUpdateNow()
  checkNote.value =
    status === 'up-to-date'
      ? 'You have the latest version.'
      : status === 'error'
        ? "Couldn't reach GitHub — check your connection and try again."
        : ''
  checking.value = false
}
</script>

<template>
  <div class="about">
    <header class="ab-head">
      <div class="ab-logo"><component :is="icon('Bookmark')" :size="20" /></div>
      <div class="ab-title">
        <h1>Bookmark Super Manager</h1>
        <span class="ab-ver">v{{ version }}</span>
      </div>
      <button class="icon-btn" title="Close (Esc)" @click="$emit('close')">
        <component :is="icon('X')" :size="16" />
      </button>
    </header>

    <div class="ab-body">
      <section>
        <h2><component :is="icon('Sparkles')" :size="14" /> What this is</h2>
        <p>
          A fast, <b>local-first</b> bookmark viewer and manager. Import a Netscape-format bookmarks export
          (Chrome / Safari / Edge / Firefox) or a Firefox JSON backup, and you get a Chrome-like bookmarks bar,
          a real drag &amp; drop folder tree, duplicates and dead-link checking — and all of it lives only in this
          browser's storage. <b>Nothing you import is uploaded anywhere.</b>
        </p>
      </section>

      <section>
        <h2><component :is="icon('Globe')" :size="14" /> Two ways to run it</h2>
        <p>This app comes in two modes, and they handle your bookmarks very differently:</p>
        <ul>
          <li>
            <b>Standalone web app</b> (this window, when you open the hosted site or <code>npm run dev</code>). You
            <b>import</b> a bookmarks export (<code>.html</code> / <code>.json</code>), organise, and <b>export</b> a
            fresh copy. Your bookmarks live in <i>files</i> you control — the app never touches Chrome's live bookmarks.
            Everything stays in this browser; nothing is uploaded.
          </li>
          <li>
            <b>Chrome extension</b> (MV3). Installed from <code>dist-extension/</code>, the app opens your <b>real,
            live</b> <code>chrome.bookmarks</code> in a manager tab. Edit it with everything the web app does, then push
            the changes back into Chrome with one <b>Apply to Chrome</b> button. The live tab is never persisted — it is
            re-read fresh from Chrome each time, and Apply refuses to run if Chrome changed elsewhere since the tab was
            loaded.
          </li>
        </ul>
        <p>
          So: use the <b>extension</b> to reorganise the bookmarks you actually use; use the <b>standalone app</b> to
          work on an exported <i>file</i> (a backup, a separate library, or a cleanup you want to keep as a file rather
          than push straight into Chrome).
        </p>
      </section>

      <section>
        <h2><component :is="icon('Layers')" :size="14" /> What this adds beyond Chrome's bookmark manager</h2>
        <p>
          To be fair, <b>Chrome's built-in bookmark manager is a decent treeview</b> and supports drag &amp; drop too —
          this app isn't trying to replace it for quick day-to-day tweaks. For bigger jobs, though, there are a few
          things the built-in manager still can't do:
        </p>
        <ul>
          <li>
            <b>Multi-select in the tree</b> — select several folders and links at once with ⌘/Ctrl- or ⇧-click and
            move or copy them together (Chrome's tree drags items one at a time).
          </li>
          <li>
            <b>Move &amp; copy shortcuts</b> — <kbd class="kbd">⌘C</kbd> / <kbd class="kbd">⌘X</kbd> / <kbd class="kbd">⌘V</kbd> cut, copy and paste
            bookmarks and whole folders.
          </li>
          <li>
            <b>Multiple bookmark files as tabs</b> — open several exports at once and move or copy items between them.
          </li>
          <li><b>Duplicate detection</b> — exact and "normalised" URL duplicates, with an interactive keep-newest review.</li>
          <li>
            <b>Dead-link checking</b> — find bookmarks whose sites are gone (DNS/connection failures or 404/410) and
            clean them up, per folder or library-wide.
          </li>
          <li><b>Copy path</b> — grab a folder's full tree path (e.g. <code>Bookmarks bar / Work / Docs</code>) in one click.</li>
          <li>
            <b>Search</b> — normal substring matching, plus "whole word" terms in quotes and space-separated terms
            that must all match.
          </li>
          <li>Rename, sort, undo, and a link checker that reads real HTTP statuses.</li>
        </ul>
      </section>

      <section>
        <h2><component :is="icon('RefreshCw')" :size="14" /> Recommended workflow — replace your Chrome library</h2>
        <ol>
          <li>
            <b>Export from Chrome:</b> <code>chrome://bookmarks</code> → ⋮ menu → <b>Export bookmarks</b>. Keep the
            <code>.html</code> somewhere safe — it's your backup.
          </li>
          <li>
            <b>Import here:</b> drop the file onto this window (or Open files). It opens as a tab.
          </li>
          <li>
            <b>Reorganise:</b> drag &amp; drop links and folders in the tree, cut/copy/paste, rename, sort. Run
            <b>Duplicates</b> and <b>Dead links</b> and clean things up.
          </li>
          <li>
            <b>Export:</b> when it's clean, <b>Export</b> and download the Chrome-compatible <code>.html</code>.
          </li>
          <li>
            <b>Pause Chrome sync:</b> Settings → You and Google → Sync and Google services → <b>turn Sync Off</b>.
            This keeps the next steps local to this machine — nothing propagates until you switch it back on.
          </li>
          <li>
            <b>Clear the old bookmarks:</b> <code>chrome://bookmarks</code> → ⋮ → delete the <b>Bookmarks bar</b> and
            <b>Other bookmarks</b> folders (or select all and delete). It's all still safe in the file from step 1.
          </li>
          <li>
            <b>Import into Chrome:</b> <code>chrome://bookmarks</code> → ⋮ → <b>Import bookmarks</b> → choose your new
            <code>.html</code>. Everything arrives under a folder called <b>Imported</b>.
          </li>
          <li>
            <b>Arrange:</b> drag the bookmarks out of <b>Imported</b> into <b>Bookmarks bar</b> / <b>Other bookmarks</b>
            as you want them, then delete the now-empty <b>Imported</b> folder.
          </li>
          <li>
            <b>Resume sync:</b> turn <b>Sync</b> back On. Chrome pushes your new local bookmarks up to your Google
            account and down to your other devices.
          </li>
        </ol>
      </section>

      <section>
        <h2><component :is="icon('Check')" :size="14" /> Is it safe? (sync notes)</h2>
        <ul>
          <li>Your export file is a full backup — keep it. Optionally export Chrome's current bookmarks again before step 6, and you then have both sets on disk to roll back to.</li>
          <li>
            With sync paused, deletions and imports are strictly local — nothing reaches your account until you
            re-enable sync. Re-enabling syncs the <em>final</em> state upward and across devices.
          </li>
          <li>
            If anything looks wrong later, just re-import the clean file (repeat steps 5–9) or restore the old export.
          </li>
          <li>
            This app never touches your Chrome data directly — it only reads and writes the file you import. Done in
            this order (backup → pause sync → replace → resume), the procedure is safe.
          </li>
        </ul>
      </section>

      <section>
        <h2><component :is="icon('Info')" :size="14" /> Privacy &amp; the link checker</h2>
        <p>
          Everything stays in this browser. The one network helper is the link checker: on this hosted site it asks a
          small serverless proxy (a Netlify Function) to fetch each URL so it can read the real HTTP status — only the
          URL being checked is sent, never your stored bookmarks. Run locally (<code>npm run dev</code> /
          <code>npm run preview</code>) and the check goes through a local proxy on your own machine instead.
        </p>
      </section>
    </div>

    <footer class="ab-foot">
      <span v-if="checkNote" class="ab-checknote">{{ checkNote }}</span>
      <button v-if="canCheck" class="btn-ghost" :disabled="checking" @click="check">
        {{ checking ? 'Checking…' : 'Check for updates' }}
      </button>
      <button class="btn-primary" @click="$emit('close')">Done</button>
    </footer>
  </div>
</template>

<style scoped>
.about {
  width: min(720px, calc(100vw - 40px));
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
}
.ab-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.ab-logo {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--accent), #7c4dff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex: none;
}
.ab-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.ab-title h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.2px;
}
.ab-ver {
  font-size: 11px;
  color: var(--text-3);
  background: var(--surface3);
  border-radius: var(--radius-full);
  padding: 1px 8px;
  font-variant-numeric: tabular-nums;
}
.ab-body {
  overflow-y: auto;
  padding: 4px 20px 12px;
  color: var(--text-2);
  line-height: 1.6;
}
.ab-body section {
  margin: 16px 0;
}
.ab-body h2 {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 8px;
  text-transform: none;
  letter-spacing: 0;
}
.ab-body h2 :deep(svg) {
  color: var(--accent);
}
.ab-body p {
  margin: 4px 0;
}
.ab-body ul,
.ab-body ol {
  margin: 6px 0;
  padding-left: 20px;
}
.ab-body li {
  margin: 4px 0;
}
.ab-body code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 4px;
}
.ab-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}
.ab-checknote {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
}
.btn-ghost {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-ghost:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn-primary {
  height: 32px;
  padding: 0 18px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:hover {
  filter: brightness(1.06);
}
</style>
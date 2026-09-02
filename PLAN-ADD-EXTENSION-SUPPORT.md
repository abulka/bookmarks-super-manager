# Plan: Add Chrome extension support ("Live Chrome" tab + batch Apply)

Status: not started · Date written: 2026-09-02

## Problem

Day-to-day bookmark tweaks currently require the full roundtrip: export from
Chrome → import here → reorganise → export HTML → delete Chrome bookmarks →
import HTML. Fine for a big reorg, far too much friction for daily use.

## Goal

Open the *real* Chrome bookmarks in a manager tab inside a Chrome extension,
edit them with everything the app already does (drag & drop, undo, dupes,
search, dead-link marking), then push changes back with one **Apply to Chrome**
button. No export/import. The hosted web version and Netlify deploy remain
untouched and unchanged.

## Why this codebase is well suited

- Pure client-side Vue 3 + Vite SPA; no backend. A Chrome extension page is a
  normal page, so the entire app (file tabs, Firefox/Safari imports, HTML
  export, search, dupes, link checker) keeps working as-is.
- The data model maps almost 1:1 onto `chrome.bookmarks`:
  - `BookmarkDoc.root` is a `BmNode` tree (`src/types.ts`).
  - `BmNode.id` is a string — Chrome bookmark ids are strings too, so a live
    doc can use Chrome's ids **directly, no mapping layer**.
  - All mutations flow through one Pinia store (`src/state/docs.ts`).

## Decisions made

1. **Write-back: batch "Apply to Chrome"** (not live streaming). Edits stay in
   the local tree using the existing dirty/undo machinery; one button diffs the
   tree against Chrome and replays ops via the API. One code path, robust,
   minimal diff to existing logic. Live streaming of simple mutations can be a
   later enhancement, with batch kept as fallback.
2. **Target: Chrome only.** (The same MV3 build would work in Edge largely
   unchanged if ever wanted; Firefox would need a small polyfill.)
3. **Keep both**: extension for Chrome bookmarks, web app for imports/exports
   and one-off files.

## Phases

### Phase 1 — Extension scaffolding

- `manifest.json` (MV3) at the extension build root:
  - `permissions: ["bookmarks"]`
  - `host_permissions: ["http://*/*", "https://*/*"]` — lets the link checker
    fetch real HTTP status codes with no local proxy. Chrome shows a
    "read all websites" warning on install; acceptable for personal use.
  - Tiny `src/background.ts` service worker:
    `chrome.action.onClicked` → `chrome.tabs.create({ url: extension page })`.
- `extension.html` — same shell as `index.html`, reuses `src/main.ts` unchanged.
- New `vite.extension.config.ts` building into `dist-extension/` with manifest
  + icons copied in. **Hand-rolled — do NOT use @crxjs** (dubious Vite 8
  compatibility). New script `npm run build:extension`; the web build is
  untouched.
- Icons: need 16/48/128 px (PNG for `action.default_icon`); can be generated
  once from `public/favicon.svg`.
- Dev loop: `build:extension --watch` + "Load unpacked" pointing at
  `dist-extension/` in `chrome://extensions`.
- **Validate first** that the built page loads correctly from
  `chrome-extension://…/extension.html` (root-absolute asset paths should work
  since everything ships inside the extension package) before building more.

### Phase 2 — Live Chrome doc (read path)

- New `src/lib/backend/chrome.ts`:
  - `isChromeExt()` feature detection (`typeof chrome !== 'undefined' &&
    chrome.bookmarks`).
  - Map `chrome.bookmarks.getTree()` → `BookmarkDoc`. Chrome root `id '0'` is
    hidden; top-level folders are Bookmarks bar (`1`), Other bookmarks (`2`),
    Mobile bookmarks (`3`, only when synced). Map each to a `BmNode` under the
    doc root: `id` = Chrome id, `name` = title, `url`, `children` recursive.
  - **Date units**: Chrome uses milliseconds since epoch; the app uses seconds
    (`ADD_DATE` convention, see `Math.floor(Date.now()/1000)` in docs.ts).
    Normalise in the adapter (`addDate = Math.floor(dateAdded / 1000)`).
- `state/docs.ts` gains `openChromeDoc()`: like `openFromText`, but:
  - `dirty = false`, `fileName` something like `chrome bookmarks`.
  - **Not persisted to IndexedDB** — on startup, if the workspace had a Chrome
    tab, re-open it fresh from the API instead of restoring a stale snapshot.
- External changes (bookmarking a page via the star, edits in Chrome's own
  manager): subscribe to `chrome.bookmarks.onCreated/onChanged/onMoved/
  onRemoved/onChildrenReordered` while a Chrome doc exists (wire in
  `main.ts`/`App.vue`).
  - Doc not dirty → debounced (~500 ms) full rebuild from `getTree()`.
  - Doc dirty → banner/toast: "Chrome changed elsewhere — Reload (discards
    local edits) / Keep editing".

### Phase 3 — Write-back: batch diff → ops → API

- New `src/lib/backend/chromeSync.ts`:
  - `diffTrees(localRoot, chromeRoot)` → ordered op list:
    - **creates** (folders/links; `chrome.bookmarks.create` returns the new
      node's id — later ops must reference it, so ops are dependency-ordered),
    - **renames / URL updates** (`update`),
    - **deletes** (`remove`, `removeTree` for non-empty folders),
    - **moves** (`move(id, {parentId, index})`),
    - **reorders** (sorting a folder in-app = a sequence of `move` calls).
  - `move` index semantics are the classic tricky bit: when moving within the
    same parent, indices shift after detachment. Cover with a fake-API test
    suite (see Phase 5) before touching a real profile.
- UI:
  - **Apply to Chrome** button, visible only on the Chrome tab; uses the
    existing `dirty` flag as its enabled/hint state (e.g. in `Toolbar.vue`).
  - Press → show a reviewable summary ("3 created, 5 moved, 1 renamed,
    2 deleted") via `ConfirmBox`; confirmation required when there are deletes.
  - Run ops sequentially, collect failures, report a per-op summary. On
    success: `markExported(docId)` clears the dirty flag + toast.
  - Partial failure: show what applied, keep the doc dirty so it can be
    re-applied (the diff re-runs, so re-apply is idempotent-ish by design).
- **Undo stays purely local** (as today). That is the payoff of batch mode:
  undo/redo operate on the local tree; re-Apply just re-diffs. No inverse-op
  replay to Chrome is needed.

### Phase 4 — Extension-only niceties

- Link checker: with host permissions the worker's `fetch` gets real HTTP
  status codes; gate on `isChromeExt()` and skip the `/api/…` proxy path
  (see `linkcheck-server.ts`, `src/workers/linkchecker.ts`).
- Optional, later: new-tab override setting, toolbar badge, Web Store listing
  ($5 fee + review) — load-unpacked is fine for personal use.

### Phase 5 — Tests & verification

- Vitest (existing suites stay green; `npm run build` unaffected):
  - Node mapping: dates ms→s, root layout, Mobile bookmarks presence.
  - `diffTrees` fixtures: create / move / rename / delete / reorder / nested
    combinations.
  - Op executor against a **fake in-memory `chrome.bookmarks`**
    (`src/lib/backend/fakeChrome.ts`), including id allocation on create and
    same-parent move index semantics.
  - External-event handling (fake events → rebuild/banner logic).
- **Manual testing against a throwaway Chrome profile**:
  `chrome --user-data-dir=/tmp/chrome-test`. Never point the extension at the
  real profile until the sync logic is trusted. Deletes always require
  confirmation and the Apply summary is reviewable first — keep it that way.

## Files

New:

- `manifest.json` (template in repo, copied to build output)
- `src/background.ts`
- `src/lib/backend/chrome.ts` (adapter + feature detection)
- `src/lib/backend/chromeSync.ts` (diff + op executor)
- `src/lib/backend/fakeChrome.ts` (test double)
- `extension.html`
- `vite.extension.config.ts`
- icons (16/48/128)

Edited:

- `package.json` — `build:extension` script
- `src/state/docs.ts` — `openChromeDoc()`, Chrome-doc non-persistence, dirty
  handling for external changes
- `src/main.ts` / `src/App.vue` — event subscription wiring
- `src/components/chrome/Toolbar.vue` — Apply to Chrome button
- `src/lib/…` link-checker path gating (`isChromeExt()`)
- `README.md` — extension section + dev loop

## Known risks

- **`move` index semantics** on same-parent reorders — the single most likely
  source of corruption; mitigate with fake-API tests and the throwaway profile.
- **Partial batch failure** — ops are sequential and untransactional; design
  for "report + keep dirty + re-apply re-diffs" rather than rollback.
- **MV3/Vite quirks** — validate asset loading in Phase 1 before investing.
- **External changes while dirty** — v1 offers reload-vs-keep-editing only;
  merging both sides is explicitly out of scope.
- `chrome.bookmarks` has **no undo API** — in-app undo is the only safety net;
  batch mode makes that acceptable (Chrome itself only offers Ctrl+Z
  immediately after a delete in its own manager).

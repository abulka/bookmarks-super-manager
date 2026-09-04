# Plan: Add Chrome extension support ("Live Chrome" tab + batch Apply)

Status: implemented (Phases 1–6 incl. distribution + self-update)
2026-09-04 · Written 2026-09-02 · Reviewed 2026-09-03 (all claims verified
against the codebase; amendments below) · Remaining: manual Apply pass on a
throwaway profile, icons

## Implemented (2026-09-03)

- Phase 1: `manifest.json` + `src/background.ts` + `extension.html` +
  `vite.extension.config.ts` (`npm run build:extension`); `@types/chrome` in
  devDeps, `chrome` added to tsconfig `types`.
- Phase 2: `src/lib/backend/chrome.ts` (detection, mapping, plain snapshots,
  baseline store, real backend adapter, watcher) · `openChromeDoc()` /
  `replaceChromeRoot()` / ephemeral rules in `state/docs.ts` (never persisted,
  workspace meta excludes it, undo cleared on reload) · watcher wired in
  `main.ts` (clean rebuild when not dirty; keep-edits toast with Reload action
  when dirty).
- Phase 3: `src/lib/backend/chromeSync.ts` (diff-with-simulation → ordered
  ops, executor with localId→chromeId remap and reference rewriting,
  self-verifying `applyToChrome`, `planApply` baseline guard) · Apply button +
  confirm flow in `Toolbar.vue` · protected: chrome's permanent top-level
  folders are never deleted.
- Phase 4: extension link checker uses CORS-mode fetch (`extCheck`) and skips
  the same-origin proxies.
- UX hardening (2026-09-04): the toolbar Reload button on the live Chrome tab
  really reloads from `chrome.bookmarks` (confirm dialog first when unapplied
  edits would be discarded; silent + toast when clean) — a first-class
  recovery path for the blocked-Apply situation · critical toasts (external
  conflict, blocked Apply, partial Apply failure) are sticky (`ttl 0`, manual
  ✕/action dismiss) · conflict messaging follows decision 7 ("Chrome always
  wins"): it says the tab's edits can no longer be applied, full stop — no
  implied salvage; ordinary toasts keep auto-dismissing
  (`tests/toast-sticky.test.ts`, `tests/chrome-reload.test.ts`).
- Phase 5 (partial): `src/lib/backend/fakeChrome.ts` reproduces the spike
  semantics exactly; 15 tests in `tests/chrome-sync.test.ts` (calibrated move
  scenarios, diff fixtures, executor round-trips, id remap, baseline guard,
  mapping). 136/136 green; web build + extension build clean; live smoke in
  the throwaway profile: chrome tab opens fresh, tree renders, Apply button
  present, zero console errors.

## Architecture (developer reference)

(Moved out of the README — that section was too technical for users.)

- `manifest.json` (MV3) — `bookmarks` permission + host permissions
  (`http/https`, so the link checker reads real HTTP status codes directly, no
  proxy). Copied into `dist-extension/` by `vite.extension.config.ts`, which
  also strips `_`-prefixed root files (e.g. Netlify's `_redirects` — unpacked
  extensions refuse to load with reserved names present).
- `extension.html` + `src/background.ts` — the same Vue app (`src/main.ts`
  unchanged), launched from the toolbar icon
  (`chrome.action.onClicked` → `tabs.create`). The MV3 service worker is a
  separate rollup entry emitted as `background.js` (`"type": "module"`).
- `src/lib/backend/chrome.ts` — feature detection (`isChromeExt()`),
  `chrome.bookmarks` → app model adapter (ids pass through unchanged, dates
  ms → s), plain-tree snapshots, baseline store, real backend adapter,
  external-change watcher (debounced ~500 ms).
- `src/lib/backend/chromeSync.ts` — diff-with-simulation → ordered ops →
  executor (localId→chromeId remapping, reference rewriting) → self-verifying
  re-diff. Move-index semantics pinned empirically (see Spike below).
- `src/lib/backend/fakeChrome.ts` — in-memory test double reproducing the
  observed semantics exactly; `tests/chrome-sync.test.ts` is calibrated
  against `spike/spike-results.json`.
- `spike/` + `scripts/spike-run.mjs` — dev-only tooling: probes the real API
  in a throwaway headless Chrome for Testing profile over CDP and records
  results; doubles as the load/mount smoke test.

**Unpacked-extension mechanics worth remembering:**

- "Load unpacked" stores a *reference to the folder path* in the profile —
  nothing is copied. Chrome reads the folder's current contents at startup and
  on ↻ reload (`chrome://extensions`), which closes the extension's open
  pages. Removing the extension or deleting the profile dir removes the
  registration; the source folder is untouched.
- The extension id is deterministic from the folder's absolute path
  (sha256 → `a`–`p`, see the Spike notes): moving the folder changes the id —
  Chrome then treats it as a different extension and the IndexedDB origin
  changes with it (decision 6 exists precisely so this can't hurt the live
  doc; file docs in extension storage are re-importable by design).

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
4. **Open/Import stays enabled in the extension** (reviewed 2026-09-03). Opening
   an HTML file creates a *separate* document/tab; it never touches the live
   Chrome doc by itself. The Chrome doc only changes when the user explicitly
   moves/copies nodes into it (`copyInto`/`cutInto`, both existing) and presses
   **Apply to Chrome** with a reviewable summary. Cross-doc transfer into the
   Chrome doc is a feature (import a file → cherry-pick → Apply), not a hazard.
   The Chrome tab carries a distinct `fileName`/title so it is never confused
   with a file doc.
5. **Self-verifying Apply** (reviewed 2026-09-03): after replaying ops,
   re-run `getTree()` and re-diff against the local tree. If only move/reorder
   diffs remain, correct them empirically (the diff machinery already exists)
   and report what is still off. Converts "hope the index math is right" into
   "verified within the same run" and makes re-Apply idempotent.
6. **The live Chrome doc is ephemeral — never in IndexedDB.** The extension's
   IndexedDB lives at the `chrome-extension://<id>` origin, which (a) changes
   when an unpacked extension is reloaded from a different path and (b) is
   deleted with "Remove extension". So the live doc must never depend on it:
   see "Ephemeral doc rules" under Phase 2. File docs persist as today; losing
   them only matters if the user removes the extension, and their sources are
   files on disk.
7. **Chrome always wins** (2026-09-04). When the raw Chrome bookmarks change
   while a dirty live doc exists, the local edits are unapplicable — there is
   no merge in v1 and no partial salvage via Apply. All messaging states this
   plainly (no hopeful multi-step recovery): Chrome's state takes priority,
   the tab's edits cannot be applied anymore, Reload is the only way forward
   (discard + pick up current state). The one genuine salvage is exporting the
   tab as HTML first, mentioned only in the reload confirmation dialog. A
   future three-way rebase (baseline as common ancestor) could reintroduce
   real merging — explicitly out of scope until then.

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
- `npm i -D @types/chrome` and add `"chrome"` to `types` in
  `tsconfig.app.json` (its `types` array currently limits auto-inclusion to
  `vite/client`, so the package alone isn't picked up).
- Icons: need 16/48/128 px (PNG for `action.default_icon`); can be generated
  once from `public/favicon.svg`. Not required for `Load unpacked` (Chrome
  shows a default icon) — fine to defer until after the spike.
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
  hidden. **Iterate all children of `'0'` generically** — do not hardcode
  `1`/`2`/`3`: Mobile bookmarks appears only when synced, and newer Chrome
  variants add account-bookmark folders. Map each top-level folder to a
  `BmNode` under the doc root: `id` = Chrome id, `name` = title, `url`,
  `children` recursive. Preserving unknown top-level folders untouched is the
  safe default (Apply only diffs/edits folders the tree actually shows).
- **Date units**: Chrome uses milliseconds since epoch; the app uses seconds
  (`ADD_DATE` convention, see `Math.floor(Date.now()/1000)` in docs.ts).
  Normalise in the adapter (`addDate = Math.floor(dateAdded / 1000)`).
- `state/docs.ts` gains `openChromeDoc()`: like `openFromText`, but:
  - `dirty = false`, `fileName` something like `chrome bookmarks`.
  - **Ephemeral doc rules** (never in IndexedDB — see decision 6):
    - a `BookmarkDoc.ephemeral?: boolean` flag (or reserved id) drives it;
    - `saveDoc()` and `touch()`'s debounced save skip ephemeral docs
      (`docs.ts:71-71, 144-151`);
    - `flushSaves()` (`pagehide`/`beforeunload`) skips them too — never writes
      a stale snapshot;
    - `closeDoc()` skips the `idbDel` for them;
    - workspace meta persisted to IndexedDB **excludes** the Chrome doc id, so
      `init()` can never restore a stale snapshot;
    - on startup in extension mode, `init()` opens the Chrome doc fresh from
      `getTree()` instead of (or in addition to) restoring tabs.
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
    suite (see Phase 5) **calibrated against the spike results** before
    touching a real profile.
  - **Suppress the external-change listeners while Apply is running** (amended
    2026-09-03): our own create/move/delete ops fire `onCreated/onMoved/…`;
    reacting to them mid-apply would churn rebuilds or falsely flag "Chrome
    changed elsewhere". Gate the listener on an `applying` flag; after the
    final op, do one clean rebuild from `getTree()` (which also feeds the
    self-verifying re-diff, decision 5).
  - **Self-verifying finish**: after the last op, re-run `getTree()`, re-diff
    against the local tree; if only reorder-class diffs remain, correct them
    (bounded retry, e.g. 2 passes) and include the outcome in the summary. If
    anything still differs, report it and keep the doc dirty.
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
  (see `linkcheck-server.ts`, `src/workers/linkchecker.ts`). Concrete change
  the plan initially underspecified: in extension mode the probe must switch
  from `mode: 'no-cors'` (opaque responses — status unreadable) to a plain
  CORS-mode fetch so the status code can actually be read; host permissions
  make that bypass CORS on any site.

### Spike (2026-09-03) — done, all results empirical

Throwaway automation, zero contact with the real profile (`spike/` extension +
`scripts/spike-run.mjs` CDP runner; results in `spike/spike-results.json`,
screenshot `spike/app-loaded.png`). Tooling notes:

- **Branded Google Chrome ≥ M137 silently ignores `--load-extension`** even
  with `--disable-features=DisableLoadExtensionCommandLineSwitch` (verified on
  Chrome 152: profile Preferences registered zero extensions). Use the
  Playwright-cached **Chrome for Testing** build (runner default), which
  honours the flag.
- Unpacked extension ids are deterministic: first 32 hex chars of
  `sha256(absolute path)`, each hex digit mapped to `a`–`p`. The runner
  computes and verifies them against the observed id.
- **Phase 1 validated**: the real `dist-extension` build loads from
  `chrome-extension://…/extension.html` — root-absolute `/assets/...` paths
  resolve, the Vue app mounts (`#app` populated), zero console errors,
  screenshot confirms full UI rendering. The MV3 service worker +
  `background.js` entry-file naming scheme works.

**`chrome.bookmarks` semantics (Chrome for Testing 151, all observed):**

- **Move index is pre-removal** — the requested index counts the moved item as
  still present: same-parent with `srcPos < requested` lands at
  `requested − 1`; `srcPos ≥ requested` lands at `requested`; cross-parent
  always lands at `requested`.
- **Bounds are validated, not clamped**: same-parent requested ∈ `[0, count]`
  (`count` = lands at end), cross-parent ∈ `[0, destCount]`,
  `create` ∈ `[0, count]`; anything beyond throws `Index out of bounds`.
  Omitting `index` appends (create and move).
- **Reorder**: the naive loop `for i: move(desired[i], parent, i)` ascending
  only ever moves up or no-ops → lands exactly at `i` → **provably converges**
  (verified: reverse + rotate, both exact). Executor rule: one left-to-right
  placement pass per folder, request `i` directly; no off-by-one arithmetic
  needed anywhere.
- `remove` on a non-empty folder throws (`Can't remove non-empty folder`);
  `removeTree` succeeds. Moving a folder into its own descendant throws
  (`Can't move a folder to itself or its descendant`) — matches the app's
  client-side `isDescendant` guard. `update({title})` and `update({url})`
  both work. Duplicate URLs are allowed (independent nodes).
- **Events**: `onMoved` reports the *final* index (which differs from the
  requested index on downward moves — the event is the truth for rebuilds);
  `onCreated/onChanged/onRemoved` fired as expected; **`onChildrenReordered`
  never fired** in 15 moves — do not rely on it for external-change rebuilds.
- `dateAdded` is milliseconds since epoch (equal to `Date.now()` within 1 ms);
  ids are plain numeric strings. Fresh unsigned profile root children:
  `[1 "Bookmarks bar", 2 "Other bookmarks"]` — no Mobile folder — confirming
  the generic-iteration mapping (never hardcode root child ids).
- `fakeChrome.ts` must reproduce exactly these semantics; its tests are
  calibrated against `spike-results.json`.
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

### Phase 6 — Distribution (implemented 2026-09-04)

**Done:** the zip + sideload pipeline and the in-app self-update notifier.

- **GitHub Actions** (`.github/workflows/release-extension.yml`): on any push
  to `main`, if `package.json` version changed since the last release:
  `npm run build:extension` → injects an `INSTALL.md` guide into
  `dist-extension/` → zips the folder (manifest at zip root) → creates a
  release `v<version>` with `git log` as the changelog. Doc-only pushes skip.
- **Version baking:** `vite.extension.config.ts` now writes the version from
  `package.json` into the copied `manifest.json` (previously hardcoded
  0.1.0), and injects `__UPDATE_REPO__` (from the new `repository` field in
  `package.json`) — the web build defines it as `''`.
- **In-app updater** (`src/lib/updater.ts`): on startup + hourly, fetches
  `api.github.com/repos/abulka/bookmarks-super-manager/releases/latest`; if
  newer than `__APP_VERSION__`, shows a sticky toast with a **Get vX.Y.Z**
  action that opens the release page (zip + notes). One nag per version
  (seen-version kept in idb-keyval). Manual **Check for updates** in the
  About dialog (`AboutDialog.vue`). gated: extension build only ✓
  `isChromeExt()`. Tests: `tests/update.test.ts`
  (`semverCompare`, `parseRelease`, `fetchLatestRelease`, disabled no-op).

**Known boundary (read this before trusting it to update users):** silent
auto-update is impossible for Load-unpacked/sideloaded extensions — this is a
notifier, not a self-installer.

The options below remain the menu for real adoption (ordered by likelihood):

1. **Zip + sideload** (no fee, no store): zip `dist-extension/`, recipients
   unzip → Developer mode → Load unpacked. Works on macOS; Windows nags about
   developer-mode extensions at startup; **no auto-updates** (manual reload of
   each new zip). Only worth it for a handful of known users.
2. **Chrome Web Store, unlisted** — the recommended path for broader sharing:
   - not searchable; reachable only via the store link;
   - the store handles **auto-updates** (Chrome checks every few hours);
   - one-time **$5** registration per Google account — **separate from the
     Play Console program** (a Play developer registration does not transfer
     or waive it);
   - per-version review; broad `host_permissions` (`http/https`) triggers
     extra scrutiny + a privacy disclosure — expect hours-to-days.
3. **Chrome Web Store, public** — same as 2 plus discovery; same mechanics,
   likely similar review. Only if it should be findable.
4. **Self-hosted CRX + `update_url`** — dead for branded Chrome on
   Mac/Windows outside enterprise policy (`ExtensionInstallForcelist`); not
   viable here, noted for completeness.

**Publishing automation (works with option 2/3):** GitHub Actions on tag →
`npm run build:extension` → zip `dist-extension/` → publish via the
`chrome-webstore-upload` action using a one-time OAuth refresh token stored as
a repo secret → users auto-update via the store. The per-version review stays
either way.

**Prerequisites checklist when this phase starts:**

- Icons 16/48/128 px PNG generated from `public/favicon.svg` + wired into
  `manifest.json` (`icons` + `action.default_icon`); the store listing also
  requires a 128px store icon and screenshots.
- Privacy disclosure text (bookmarks read/write justification, host-permission
  use = link checker, all processing local).
- Version handling: `manifest.json` version is currently hardcoded `0.1.0` —
  derive it from `package.json` in `vite.extension.config.ts` and bump on
  every release (the store rejects re-uploading an existing version).
- Release zip must contain no `_`-prefixed root files (the build already
  strips them — `_redirects`).


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
- `scripts/spike-run.mjs` + `spike/` (disposable spike tooling + results)

Edited:

- `package.json` — `build:extension` script; `@types/chrome` devDependency
- `tsconfig.app.json` — add `chrome` to `types`
- `src/state/docs.ts` — `openChromeDoc()`, ephemeral-doc rules in
  `saveDoc`/`touch`/`flushSaves`/`closeDoc`/`init`, dirty handling for
  external changes
- `src/main.ts` / `src/App.vue` — event subscription wiring
- `src/components/chrome/Toolbar.vue` — Apply to Chrome button
- `src/workers/linkchecker.ts` — CORS-mode probe + proxy skip in extension mode
- `README.md` — extension section + dev loop

## Known risks

- **`move` index semantics** — *resolved by the spike*: pre-removal counting,
  validated bounds, and a provably-converging placement pass (see Spike).
  Remaining risk is implementation, not API behaviour; covered by the
  calibrated fake-API tests + self-verifying Apply + throwaway profile.
- **Self-triggered events during Apply** — addressed by the `applying` gate +
  final rebuild (Phase 3).
- **Extension origin storage volatility** — `chrome-extension://<id>` IndexedDB
  changes with the unpacked load path and dies with "Remove extension"; hence
  the ephemeral-doc rules (decision 6): the live doc is never stored, and file
  docs are re-importable by design.
- **Partial batch failure** — ops are sequential and untransactional; design
  for "report + keep dirty + re-apply re-diffs" rather than rollback.
- **MV3/Vite quirks** — validated empirically in Phase 1/spike before
  investing (asset paths, module worker, manifest copy).
- **External changes while dirty** — resolved by rule (decision 7): Chrome
  always wins; the tab's edits are unapplicable and the UI says so. Merging
  both sides (three-way rebase) is explicitly future work.
- `chrome.bookmarks` has **no undo API** — in-app undo is the only safety net;
  batch mode makes that acceptable (Chrome itself only offers Ctrl+Z
  immediately after a delete in its own manager).

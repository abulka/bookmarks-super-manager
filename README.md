# Bookmark Super Manager

A fast, local-first browser bookmark viewer and manager. Sidebar tree, search,
folders, drag & drop, duplicate detection, a link checker, and multiple bookmark
files open as tabs.

It runs in **two modes** — pick whichever suits the job:

- **Standalone web app** — import a bookmark export (`.html` / `.json`), organise
  it as a file, and export a fresh copy. Your bookmarks live in *files* you
  control; the app never touches your live browser bookmarks.
- **Chrome extension (MV3)** — open your **real, live** Chrome bookmarks in a
  manager tab, edit them with everything the web app does, and push the changes
  back into Chrome with one **Apply to Chrome** button.

**Nothing is uploaded.** Everything runs locally in your browser — bookmarks are
stored in your browser's own IndexedDB and never leave your machine. It can be
hosted as a plain static site (e.g. Netlify).

## Two ways to run it

| | Standalone web app | Chrome extension |
| --- | --- | --- |
| Where bookmarks live | In exported **files** you import/export | In Chrome's **live** `chrome.bookmarks` |
| Organising | Import → reorganise → export a fresh copy | Edit live, then **Apply to Chrome** |
| Touches your real Chrome bookmarks? | **No** — never | **Yes** — that's the point |
| Best for | Backups, separate libraries, working on a file | Reorganising the bookmarks you actually use |

Run it standalone at the hosted site or with `npm run dev`. Install the
extension from `dist-extension/` as described below.

### What these two modes share

Both render the same manager — sidebar tree, drag & drop, cut / copy / paste,
multi-select, search, duplicates and dead-link checking, undo — and both keep
everything in this browser, uploading nothing. The only difference is where the
bookmarks come from (a file vs. Chrome itself) and how changes leave the app
(export vs. Apply to Chrome).

## Features

- Netscape-HTML import (Chrome / Safari / Edge / Firefox) and Firefox JSON import
- Chrome-compatible HTML export
- Sidebar tree with drag & drop (cut / copy / paste, multi-select)
- Full-text and folder search
- Duplicate detection (exact + normalized URLs) with an interactive "keep newest" view
- Link checker: DNS/TLS reachability + HTTP status (see note below)
- Dead-bookmark finding, per-folder link/dead counts
- Tabs — open, merge, and switch between several bookmark files
- Undo across reorganisation actions

## Search

Press **⌘F** (or **Ctrl+F**) and type in the omnibox to search names, URLs and
folder names. Results are grouped by their location in the tree.

Smart term matching applies to every search box (the search view, the sidebar
"Filter tree", and the folder picker):

- **Space-separated terms match everything** — `pi code` finds bookmarks that
  contain *both* `pi` and `code`:
  ```
  git commit          → matches items containing "git" AND "commit"
  ```
- **Terms match the visible title as a substring** — `pi` matches `Pi`,
  `pixels`, `Happily`, etc. (anywhere in the name). Names are matched only; a
  short term buried inside a long URL won't produce scan-noise:
  ```
  wik                 → matches "Wikipedia"
  ```
- **Quoted terms are exact whole words** — wrap a term in double quotes to match
  only that word on its own (not `pixels`, `pick`, `pinterest`). Whole-word
  terms also look in the URL:
  ```
  "pi"                → matches the word "pi" only
  pi "code"           → "pi" as a substring of the name, "code" as a whole word
  ```

So `git "branch"` finds an item whose name contains `git` (anywhere) and that
somewhere contains the whole word `branch` (name or URL).


## Quick start

```bash
npm install
npm run dev          # dev server at http://localhost:5199 (Vite)
```

Open **http://localhost:5199**, then either drop your bookmark `.html`/`.json`
files onto the window, pick **Open bookmark files…**, or load the bundled demo
set from the sample picker (synthetic — no personal data).

- `npm run dev` — dev server (port 5199)
- `npm run build` — type-check + production build into `dist/`
- `npm run build:extension` — type-check + build the Chrome extension into `dist-extension/`
- `npm run preview` — serve the production build locally
- `npm test` — unit tests
- `make samples` — (in the parent container) copy a campaign's real exports as
  samples for development (stays local; never committed)

## Chrome extension (live bookmarks)

This is the second of the two modes (see the comparison above). Instead of the
export → import → reorganise → export → re-import roundtrip, the app runs as a
Chrome extension (MV3) that opens your *real* Chrome bookmarks in a manager tab.
Edit with everything the web app does, then push the changes back with one
**Apply to Chrome** button. The hosted standalone version is unaffected.

> **The live tab hides Chrome's top-level "Mobile bookmarks" folder.** It is
> sync bookkeeping that only clutters the tree; it stays untouched in Chrome,
> and Apply never deletes Chrome's permanent top-level folders.

Safety model: the live tab is never persisted (always re-read fresh from
`chrome.bookmarks`), Apply shows a reviewable diff summary and confirms
deletes, refuses to run if Chrome changed elsewhere since the tab was loaded,
and permanently verifies the result by re-diffing after the write. Chrome's
permanent top-level folders (Bookmarks bar / Other bookmarks) are never
deleted.

### Build & try it (throwaway profile first!)

```bash
npm run build:extension
# launch a Chrome instance with its own private profile
npm run run:extension
```

In that window:

1. Go to `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked** → choose `…/bookmarks-super-manager/dist-extension`
4. Click the extension's toolbar icon → the manager opens with the live
   `chrome bookmarks` tab

The `--user-data-dir` profile is a scratch instance — its bookmarks, storage
and the extension itself are fully isolated from your daily Chrome. Don't sign
in or enable sync on it. Never omit the flag when testing; omitting it loads
the extension into your real profile (which is exactly how you use it for real
once you trust it — same steps, your normal window).

Note: `--load-extension` on the command line is dead in branded Chrome (≥ M137
silently ignores it — verified during the spike), but the **Load unpacked** UI
works fine.

### Installing from a GitHub release (no compile needed)

Every push to `main` that bumps the version in `package.json` triggers an
automated build on GitHub Actions that produces a ready-to-install zip and
files it as a **GitHub Release**. To install it:

1. Open the repo's **Releases** page (or pick it up via the in-app updater
   below) and download the latest `bookmark-super-manager-vX.Y.Z.zip`
2. Extract it anywhere — it contains `manifest.json` at its root plus the
   bundled app and an `INSTALL.md` walkthrough
3. `chrome://extensions` → **Developer mode** (top right) → **Load unpacked**
   → the extracted folder

The extension keeps a **copy of the folder path**, so to update to a newer
release: unzip it to its own folder, remove the old copy on
`chrome://extensions`, and Load unpacked the new folder.

### Self-update check (the "cheeky bit")

Because sideloaded extensions can't silently auto-update on branded Chrome
(no `update_url` path outside the Web Store — Google red tape, fees and
bureaucracy, exactly what I'm avoiding), the extension instead **checks for
itself**:

- On startup, and hourly while it's open, it asks
  `api.github.com/repos/abulka/bookmarks-super-manager/releases/latest`
- If a newer version exists it shows a **"Get vX.Y.Z"** notice → clicking it
  opens the release page with the zip and notes
- It only nags once per version, so re-opening the tab doesn't re-toast it
- **About & help** → **Check for updates** runs it on demand

Everything stays local; the only network call is this version check.

> Why not silent? Load-unpacked extensions are a folder referenced by Chrome,
> not a managed package. There is no legitimate way for one to replace itself,
> so "self-update" means "notice + hand you the zip + tell you the two clicks"
> rather than pretending otherwise.

### Updating the extension during development

"Load unpacked" does not copy anything into the profile — Chrome **references
the `dist-extension/` folder on disk** and reads its current contents whenever
it starts or reloads the extension. So:

1. Rebuild: `npm run build:extension` (or keep `npx vite build --config vite.extension.config.ts --watch`
   running to rebuild on every save)
2. In `chrome://extensions`, click the **↻ reload icon** on the extension's
   card — this re-reads the folder, manifest and service worker included.
3. Reloading closes the extension's open pages, so click the toolbar icon
   again to reopen the manager.

You only need **Remove + Load unpacked again** when:

- the manifest is broken after an edit (Chrome shows the error on the card), or
- the `dist-extension/` folder **moved** — the extension id is derived from
  the folder's absolute path, so a moved folder is a different extension as
  far as Chrome is concerned. The live `chrome bookmarks` tab is unaffected by
  such an id change (it is always re-read from Chrome), and any open file tabs
  are re-importable from their source files.

The card also shows console errors from the extension's service worker after
a reload — useful when something breaks.

### How it works (technical)

See [PLAN-ADD-EXTENSION-SUPPORT.md](PLAN-ADD-EXTENSION-SUPPORT.md) for the
architecture, the pinned `chrome.bookmarks` semantics, the spike results and
the distribution plan.

## Link-checking note

A browser can only see cross-origin network failures, not "page gone" status
codes. For best results the app uses a small local proxy during `npm run dev` /
`npm run preview` (Vite plugin in `linkcheck-server.ts`) that reads the real HTTP
status on your own machine. On a static hosting deploy that proxy is absent and
link-checking falls back to network-level (DNS/TLS/connectivity) checks only.

## License

MIT — see [LICENSE](LICENSE).
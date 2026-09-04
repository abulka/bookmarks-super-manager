# Bookmark Super Manager

A fast, local-first browser bookmark viewer and manager. Sidebar tree, search,
drag & drop, duplicate detection, a link checker, and multiple bookmark files
open as tabs.

![Screenshot](/doco/images/screenshot.png)

**Nothing is uploaded.** Everything runs locally in your browser — bookmarks
live in your browser's own IndexedDB and never leave your machine.

## Get it

| | Standalone web app | Chrome extension |
| --- | --- | --- |
| What it is | A website you open in any browser | An MV3 extension for your live Chrome bookmarks |
| Bookmarks | Exported **files** (import → organise → export) | **Live** `chrome.bookmarks`, edited in place |
| Touches your real bookmarks? | **No** | **Yes** — that's the point |

- **Standalone web app** — deployed automatically at
  [bookmarks-super-manager.netlify.app](https://bookmarks-super-manager.netlify.app/).
  Open it and drop in a bookmark `.html`/`.json` export. Your live bookmarks
  are never touched.
- **Chrome extension** — edit your **real** Chrome bookmarks in a manager tab,
  then push changes back with one **Apply to Chrome** button. Grab the latest
  release zip from the **[Releases page](https://github.com/abulka/bookmarks-super-manager/releases)**:
  unzip it, then `chrome://extensions` → Developer mode → **Load unpacked** →
  the extracted folder. No compile needed.

Both modes share the same manager — the only difference is where bookmarks
come from (a file vs. Chrome) and how changes leave (export vs. Apply).

## Features

- Netscape-HTML import (Chrome / Safari / Edge / Firefox) and Firefox JSON import
- Chrome-compatible HTML export
- Sidebar tree with drag & drop, cut / copy / paste, multi-select
- Full-text and folder search
- Duplicate detection with an interactive "keep newest" view
- Link checker and dead-bookmark finding, per-folder link/dead counts
- Tabs — open, merge, and switch between bookmark files
- Undo across reorganisation actions

## Search

Press **⌘F** / **Ctrl+F** and type in the omnibox to search names, URLs and
folder names. Results are grouped by their location in the tree.

Smart term matching applies to every search box:

- **Space-separated terms match everything** — `pi code` finds items matching
  *both* `pi` *and* `code`.
- **Terms match the title as a substring** — `wik` matches `Wikipedia` (names
  only; buried-in-URL terms don't create scan-noise).
- **Double-quoted terms are exact whole words** — `"pi"` matches the word `pi`
  only, and whole-word terms also look in the URL.

So `git "branch"` finds an item whose name contains `git` (anywhere) and that
somewhere contains the whole word `branch` (name or URL).

## Chrome extension details

- **Mobile bookmarks** get their own root section, exactly as in Chrome's
  Bookmark Manager.
- **Safety**: the live tab is never persisted, Apply shows a reviewable diff
  and confirms deletes, refuses to run if Chrome changed elsewhere since the
  tab loaded, and re-diffs after writing. Chrome's permanent top-level folders
  (Bookmarks bar / Other bookmarks / Mobile bookmarks) are never deleted.
- **Updates**: sideloaded extensions can't silently self-update on branded
  Chrome, so the extension checks the GitHub releases API on startup (and
  hourly) and nags once per version with a **"Get vX.Y.Z"** link straight to
  the latest release. That version check is the only network call it makes.

## Link-checking note

A browser only sees cross-origin network failures, not HTTP status codes. For
real statuses the app uses a small local proxy during `npm run dev` /
`npm run preview`. On static hosting (Netlify) that proxy is absent and
link-checking falls back to network-level (DNS/TLS/connectivity) checks only.

## Running from source

```bash
npm install
npm run dev          # dev server at http://localhost:5199 (Vite)
```

Drop `.html`/`.json` files onto the window, pick **Open bookmark files…**, or
load the bundled demo set (synthetic — no personal data).

- `npm run dev` — dev server (port 5199)
- `npm run build` — type-check + production build into `dist/`
- `npm run build:extension` — type-check + build the Chrome extension into `dist-extension/`
- `npm run preview` — serve the production build locally
- `npm test` — unit tests
- `make samples` — (in the parent container) copy a campaign's real exports as
  samples for development (stays local; never committed)

## Cutting a release

Every push to `main` where the version in `package.json` **changed** triggers
the [Release extension zip](.github/workflows/release-extension.yml) workflow —
it builds the extension, zips it, and publishes **vX.Y.Z** as a GitHub Release
(the in-app updater reads that same feed). Pushes that don't bump the version
build nothing and create no release.

So a release is just:

1. Bump the version in `package.json`:
   ```bash
   npm version patch   # or minor / major
   ```
   (this also tags the commit — push the tag too, see below)
2. Commit and push:
   ```bash
   git push && git push --tags
   ```
3. Watch the **Actions** tab — when the job is green the new release is live
   on the [Releases page](https://github.com/abulka/bookmarks-super-manager/releases).
   Release notes are generated automatically from the commits since the last
   release tag.

Notes:

- The workflow only cares about `package.json`'s version, not the tag. If you
  bump the version but forget `git push --tags`, the release still happens —
  it's just built from `HEAD` on `main` and tagged with `vX.Y.Z` automatically.
- If a release for the current version already exists, the job skips — bump the
  version again for your next release.

## For developers

Contributors building and testing from source — end users don't need this
section.

### Build & try the extension (throwaway profile first!)

```bash
npm run build:extension
# launch a Chrome instance with its own private profile
npm run run:extension
```

In that window: `chrome://extensions` → **Developer mode** → **Load unpacked**
→ `…/bookmarks-super-manager/dist-extension`, then click the toolbar icon.

The `--user-data-dir` profile is a scratch instance — fully isolated from your
daily Chrome. Don't sign in or enable sync; omit the flag only when you're
ready to load it into your real profile. Note: `--load-extension` on the
command line is dead in branded Chrome (≥ M137 silently ignores it), but the
**Load unpacked** UI works fine.

### Iterating on the extension

"Load unpacked" **references** `dist-extension/` on disk — Chrome re-reads it
on every reload. So: rebuild (or use
`npx vite build --config vite.extension.config.ts --watch`), then hit the ↻
reload icon on the extension card in `chrome://extensions`. You only need
**Remove + Load unpacked again** when the manifest is broken or the folder
moved (the extension id derives from the folder's absolute path).

### How it works (technical)

See [PLAN-ADD-EXTENSION-SUPPORT.md](PLAN-ADD-EXTENSION-SUPPORT.md) for the
architecture, the pinned `chrome.bookmarks` semantics, the spike results and
the distribution plan.

## License

MIT — see [LICENSE](LICENSE).
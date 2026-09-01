# Bookmark Super Manager

A fast, local-first browser bookmark viewer and manager. Import your Chrome /
Safari / Edge / Firefox (or any Netscape-format) bookmark export, then organise:
sidebar tree, search, folders, drag & drop, duplicate detection, a link checker,
and multiple bookmark files open as tabs. Export back to Chrome-compatible HTML.

**Nothing is uploaded.** Everything runs locally in your browser — bookmarks are
stored in your browser's own IndexedDB and never leave your machine. It can be
hosted as a plain static site (e.g. Netlify).

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
- `npm run preview` — serve the production build locally
- `npm test` — unit tests
- `make samples` — (in the parent container) copy a campaign's real exports as
  samples for development (stays local; never committed)

## Link-checking note

A browser can only see cross-origin network failures, not "page gone" status
codes. For best results the app uses a small local proxy during `npm run dev` /
`npm run preview` (Vite plugin in `linkcheck-server.ts`) that reads the real HTTP
status on your own machine. On a static hosting deploy that proxy is absent and
link-checking falls back to network-level (DNS/TLS/connectivity) checks only.

## License

MIT — see [LICENSE](LICENSE).
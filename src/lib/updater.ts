// Self-update notifier for the Chrome extension.
//
// Sideloaded ("Load unpacked") extensions cannot silently self-update on
// branded Chrome — there is no legitimate update_url path outside the Web
// Store (see the distribution notes in PLAN-ADD-EXTENSION-SUPPORT.md). So
// "self-update" here is the honest version: poll GitHub Releases for a newer
// version, tell the user, and open the release page (zip + release notes)
// so they can re-load it themselves.
//
// The web build ships this module but never activates it: __UPDATE_REPO__ is
// '' there and updaterEnabled() additionally requires the chrome.bookmarks
// API.

import { isChromeExt } from './backend/chrome'
import { useUi } from '../state/ui'

export interface UpdateInfo {
  version: string
  releaseUrl: string
  zipUrl: string | null
}

export const UPDATE_SEEN_KEY = 'bm.updater.seen.v1'
const POLL_MS = 60 * 60 * 1000 // hourly

/** "owner/repo" the release feed is read from (injected at build time). */
export function updateRepo(): string {
  return __UPDATE_REPO__
}

/** The self-update only makes sense inside the extension build. */
export function updaterEnabled(): boolean {
  return updateRepo() !== '' && isChromeExt()
}

/** "0.1.0" vs "v0.1.10": leading "v" tolerated, numeric dot-parts compared. */
export function semverCompare(a: string, b: string): number {
  const pa = a.trim().replace(/^v/i, '').split('.').map(Number)
  const pb = b.trim().replace(/^v/i, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Pick {version, releaseUrl, zipUrl} out of a GitHub "/releases/latest" body. */
export function parseRelease(data: unknown): UpdateInfo | null {
  const d = data as Record<string, unknown> | null
  if (d === null || typeof d !== 'object') return null
  if (typeof d.tag_name !== 'string' || typeof d.html_url !== 'string') return null
  let zipUrl: string | null = null
  if (Array.isArray(d.assets)) {
    for (const a of d.assets as Array<Record<string, unknown>>) {
      if (typeof a.browser_download_url === 'string' && (a.browser_download_url as string).endsWith('.zip')) {
        zipUrl = a.browser_download_url as string
        break
      }
    }
  }
  return {
    version: (d.tag_name as string).trim().replace(/^v/i, ''),
    releaseUrl: d.html_url as string,
    zipUrl,
  }
}

/**
 * Fetch the latest release of `repo`. Exported for tests, which pass a
 * stubbed fetch; production uses the default global fetch (GitHub's API is
 * CORS-open, so this works from a chrome-extension:// origin too).
 */
export async function fetchLatestRelease(
  repo: string = updateRepo(),
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<UpdateInfo | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!res.ok) return null
  return parseRelease(await res.json())
}

export type UpdateStatus = 'new' | 'up-to-date' | 'error'

/** Manual "Check for updates" from the About dialog. */
export async function checkForUpdateNow(): Promise<UpdateStatus> {
  if (!updaterEnabled()) return 'up-to-date'
  try {
    const info = await fetchLatestRelease()
    if (!info) return 'error'
    if (semverCompare(info.version, __APP_VERSION__) <= 0) return 'up-to-date'
    rememberSeen(info.version)
    announce(info)
    return 'new'
  } catch {
    return 'error'
  }
}

/** Kick off the background poll: immediately, then hourly. */
export function startUpdateChecks(): void {
  if (!updaterEnabled()) return
  void runBackgroundCheck()
  setInterval(() => void runBackgroundCheck(), POLL_MS)
}

/** Background poll — only nags once per version, then waits for a newer one. */
async function runBackgroundCheck(): Promise<void> {
  if (!updaterEnabled()) return
  try {
    const info = await fetchLatestRelease()
    if (!info) return
    if (semverCompare(info.version, __APP_VERSION__) <= 0) return
    if ((await seenVersion()) === info.version) return
    rememberSeen(info.version)
    announce(info)
  } catch {
    /* transient network failure — the hourly poll retries */
  }
}

async function seenVersion(): Promise<string> {
  try {
    const { get } = await import('idb-keyval')
    const v = await get(UPDATE_SEEN_KEY)
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

function rememberSeen(version: string): void {
  void import('idb-keyval')
    .then(({ set }) => set(UPDATE_SEEN_KEY, version))
    .catch(() => {
      /* ignore persistence failures */
    })
}

function announce(info: UpdateInfo): void {
  const ui = useUi()
  ui.notify(
    'info',
    `Bookmark Super Manager v${info.version} is available. It won't install itself — the release page has the zip and 1-minute reinstall steps.`,
    {
      label: `Get v${info.version}`,
      onClick: () => window.open(info.releaseUrl, '_blank', 'noopener,noreferrer'),
    },
  )
}
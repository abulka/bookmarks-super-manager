import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdateNow, fetchLatestRelease, parseRelease, semverCompare } from '../src/lib/updater'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('semverCompare', () => {
  it('treats equal versions (with or without a leading v) as 0', () => {
    expect(semverCompare('0.1.0', '0.1.0')).toBe(0)
    expect(semverCompare('v0.1.0', '0.1.0')).toBe(0)
    expect(semverCompare('v0.1.0', 'V0.1.0')).toBe(0)
  })

  it('compares numerically, not lexicographically', () => {
    expect(semverCompare('0.1.9', '0.1.10')).toBe(-1)
    expect(semverCompare('0.2.0', '0.1.99')).toBe(1)
    expect(semverCompare('1.0.0', '0.9.9')).toBe(1)
  })

  it('treats missing trailing parts as zero', () => {
    expect(semverCompare('0.1', '0.1.0')).toBe(0)
    expect(semverCompare('0.1', '0.1.1')).toBe(-1)
  })
})

describe('parseRelease', () => {
  const release = {
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/abulka/bookmarks-super-manager/releases/tag/v0.2.0',
    assets: [
      { browser_download_url: 'https://example.com/unrelated.json', name: 'stuff.json' },
      { browser_download_url: 'https://example.com/bookmark-super-manager-v0.2.0.zip', name: 'bookmark-super-manager-v0.2.0.zip' },
    ],
  }

  it('pulls the version, release url and the .zip asset', () => {
    expect(parseRelease(release)).toEqual({
      version: '0.2.0',
      releaseUrl: release.html_url,
      zipUrl: 'https://example.com/bookmark-super-manager-v0.2.0.zip',
    })
  })

  it('strips the leading v from the tag when deriving the version', () => {
    expect(parseRelease({ ...release, tag_name: 'v0.1.0' })!.version).toBe('0.1.0')
  })

  it('returns null when the body lacks a tag or release url', () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease({})).toBeNull()
    expect(parseRelease({ tag_name: 'v1.0.0' })).toBeNull()
    expect(parseRelease({ html_url: 'https://x' })).toBeNull()
  })

  it('leaves zipUrl null when no .zip asset is attached', () => {
    expect(parseRelease({ ...release, assets: [] }).zipUrl).toBeNull()
    expect(parseRelease({ ...release, assets: [{ browser_download_url: 'https://example.com/only.tar.gz' }] }).zipUrl).toBeNull()
  })
})

describe('fetchLatestRelease', () => {
  function mockFetch(data: unknown, ok = true): typeof fetch {
    return vi.fn(async () => ({ ok, json: async () => data }) as unknown as Response) as unknown as typeof fetch
  }

  it('requests the repo feed and returns the parsed release', async () => {
    const release = {
      tag_name: 'v0.2.0',
      html_url: 'https://example.com/releases/tag/v0.2.0',
      assets: [{ browser_download_url: 'https://example.com/a.zip' }],
    }
    const fetchImpl = mockFetch(release)
    const info = await fetchLatestRelease('abulka/bookmarks-super-manager', fetchImpl)
    expect(info).not.toBeNull()
    expect(info?.version).toBe('0.2.0')
    expect(info?.zipUrl).toBe('https://example.com/a.zip')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/abulka/bookmarks-super-manager/releases/latest',
      expect.objectContaining({ headers: expect.anything() }),
    )
  })

  it('returns null on a non-ok response (e.g. rate limited, no releases yet)', async () => {
    expect(await fetchLatestRelease('x/y', mockFetch(null, false))).toBeNull()
  })

  it('returns null when the body cannot be parsed', async () => {
    expect(await fetchLatestRelease('x/y', mockFetch({ oops: 1 }))).toBeNull()
  })
})

describe('checkForUpdateNow', () => {
  it('reports up-to-date and does not fetch when the updater is not wired in (web build)', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await checkForUpdateNow()).toBe('up-to-date')
    expect(spy).not.toHaveBeenCalled()
  })
})
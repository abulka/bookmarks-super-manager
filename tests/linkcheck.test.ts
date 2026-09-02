// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkUrl } from '../linkcheck-server.js'
import { checkUrl as netlifyCheckUrl } from '../netlify/functions/linkcheck.mjs'

// Both server implementations duplicate the same checkUrl logic (the deployed
// Netlify function can't share TS with the dev proxy), so run every case
// against both to keep them from drifting.
const impls = [
  { name: 'dev proxy', checkUrl },
  { name: 'netlify function', checkUrl: netlifyCheckUrl },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Node's undici fetch surfaces TLS failures as a cause chain rooted at a "fetch failed" TypeError. */
function certCause(code: string, message: string): Error {
  const outer = new TypeError('fetch failed') as Error & { cause?: unknown }
  const inner = new Error(message) as Error & { code?: string }
  inner.code = code
  outer.cause = inner
  return outer
}

function stubFetch(rejectWith?: Error, resolveWith?: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (rejectWith) throw rejectWith
    return resolveWith
  }))
}

describe('linkcheck TLS classification', () => {
  for (const { name, checkUrl } of impls) {
    describe(name, () => {
      it('treats an untrusted / broken cert chain as unverified (tls), not dead', async () => {
        stubFetch(certCause('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate'))
        const r = await checkUrl('https://w2ui.com/web/home')
        expect(r).toMatchObject({ ok: true, status: 0, error: null, note: 'tls' })
      })

      it('treats other certificate-verification failures as unverified too', async () => {
        stubFetch(certCause('CERT_HAS_EXPIRED', 'certificate has expired'))
        expect(await checkUrl('https://expired.example/')).toMatchObject({ ok: true, note: 'tls' })

        stubFetch(certCause('DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate'))
        expect(await checkUrl('https://selfsigned.example/')).toMatchObject({ ok: true, note: 'tls' })
      })

      it('recognises a cert failure even when no OpenSSL code is present (message fallback)', async () => {
        stubFetch(certCause('', 'self-signed certificate in certificate chain'))
        expect(await checkUrl('https://no-code.example/')).toMatchObject({ ok: true, note: 'tls' })
      })

      it('keeps reporting a genuine network failure as dead', async () => {
        stubFetch(new Error('getaddrinfo ENOTFOUND nosuchdomain.invalid'))
        const r = await checkUrl('https://nosuchdomain.invalid/')
        expect(r.ok).toBe(false)
        expect(r.note).toBeUndefined()
      })

      it('keeps reporting our own timeout as unverified, not dead', async () => {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        stubFetch(err)
        const r = await checkUrl('https://slow.example/')
        expect(r).toMatchObject({ ok: true, status: 0, note: 'timeout' })
      })
    })
  }
})

describe('linkcheck status classification (netlify function)', () => {
  it('still reports a plain 404 as dead', async () => {
    stubFetch(undefined, new Response('nope', { status: 404 }))
    const r = await checkUrl('https://gone.example/page')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('treats a 404 that still serves a real page as unverified, not dead', async () => {
    const longBody =
      '<html><head><title>Hantek6002BE Series</title></head><body><h1>Digital Oscilloscope</h1><p>' +
      'lorem ipsum dolor sit amet '.repeat(40) +
      '</p></body></html>'
    stubFetch(
      undefined,
      new Response(longBody, {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const r = await checkUrl('https://www.hantek.com/en/ProductDetail_2_31.html')
    expect(r).toMatchObject({ ok: true, status: 404, note: 'page' })
  })

  it('still treats a genuine HTML 404 page (with not-found language) as dead', async () => {
    stubFetch(
      undefined,
      new Response('<html><head><title>Page not found</title></head><body><h1>404 Not Found</h1><p>The page you are looking for does not exist.</p></body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const r = await checkUrl('https://gone.example/page')
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('still treats a short marker-less 404 (no real-page structure) as dead', async () => {
    stubFetch(undefined, new Response('Gone.', { status: 410, headers: { 'content-type': 'text/html' } }))
    const r = await checkUrl('https://gone.example/page')
    expect(r).toMatchObject({ ok: false, status: 410 })
  })

  it('still treats a 404 on a code host as unverified (private repo)', async () => {
    stubFetch(undefined, new Response('nope', { status: 404 }))
    const r = await checkUrl('https://github.com/someone/private-repo')
    expect(r).toMatchObject({ ok: true, status: 404, note: 'unverified' })
  })

  it('still flags a parked 200 page as dead', async () => {
    stubFetch(undefined, new Response('<html><h1>This domain is for sale</h1></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const r = await checkUrl('https://parked.example/')
    expect(r).toMatchObject({ ok: false, status: 200, note: 'parked' })
  })

  it('still treats a normal 200 html page as alive', async () => {
    stubFetch(undefined, new Response('<html><h1>JavaScript UI library</h1></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const r = await checkUrl('https://w2ui.com/web/home')
    expect(r).toMatchObject({ ok: true, status: 200 })
  })

  it('still treats a non-html 200 (e.g. image) as alive', async () => {
    stubFetch(undefined, new Response('not really a png', { status: 200, headers: { 'content-type': 'image/png' } }))
    const r = await checkUrl('https://example.com/pic.png')
    expect(r).toMatchObject({ ok: true, status: 200 })
  })
})

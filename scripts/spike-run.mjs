// Spike runner: launches a THROWAWAY headless Chrome profile, loads the spike
// extension + the real dist-extension build, drives them over CDP, and saves:
//   spike/spike-results.json  — chrome.bookmarks semantics probe results
//   spike/app-loaded.png      — screenshot of the real app page (Phase 1 check)
// Never points at the user's real profile: --user-data-dir is always a fresh
// /tmp directory that is wiped at start.
// Usage: node scripts/spike-run.mjs [chrome-binary]
import { spawn } from 'node:child_process'
import { rmSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const spikeDir = join(root, 'spike')
const distExt = join(root, 'dist-extension')

/** deterministic id Chrome assigns to an unpacked extension at `dir` */
function unpackedId(dir) {
  const h = createHash('sha256').update(dir).digest('hex').slice(0, 32)
  return [...h].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
}

// Branded Google Chrome (≥M137) ignores --load-extension entirely (verified
// empirically: zero extensions registered in the profile Preferences), so the
// default binary is the Playwright-cached Chrome for Testing build.
const chromeBin =
  process.argv[2] ||
  process.env.CHROME_BIN ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function launch(port) {
  const profile = mkdtempSync(join(tmpdir(), 'bsm-spike-'))
  const args = [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${spikeDir},${distExt}`,
    `--load-extension=${spikeDir},${distExt}`,
    'about:blank',
  ]
  const child = spawn(chromeBin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const stderr = []
  child.stderr.on('data', (d) => stderr.push(String(d)))
  child.on('exit', (code) => stderr.push(`[chrome exited ${code}]`))
  return { child, profile, stderr }
}

async function waitForDevtools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (r.ok) return await r.json()
    } catch {
      /* not up yet */
    }
    await sleep(300)
  }
  throw new Error(`DevTools endpoint on :${port} never came up`)
}

/** minimal CDP-over-WebSocket client */
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.events = []
    this.ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    })
  }
  static async connect(wsUrl) {
    const c = new Cdp(wsUrl)
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true })
      c.ws.addEventListener('error', () => rej(new Error('ws connect failed')), { once: true })
    })
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP ${method} timed out`))
        }
      }, 15000)
    })
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  for (const port of [9223, 9224, 9225]) {
    try {
      return await run(port)
    } catch (e) {
      console.error(`port ${port}: ${e.message}`)
      if (port === 9225) throw e
    }
  }
}

async function run(port) {
  const { child, stderr } = launch(port)
  try {
    await waitForDevtools(port)

    // wait for the spike page the service worker opens on install
    let spikeTarget = null
    const deadline = Date.now() + 30000
    while (Date.now() < deadline && !spikeTarget) {
      const targets = await waitForDevtools(port, 3000)
      spikeTarget = targets.find((t) => (t.url || '').endsWith('/spike.html'))
      if (!spikeTarget) await sleep(400)
    }
    if (!spikeTarget) {
      throw new Error(
        `spike.html target never appeared — did --load-extension work with ${chromeBin}?\n${stderr.join('')}`,
      )
    }
    const extId = new URL(spikeTarget.url).host
    if (extId !== unpackedId(spikeDir)) {
      throw new Error(`id formula mismatch: observed ${extId}, computed ${unpackedId(spikeDir)}`)
    }
    const distId = unpackedId(distExt)
    console.log('spike extension id:', extId, '| dist extension id:', distId)

    const cdp = await Cdp.connect(spikeTarget.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')

    let result = null
    const doneDeadline = Date.now() + 30000
    while (Date.now() < doneDeadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'window.__SPIKE_DONE__ === true',
        returnByValue: true,
      })
      if (r.result.value === true) break
      await sleep(300)
    }
    const res = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__SPIKE_RESULT__)',
      returnByValue: true,
    })
    result = JSON.parse(res.result.value)
    cdp.close()
    mkdirSync(spikeDir, { recursive: true })
    writeFileSync(join(spikeDir, 'spike-results.json'), JSON.stringify(result, null, 2))
    console.log(`wrote spike/spike-results.json (${result.steps?.length ?? 0} steps, ${result.events?.length ?? 0} events)`)

    // ---- Phase 1 validation: load the real app page (from the dist build) ----
    const appTarget = await (
      await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${distId}/extension.html`, { method: 'PUT' })
    ).json()
    await sleep(2500) // let the SPA mount

    const targets = await waitForDevtools(port, 3000)
    const app = targets.find((t) => (t.url || '').includes('/extension.html'))
    const acdp = await Cdp.connect(app.webSocketDebuggerUrl)
    await acdp.send('Runtime.enable')
    await acdp.send('Log.enable')
    await acdp.send('Page.enable')

    const mounted = await acdp.send('Runtime.evaluate', {
      expression: `(() => {
        const app = document.querySelector('#app')
        return {
          appChildren: app ? app.children.length : -1,
          bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220),
          title: document.title,
        }
      })()`,
      returnByValue: true,
    })
    const shot = await acdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(spikeDir, 'app-loaded.png'), Buffer.from(shot.data, 'base64'))

    const errors = acdp.events
      .filter((m) => (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') || m.method === 'Runtime.exceptionThrown' || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error'))
      .map((m) => JSON.stringify(m.params).slice(0, 400))
    acdp.close()

    console.log('app page check:', JSON.stringify(mounted.result.value))
    console.log('console errors:', errors.length ? errors : 'none')
    console.log('wrote spike/app-loaded.png')

    // compact summary of the discriminating move-semantics steps
    for (const s of result.steps ?? []) {
      if (/move|reorder|remove/.test(s.name)) {
        console.log(`- ${s.name}: ${s.ok ? JSON.stringify(s.after ?? s.converged ?? s) : 'ERROR: ' + s.error}`)
      }
    }
  } finally {
    child.kill('SIGTERM')
    await sleep(500)
    child.kill('SIGKILL')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

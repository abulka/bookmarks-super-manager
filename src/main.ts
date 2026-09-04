import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/app.css'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')

// boot tasks
Promise.all([
  import('./state/prefs').then((m) => m.usePrefs()),
  import('./state/docs').then((m) => m.useDocs()),
]).then(async ([prefs, docs]) => {
  let storedPrefs: Record<string, unknown> | undefined
  try {
    const { get } = await import('idb-keyval')
    storedPrefs = (await get('bm.prefs.v1')) as Record<string, unknown> | undefined
  } catch {
    /* ignore */
  }
  if (storedPrefs) prefs.hydrate(storedPrefs as never)
  prefs.setTheme(prefs.theme)
  await docs.init()
  await wireChromeWatcher(docs)
})

/** External chrome.bookmarks changes → live rebuild or a keep-edits warning. */
async function wireChromeWatcher(docs: import('./state/docs').DocsStore): Promise<void> {
  const { isChromeExt, watchChromeChanges, fetchChromeTree, getBaseline, setBaseline, plainEquals, chromeRootToNode, CHROME_DOC_ID } =
    await import('./lib/backend/chrome')
  const { applying } = await import('./lib/backend/chromeSync')
  const { useUi } = await import('./state/ui')
  const ui = useUi()
  if (!isChromeExt()) return
  watchChromeChanges(async () => {
    const doc = docs.byId(CHROME_DOC_ID)
    if (!doc || applying) return
    try {
      const fresh = await fetchChromeTree()
      const baseline = getBaseline(CHROME_DOC_ID)
      if (!baseline || plainEquals(baseline, fresh)) return
      if (!doc.dirty) {
        docs.replaceChromeRoot(CHROME_DOC_ID, chromeRootToNode(fresh))
        setBaseline(CHROME_DOC_ID, fresh)
        ui.notify('info', 'The Chrome bookmarks changed outside this tab — it was reloaded automatically (it had no unsaved edits).')
        return
      }
      // doc has unapplied edits: never merge silently (v1). The rule is
      // simple and the message says it plainly: Chrome always wins, so these
      // edits are dead — no hopeful half-steps.
      ui.notify(
        "error",
        "The Chrome bookmarks were changed outside this tab. Chrome's bookmarks always take priority, so the edits in this tab can no longer be applied. Reload picks up the current bookmarks and discards those edits.",
        {
          label: "Reload now",
          onClick: async () => {
            try {
              const f2 = await fetchChromeTree()
              docs.replaceChromeRoot(CHROME_DOC_ID, chromeRootToNode(f2))
              setBaseline(CHROME_DOC_ID, f2)
              ui.notify('success', 'Reloaded — the tab now shows the current Chrome bookmarks.')
            } catch {
              /* ignore */
            }
          },
        },
        0,
      )
    } catch {
      /* transient chrome API failure — next event retries */
    }
  })
}
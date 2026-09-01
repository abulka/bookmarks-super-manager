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
})
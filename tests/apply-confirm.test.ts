import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useDocs } from '../src/state/docs'
import { usePrefs } from '../src/state/prefs'
import { useUi } from '../src/state/ui'
import Toolbar from '../src/components/chrome/Toolbar.vue'
import ConfirmBox from '../src/components/shared/dialogs/ConfirmBox.vue'

const mocks = vi.hoisted(() => ({
  planApply: vi.fn(async () => ({
    blocked: false,
    ops: [{ kind: 'create', localId: 'x', parentId: '1', title: 'X', folder: false }],
    counts: { created: 1, updated: 0, moved: 0, deleted: 0 },
  })),
  applyToChrome: vi.fn(async () => ({ ok: true, applied: 1, failures: [], tree: { id: '0', title: '', children: [] } })),
}))

vi.mock('../src/lib/backend/chromeSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/backend/chromeSync')>()
  return { ...actual, planApply: mocks.planApply, applyToChrome: mocks.applyToChrome }
})

const wait = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).chrome = { bookmarks: { getTree: vi.fn() } } // extension mode
  setActivePinia(createPinia())
  const docs = useDocs()
  const docId = docs.newBlankDoc()
  const doc = docs.byId(docId)!
  doc.ephemeral = true
  doc.dirty = true
  docs.tabs = [docId]
  docs.activeDocId = docId
})

afterAll(() => {
  delete (globalThis as Record<string, unknown>).chrome
  useDocs().dispose()
})

it('skip-apply-confirm: does not ask when opted out, and persists the opt-out', async () => {
  const prefs = usePrefs()
  const ui = useUi()
  prefs.hydrate({ skipApplyConfirm: false })
  mocks.applyToChrome.mockClear()

  const w = mount(Toolbar, { attachTo: document.body })
  const btn = w.find('.apply-btn')
  expect(btn.exists()).toBe(true)

  // 1. with the pref off, Apply opens the confirm modal and does not run yet
  await btn.trigger('click')
  await wait(5)
  expect(ui.modal?.kind).toBe('confirm')
  const payload = ui.modal.payload as { checkbox: { label: string }; onConfirm: (c?: boolean) => void }
  expect(payload.checkbox?.label).toContain("Don't ask again")
  expect(mocks.applyToChrome).not.toHaveBeenCalled()

  // 2. confirming with the checkbox checked stores the opt-out and applies
  payload.onConfirm(true)
  ui.closeModal()
  await wait(5)
  expect(prefs.skipApplyConfirm).toBe(true)
  expect(mocks.applyToChrome).toHaveBeenCalledTimes(1)

  // 3. next Apply runs without any modal (a successful apply cleared `dirty`)
  const doc = useDocs().byId(useDocs().activeDocId)!
  doc.dirty = true
  await w.vm.$nextTick()
  await btn.trigger('click')
  await wait(5)
  expect(ui.modal).toBeNull()
  expect(mocks.applyToChrome).toHaveBeenCalledTimes(2)

  w.unmount()
})

it('ConfirmBox checkbox passes its state to onConfirm', async () => {
  const onConfirm = vi.fn()
  const w = mount(ConfirmBox, {
    props: { payload: { title: 'T', checkbox: { label: 'Don’t ask again' }, onConfirm } },
  })
  const input = w.find('input[type="checkbox"]')
  expect(input.exists()).toBe(true)
  await input.setValue(true)
  await w.find('.foot .btn.primary').trigger('click')
  expect(onConfirm).toHaveBeenCalledWith(true)
  w.unmount()
})

it('skipApplyConfirm round-trips through hydration and persistence', async () => {
  const prefs = usePrefs()
  prefs.setSkipApplyConfirm(true)
  await vi.waitFor(async () => {
    const { get } = await import('idb-keyval')
    expect(await get('bm.prefs.v1')).toMatchObject({ skipApplyConfirm: true })
  })
  prefs.hydrate({ skipApplyConfirm: false })
  expect(prefs.skipApplyConfirm).toBe(false)
})
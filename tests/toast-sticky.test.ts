import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUi } from '../src/state/ui'

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
})
afterEach(() => vi.useRealTimers())

it('ordinary toasts auto-dismiss after their ttl', () => {
  const ui = useUi()
  ui.notify('info', 'ordinary')
  expect(ui.toasts).toHaveLength(1)
  vi.advanceTimersByTime(4000)
  expect(ui.toasts).toHaveLength(0)
})

it('sticky toasts (ttl 0) survive until manually dismissed', () => {
  const ui = useUi()
  ui.notify('error', 'critical', undefined, 0)
  vi.advanceTimersByTime(60_000)
  expect(ui.toasts).toHaveLength(1)
  ui.dismiss(ui.toasts[0]!.id)
  expect(ui.toasts).toHaveLength(0)
})

it('sticky toasts with an action dismiss when the action is taken', () => {
  const ui = useUi()
  let fired = false
  ui.notify('error', 'critical', { label: 'Reload', onClick: () => (fired = true) }, 0)
  vi.advanceTimersByTime(60_000)
  expect(ui.toasts).toHaveLength(1)
  ui.toasts[0]!.action!.onClick()
  expect(fired).toBe(true)
  ui.dismiss(ui.toasts[0]!.id)
  expect(ui.toasts).toHaveLength(0)
})

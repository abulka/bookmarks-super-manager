import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AboutDialog from '../src/components/shared/dialogs/AboutDialog.vue'

it('about dialog renders the version and the key doco sections', () => {
  const w = mount(AboutDialog)
  const text = w.text()
  expect(text).toContain('Bookmark Super Manager')
  expect(text).toContain(`v${__APP_VERSION__}`)
  expect(text).toContain('Recommended workflow — replace your Chrome library')
  expect(text).toContain('Export from Chrome')
  expect(text).toContain('Pause Chrome sync')
  expect(text).toContain('Is it safe? (sync notes)')
  expect(text).toContain('Privacy & the link checker')
  w.unmount()
})
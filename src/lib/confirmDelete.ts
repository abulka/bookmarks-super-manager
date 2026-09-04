import { useUi } from '../state/ui'
import { usePrefs } from '../state/prefs'
import { useDocs } from '../state/docs'

/**
 * Delete bookmarks through the normal flow, honouring the "confirm before
 * deleting" preference. With it enabled the delete is deferred behind a danger
 * confirm modal; the delete itself is undoable either way.
 */
export function confirmDelete(
  docId: string,
  ids: string[],
  notify?: { kind: 'info' | 'success'; text: string },
): void {
  if (!ids.length) return
  const docs = useDocs()
  const ui = useUi()
  const run = (): void => {
    docs.mutDelete(docId, ids)
    if (notify) ui.notify(notify.kind, notify.text)
  }
  if (!usePrefs().confirmOnDelete) {
    run()
    return
  }
  ui.openModal('confirm', {
    title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
    message: 'Removed items can still be recovered with Undo.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: run,
  })
}
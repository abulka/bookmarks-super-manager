import { beforeAll, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useDocs } from '../src/state/docs'
import type { BmNode } from '../src/types'

const SKULL = '❌'

function makeDoc(id: string): string {
  const docs = useDocs()
  const f = Math.floor(Date.now() / 1000)
  const root: BmNode = {
    id: 'root',
    type: 'folder',
    name: '(root)',
    addDate: f,
    children: [
      { id: 'a', type: 'link', name: 'Alive now', url: 'https://a.example/', addDate: f, dead: true, children: [] },
      { id: 'b', type: 'link', name: 'Still dead', url: 'https://b.example/', addDate: f, dead: true, children: [] },
    ],
  }
  docs.docs.push({
    id, fileName: 'd.html', title: 'd', importedAt: Date.now(), root,
    view: 'manager', currentFolderId: 'root', collapsed: {}, selected: [], searchQuery: '',
  })
  docs.tabs.push(id)
  docs.activeDocId = id
  return id
}

beforeAll(() => setActivePinia(createPinia()))

it('reconcileDead revives previously-dead links that come back alive', () => {
  const docs = useDocs()
  const id = makeDoc('reconcile1')
  const d = docs.byId(id)!
  // 'a' is now alive, 'b' still dead
  docs.reconcileDead(id, ['b'], ['a', 'b'])
  expect(d.root.children.find((c) => c.id === 'a')!.dead).toBe(false)
  expect(d.root.children.find((c) => c.id === 'a')!.name).not.toContain(SKULL)
  expect(d.root.children.find((c) => c.id === 'b')!.dead).toBe(true)
})

it('reconcileDead only touches links it actually checked', () => {
  const docs = useDocs()
  const id = makeDoc('reconcile2')
  const d = docs.byId(id)!
  // manual dead link 'c' not in checkedIds stays dead
  d.root.children.push({ id: 'c', type: 'link', name: 'Manual', url: 'https://c.example/', addDate: 0, dead: true, children: [] })
  docs.reconcileDead(id, ['b'], ['a', 'b'])
  expect(d.root.children.find((c) => c.id === 'c')!.dead).toBe(true)
})

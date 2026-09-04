// chrome.bookmarks semantics probe. Runs once on page load, against whatever
// profile loaded this extension (the CDP runner always uses a throwaway
// profile). Records input, result/error and the observed tree state for every
// step, then exposes window.__SPIKE_RESULT__ / window.__SPIKE_DONE__.
/* global chrome */
'use strict'

const steps = []
const events = []

function minNode(n) {
  const out = { id: n.id, title: n.title, index: n.index }
  if (n.url !== undefined) out.url = n.url
  if (n.dateAdded !== undefined) out.dateAdded = n.dateAdded
  if (n.children) out.children = n.children.map(minNode)
  return out
}

async function snap(id) {
  const [n] = await chrome.bookmarks.getSubTree(id)
  return n ? minNode(n) : null
}

function idsOf(t) {
  return (t.children || []).map((c) => c.id + (c.url ? '' : '*') + ':' + c.title)
}

async function step(name, fn) {
  try {
    const data = await fn()
    steps.push({ name, ok: true, ...data })
  } catch (e) {
    steps.push({ name, ok: false, error: String(e && e.message ? e.message : e) })
  }
}

function listenEvents() {
  const t = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)
  chrome.bookmarks.onCreated.addListener((id, node) => events.push({ ev: 'onCreated', id, title: t(node).title, index: t(node).index }))
  chrome.bookmarks.onChanged.addListener((id, info) => events.push({ ev: 'onChanged', id, title: t(info).title, url: t(info).url }))
  chrome.bookmarks.onMoved.addListener((id, info) => events.push({ ev: 'onMoved', id, ...t(info) }))
  chrome.bookmarks.onRemoved.addListener((id, info) => {
    const i = t(info)
    events.push({ ev: 'onRemoved', id, parentId: i.parentId, index: i.index, wholeTree: !!i.node && !!i.node.children })
  })
  chrome.bookmarks.onChildrenReordered.addListener((id, info) => events.push({ ev: 'onChildrenReordered', id, ...t(info) }))
}

async function main() {
  listenEvents()

  const [tree] = await chrome.bookmarks.getTree()
  const root = minNode(tree)
  const bar = tree.children.find((c) => c.title === 'Bookmarks bar') || tree.children[0]
  const barId = bar.id

  await step('root-children', async () => ({
    rootChildren: tree.children.map((c) => ({ id: c.id, title: c.title })),
  }))

  await step('create-folder-append', async () => {
    const n = await chrome.bookmarks.create({ parentId: barId, title: 'F1' })
    return { createdId: n.id, index: n.index, dateAdded: n.dateAdded, dateNow: Date.now(), after: idsOf(await snap(barId)) }
  })
  const [tree2] = await chrome.bookmarks.getTree()
  const f1 = tree2.children.find((c) => c.id === barId).children.find((c) => c.title === 'F1')

  await step('create-link-index0', async () => {
    const n = await chrome.bookmarks.create({ parentId: barId, title: 'L1', url: 'https://example.com/1', index: 0 })
    return { createdId: n.id, index: n.index, after: idsOf(await snap(barId)) }
  })
  await step('create-link-append', async () => {
    const n = await chrome.bookmarks.create({ parentId: barId, title: 'L2', url: 'https://example.com/2' })
    return { createdId: n.id, index: n.index, after: idsOf(await snap(barId)) }
  })
  await step('create-link-append2', async () => {
    const n = await chrome.bookmarks.create({ parentId: barId, title: 'L3', url: 'https://example.com/3' })
    return { createdId: n.id, index: n.index, after: idsOf(await snap(barId)) }
  })
  await step('create-index-beyond-end', async () => {
    const n = await chrome.bookmarks.create({ parentId: f1.id, title: 'deep', url: 'https://example.com/d', index: 99 })
    return { createdId: n.id, index: n.index }
  })

  // bounds & append semantics, self-contained inside F1/G
  await step('bounds-setup', async () => {
    const g = await chrome.bookmarks.create({ parentId: f1.id, title: 'G' })
    const h = await chrome.bookmarks.create({ parentId: f1.id, title: 'H' })
    const b1 = await chrome.bookmarks.create({ parentId: g.id, title: 'b1', url: 'https://example.com/b1' })
    const b2 = await chrome.bookmarks.create({ parentId: g.id, title: 'b2', url: 'https://example.com/b2' })
    const b3 = await chrome.bookmarks.create({ parentId: g.id, title: 'b3', url: 'https://example.com/b3' })
    return { g: g.id, h: h.id, b1: b1.id, b2: b2.id, b3: b3.id }
  })
  const bounds = steps.find((s) => s.name === 'bounds-setup')
  await step('move-same-parent-index-eq-count', async () => {
    await chrome.bookmarks.move(bounds.b1, { parentId: bounds.g, index: 3 })
    return { unexpected: 'index == count accepted', after: idsOf(await snap(bounds.g)) }
  })
  await step('move-same-parent-down-request-count-1', async () => {
    await chrome.bookmarks.move(bounds.b1, { parentId: bounds.g, index: 2 })
    return { after: idsOf(await snap(bounds.g)) }
  })
  await step('move-same-parent-omit-index-appends', async () => {
    await chrome.bookmarks.move(bounds.b1, { parentId: bounds.g })
    return { after: idsOf(await snap(bounds.g)) }
  })
  await step('move-cross-parent-index0', async () => {
    await chrome.bookmarks.move(bounds.b2, { parentId: bounds.h, index: 0 })
    return { gAfter: idsOf(await snap(bounds.g)), hAfter: idsOf(await snap(bounds.h)) }
  })
  await step('move-cross-parent-index-eq-dest-count', async () => {
    await chrome.bookmarks.move(bounds.b3, { parentId: bounds.h, index: 1 })
    return { hAfter: idsOf(await snap(bounds.h)) }
  })
  await step('move-cross-parent-index-beyond', async () => {
    await chrome.bookmarks.move(bounds.b2, { parentId: bounds.h, index: 9 })
    return { unexpected: 'index 9 accepted', hAfter: idsOf(await snap(bounds.h)) }
  })
  await step('create-index-eq-count-appends', async () => {
    const hT = await snap(bounds.h)
    const n = await chrome.bookmarks.create({ parentId: bounds.h, title: 'b4', url: 'https://example.com/b4', index: hT.children.length })
    return { index: n.index, hAfter: idsOf(await snap(bounds.h)) }
  })

  // same-parent moves (index semantics). Track after each.
  const moveSnap = async (name, id, index) =>
    step(name, async () => {
      await chrome.bookmarks.move(id, { parentId: barId, index })
      return { moved: id, requestedIndex: index, after: idsOf(await snap(barId)) }
    })

  await moveSnap('move-end-to-0', (await snap(barId)).children[3].id, 0)
  await moveSnap('move-pos1-to-end', (await snap(barId)).children[1].id, 99)
  await moveSnap('move-pos0-to-2', (await snap(barId)).children[0].id, 2)
  await moveSnap('move-noop', (await snap(barId)).children[0].id, 0)

  // cross-parent
  let f2id
  await step('create-f2-with-children', async () => {
    const f2 = await chrome.bookmarks.create({ parentId: barId, title: 'F2' })
    f2id = f2.id
    const c1 = await chrome.bookmarks.create({ parentId: f2.id, title: 'c1', url: 'https://example.com/c1' })
    const c2 = await chrome.bookmarks.create({ parentId: f2.id, title: 'c2', url: 'https://example.com/c2' })
    return { f2: f2.id, c1: c1.id, c2: c2.id, after: idsOf(await snap(barId)) }
  })
  await step('move-cross-parent-into-bar-1', async () => {
    const f2 = await snap(f2id)
    const c2id = f2.children[1].id
    await chrome.bookmarks.move(c2id, { parentId: barId, index: 1 })
    return { moved: c2id, requestedIndex: 1, barAfter: idsOf(await snap(barId)), f2After: idsOf(await snap(f2id)) }
  })
  await step('move-cross-parent-into-f2-0', async () => {
    const barT = await snap(barId)
    const l1 = barT.children.find((c) => c.title === 'L1')
    if (!l1) throw new Error('L1 not found')
    await chrome.bookmarks.move(l1.id, { parentId: f2id, index: 0 })
    return { moved: l1.id, requestedIndex: 0, barAfter: idsOf(await snap(barId)), f2After: idsOf(await snap(f2id)) }
  })

  // reorder convergence: naive "move to index i" loop must reproduce desired order
  await step('reorder-convergence-reverse', async () => {
    const before = (await snap(barId)).children.map((c) => c.id)
    const desired = [...before].reverse()
    for (let i = 0; i < desired.length; i++) {
      await chrome.bookmarks.move(desired[i], { parentId: barId, index: i })
    }
    const after = (await snap(barId)).children.map((c) => c.id)
    return { desired: desired.join(','), after: after.join(','), converged: desired.join(',') === after.join(',') }
  })
  await step('reorder-convergence-rotate', async () => {
    const before = (await snap(barId)).children.map((c) => c.id)
    const desired = [...before.slice(1), before[0]]
    for (let i = 0; i < desired.length; i++) {
      await chrome.bookmarks.move(desired[i], { parentId: barId, index: i })
    }
    const after = (await snap(barId)).children.map((c) => c.id)
    return { desired: desired.join(','), after: after.join(','), converged: desired.join(',') === after.join(',') }
  })

  // update
  await step('update-rename', async () => {
    const barT = await snap(barId)
    const f1n = barT.children.find((c) => c.title === 'F1')
    await chrome.bookmarks.update(f1n.id, { title: 'F1-renamed' })
    return { id: f1n.id, after: idsOf(await snap(barId)) }
  })
  await step('update-url', async () => {
    const barT = await snap(barId)
    const l = barT.children.find((c) => !!c.url)
    await chrome.bookmarks.update(l.id, { url: 'https://example.com/updated' })
    const after = await snap(l.id)
    return { id: l.id, urlAfter: after.url, titleAfter: after.title }
  })

  // remove semantics
  await step('remove-nonempty-folder-fails', async () => {
    await chrome.bookmarks.remove(f2id)
    return { unexpected: 'remove() on non-empty folder did NOT throw' }
  })
  await step('removeTree-nonempty-folder', async () => {
    await chrome.bookmarks.removeTree(f2id)
    return { after: idsOf(await snap(barId)) }
  })
  await step('remove-leaf', async () => {
    const barT = await snap(barId)
    const l = barT.children.find((c) => !!c.url)
    await chrome.bookmarks.remove(l.id)
    return { removed: l.id, after: idsOf(await snap(barId)) }
  })

  // error case: move into own descendant
  await step('move-into-own-descendant', async () => {
    const f3 = await chrome.bookmarks.create({ parentId: barId, title: 'F3' })
    const f4 = await chrome.bookmarks.create({ parentId: f3.id, title: 'F4' })
    await chrome.bookmarks.move(f3.id, { parentId: f4.id })
    return { unexpected: 'move into own descendant did NOT throw' }
  })

  // duplicate urls allowed?
  await step('duplicate-url-create', async () => {
    const a = await chrome.bookmarks.create({ parentId: barId, title: 'dupA', url: 'https://example.com/dup' })
    const b = await chrome.bookmarks.create({ parentId: barId, title: 'dupB', url: 'https://example.com/dup' })
    return { a: a.id, b: b.id, bothAllowed: a.id !== b.id }
  })

  // final state
  await step('final-bar', async () => ({ after: idsOf(await snap(barId)) }))

  const result = {
    userAgent: navigator.userAgent,
    chromeVersion: /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null,
    root: root,
    steps,
    events,
  }
  window.__SPIKE_RESULT__ = result
  window.__SPIKE_DONE__ = true
  document.getElementById('out').textContent = JSON.stringify(result, null, 2)
  document.title = 'SPIKE DONE'
}

main().catch((e) => {
  steps.push({ name: 'FATAL', ok: false, error: String(e && e.stack ? e.stack : e) })
  window.__SPIKE_RESULT__ = { steps, events, fatal: true }
  window.__SPIKE_DONE__ = true
  document.getElementById('out').textContent = JSON.stringify(window.__SPIKE_RESULT__, null, 2)
  document.title = 'SPIKE DONE (fatal)'
})

document.getElementById('copy').addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(window.__SPIKE_RESULT__, null, 2))
})

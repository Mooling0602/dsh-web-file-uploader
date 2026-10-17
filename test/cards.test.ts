#!/usr/bin/env node
// test/cards.test.ts — browser-free UI test for the composer attachment cards.
//
// A card is the injection source, and its trash button is the only card
// action that deletes bytes on disk. The host deduplicates identical content
// onto the SAME stored path, so a re-upload's card must not offer permanent
// delete: it would remove a shared copy that other cards, other sessions and
// already-sent messages still reference. This suite drives the real upload
// flow through a stubbed transport and asserts the rendered card actions.
//
// Runs with no browser: the client core takes React through DI, and the same
// minimal React stub as settings-panel.test.ts drives the slots' render
// functions directly. A queued setState is applied at the start of the next
// pass so a store update from an awaited upload is not lost.

import { createClientCore } from '../src/core/client.ts'
import type { PluginContext } from '../src/types.ts'

const noop = () => {}
const fakeEl = {
  setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
  appendChild: noop, removeChild: noop, insertBefore: noop, remove: noop,
  addEventListener: noop, removeEventListener: noop, querySelector: () => null,
  querySelectorAll: () => [], closest: () => null, contains: () => false,
  style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  parentNode: null, firstChild: null, children: [], dataset: {},
}
const g = globalThis as { document?: unknown; MutationObserver?: unknown; requestAnimationFrame?: unknown; window?: unknown }
g.document = {
  documentElement: fakeEl, head: fakeEl, body: fakeEl,
  createElement: () => Object.assign({}, fakeEl, { style: {}, classList: fakeEl.classList }),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop, getElementById: () => null,
}
g.MutationObserver = class { observe() {} disconnect() {} }
g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0)
g.window = globalThis

// The cards copy paths through navigator.clipboard; capture the writes so the
// batch "copy all paths" contract can be asserted.
const copiedTexts: string[] = []
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    clipboard: {
      writeText: (text: string) => {
        copiedTexts.push(text)
        return Promise.resolve()
      },
    },
  },
})

const TOP = function TOP_LEVEL() {}

let slotsByComp = new Map<unknown, unknown[]>()
let effectDeps = new Map<unknown, unknown[]>()
let pendingByComp = new Map<unknown, Record<string, unknown>>()
let current: unknown = TOP
let cursor = 0

const react = {
  createElement: (type: unknown, props?: Record<string, unknown> | null, ...kids: unknown[]) => {
    if (typeof type === 'function') {
      const prevComp = current
      const prevCursor = cursor
      current = type
      cursor = 0
      try {
        return (type as (p: unknown) => unknown)(props || {})
      } finally {
        current = prevComp
        cursor = prevCursor
      }
    }
    return { type, props: props || {}, kids: kids.flat(Infinity) }
  },
  useState: <S>(init: S) => {
    const comp = current
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)!
    const i = cursor++
    if (!(i in arr)) arr[i] = typeof init === 'function' ? (init as () => S)() : init
    const set = (v: S | ((prev: S) => S)) => {
      const p = pendingByComp.get(comp) || {}
      p[i] = typeof v === 'function' ? (v as (prev: S) => S)(arr[i] as S) : v
      pendingByComp.set(comp, p)
    }
    return [arr[i] as S, set] as [S, (value: S | ((prev: S) => S)) => void]
  },
  useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const comp = current
    const i = cursor++
    if (!effectDeps.has(comp)) effectDeps.set(comp, [])
    const d = effectDeps.get(comp)!
    const prev = d[i] as unknown[] | undefined
    let run
    if (prev === undefined) run = true
    else if (deps === undefined || deps === null) run = true
    else if (deps.length === 0) run = false
    else run = prev.length !== deps.length || deps.some((v, k) => v !== prev[k])
    d[i] = deps
    if (run) fn()
  },
}

interface Captured { meta: { id: string }; render: (props?: unknown) => unknown }
const captured: Record<string, Captured> = {}
const dicts: { zh: Record<string, string>; en: Record<string, string> } = { zh: {}, en: {} }
const slots = {
  inject: (_name: string, fn: () => void) => { fn() },
  register: (meta: { id: string }, render: (props?: unknown) => unknown) => { captured[meta.id] = { meta, render }; return { dispose() {} } },
}
const locale = {
  register: (_ns: string, lang: string, dict: Record<string, string>) => { const key = lang === 'en' ? 'en' : 'zh'; for (const k of Object.keys(dict)) dicts[key][k] = dict[k] },
  bind: () => (key: string) => (dicts.zh[key] !== undefined ? dicts.zh[key] : key),
}

// --- the transport under the cards ------------------------------------------
// The host answers every upload with `dedup: true` when it reused an existing
// stored copy; the suite flips that per upload to cover both card shapes.

interface UploadReply { ok: boolean; path?: string; size?: number; dedup?: boolean; error?: string }
const uploads: string[] = []
const removes: Array<{ sessionId?: string; path: string; id?: string }> = []
const deletes: Array<{ sessionId?: string; path: string; id?: string }> = []
let reply: UploadReply = { ok: true, path: '/u/shared.txt', size: 12, dedup: false }
let maxFilesSetting = 100

const core = createClientCore({
  react,
  upload: async (args) => {
    uploads.push(args.name)
    return reply
  },
  remove: async (args) => { removes.push(args); return { ok: true } },
  delete: async (args) => { deletes.push(args); return { ok: true } },
  configGet: async () => ({ ttl: '7d', replaceOfficial: false, alwaysShowButton: true, maxFiles: maxFilesSetting }),
  insertStyles: () => {},
})
const ctx = {
  get: (name: string) => (name === 'slots' ? slots : name === 'locale' ? locale : undefined),
  effect: () => {},
  on: () => {},
}
core.apply(ctx as unknown as PluginContext)

// --- render helpers -----------------------------------------------------------

const flush = (render: () => unknown): unknown => {
  for (const [comp, updates] of pendingByComp) {
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)!
    for (const k of Object.keys(updates)) (arr as unknown as Record<string, unknown>)[k] = updates[k]
  }
  pendingByComp = new Map()
  current = TOP
  cursor = 0
  return render()
}
const draw = (render: () => unknown): unknown => {
  let tree = flush(render)
  for (let i = 0; i < 50 && pendingByComp.size > 0; i += 1) tree = flush(render)
  return tree
}

interface FakeNode { type?: unknown; props?: Record<string, unknown>; kids?: unknown[] }
const flatten = (n: unknown, acc: unknown[]): unknown[] => {
  if (n === null || n === undefined || n === false || n === true) return acc
  if (Array.isArray(n)) { n.forEach((c) => flatten(c, acc)); return acc }
  if (typeof n !== 'object') { acc.push(String(n)); return acc }
  acc.push(n)
  ;((n as FakeNode).kids || []).forEach((c) => flatten(c, acc))
  return acc
}
const all = (t: unknown): FakeNode[] => flatten(t, []).filter((n): n is FakeNode => typeof n === 'object' && n !== null)
const byClass = (t: unknown, cls: string): FakeNode[] => all(t).filter((n) => typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes(cls))
const textOf = (t: unknown): string => flatten(t, []).filter((n) => typeof n === 'string').join(' | ')

const attachSlot = captured['dfu-attach']
const cardsSlot = captured['dfu-uploads']
if (!attachSlot || !cardsSlot) {
  console.error('composer slots never registered')
  process.exit(2)
}

let pass = 0, fail = 0
const out: string[] = []
const ok = (n: string, c: unknown, x?: unknown) => {
  if (c) { pass++; out.push('PASS  ' + n) } else { fail++; out.push('FAIL  ' + n + (x !== undefined ? '  <- ' + JSON.stringify(x) : '')) }
}

const S = 'sess-cards'
const cards = (): unknown => draw(() => cardsSlot.render({ sessionId: S }))

// The picker hands the transport a File; the card only reads name/size/type.
const fileInput = (tree: unknown): FakeNode => {
  const input = all(tree).find((n) => n.props?.type === 'file')
  if (!input) {
    console.error('file input missing from the composer button')
    process.exit(2)
  }
  return input
}
const pickMany = async (files: Array<{ name: string; size: number }>): Promise<void> => {
  const input = fileInput(attachSlot.render({ sessionId: S }))
  const onChange = input.props!.onChange as (event: unknown) => void
  const before = uploads.length
  onChange({ target: { files: files.map((f) => ({ name: f.name, size: f.size, type: 'text/plain' })), value: '' } })
  // The picker awaits the config before starting uploads; wait for the transport
  // calls, then let the stubbed replies settle.
  for (let i = 0; i < 50 && uploads.length === before; i += 1) await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}
const pick = async (name: string): Promise<void> => pickMany([{ name, size: 12 }])

// ---- 1: the card that created the copy owns the permanent delete -----------
reply = { ok: true, path: '/u/shared.txt', size: 12, dedup: false }
await pick('note.txt')
let tree = cards()
const startChips = byClass(tree, 'dfu-chip')
ok('first upload renders one card', startChips.length === 1, startChips.length)
ok('the cards live in the scrollable list', byClass(tree, 'dfu-dock-list').length === 1)
ok('a single card shows no batch bar', byClass(tree, 'dfu-dock-bar').length === 0)
ok('the creating card offers the copy action', byClass(tree, 'dfu-chip-copy').length === 1)
ok('the creating card offers the trash action', byClass(tree, 'dfu-chip-delete').length === 1)
ok('the creating card keeps the remove action', byClass(tree, 'dfu-chip-remove').length === 1)
ok('the creating card carries no dedup hint', startChips[0].props!.title === undefined)
ok('the card shows the saved status', textOf(tree).includes(dicts.zh.saved), textOf(tree))

// Trash calls the host delete RPC for exactly this card's path.
;(byClass(tree, 'dfu-chip-delete')[0].props!.onClick as () => void)()
await new Promise((r) => setTimeout(r, 0))
ok('trash calls the delete RPC once', deletes.length === 1, deletes)
ok('trash sends the card path', deletes[0] && deletes[0].path === '/u/shared.txt', deletes)
ok('trash sends the session id', deletes[0] && deletes[0].sessionId === S, deletes)
ok('trash sends the stable card id', typeof deletes[0]?.id === 'string' && deletes[0]!.id!.length > 0, deletes)
tree = cards()
ok('the deleted card is dropped', byClass(tree, 'dfu-chip').length === 0)

// ---- 2: a re-upload reuses that copy, so it only un-references -------------
reply = { ok: true, path: '/u/shared.txt', size: 12, dedup: true }
await pick('note.txt')
tree = cards()
ok('re-upload renders a card', byClass(tree, 'dfu-chip').length === 1)
ok('re-upload card hides the trash action', byClass(tree, 'dfu-chip-delete').length === 0)
ok('re-upload card keeps the remove action', byClass(tree, 'dfu-chip-remove').length === 1)
ok('re-upload card keeps the copy action', byClass(tree, 'dfu-chip-copy').length === 1)
ok('re-upload card explains the shared copy',
  byClass(tree, 'dfu-chip')[0].props!.title === dicts.zh.dedupCardHint,
  byClass(tree, 'dfu-chip')[0].props!.title)
ok('the dedup hint exists in both languages',
  typeof dicts.en.dedupCardHint === 'string' && dicts.en.dedupCardHint.length > 0)
ok('no dedup hint leaks into the en card', dicts.zh.dedupCardHint !== dicts.en.dedupCardHint)

// × still works on a dedup card: it un-references the copy and drops the card.
;(byClass(tree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await new Promise((r) => setTimeout(r, 0))
ok('remove on a dedup card calls the remove RPC', removes.some((r) => r.path === '/u/shared.txt'), removes)
ok('remove sends the stable card id', removes.some((r) => r.path === '/u/shared.txt' && typeof r.id === 'string'), removes)
tree = cards()
ok('remove on a dedup card drops it', byClass(tree, 'dfu-chip').length === 0)

// ---- 2b: a repeat upload of a path already on a card merges into it --------
reply = { ok: true, path: '/u/merged.txt', size: 12, dedup: false }
await pick('merged-a.txt')
reply = { ok: true, path: '/u/merged.txt', size: 12, dedup: true }
const removesBeforeMerge = removes.length
await pick('merged-b.txt')
tree = cards()
ok('repeat upload merges into the existing card', byClass(tree, 'dfu-chip').length === 1, byClass(tree, 'dfu-chip').length)
ok('the merged card keeps the original name', textOf(tree).includes('merged-a.txt') && !textOf(tree).includes('merged-b.txt'), textOf(tree))
ok(
  'the merge releases the duplicate reference',
  removes.length === removesBeforeMerge + 1 && removes[removes.length - 1].path === '/u/merged.txt',
  removes,
)
;(byClass(tree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await new Promise((r) => setTimeout(r, 0))
tree = cards()
ok('the merged card closes like any other', byClass(tree, 'dfu-chip').length === 0)

// ---- 3: a host that does not report dedup keeps the old card shape ---------
reply = { ok: true, path: '/u/legacy.txt', size: 12 }
await pick('legacy.txt')
tree = cards()
ok('an unreported dedup flag still offers the trash action', byClass(tree, 'dfu-chip-delete').length === 1)
ok('an unreported dedup flag carries no hint', byClass(tree, 'dfu-chip')[0].props!.title === undefined)
;(byClass(tree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
tree = cards()
ok('the legacy card closes like any other card', byClass(tree, 'dfu-chip').length === 0)

// ---- 4: a failed upload never offers delete --------------------------------
reply = { ok: false, error: 'nope' }
await pick('broken.txt')
tree = cards()
ok('failed upload renders no trash action', byClass(tree, 'dfu-chip-delete').length === 0)
ok('failed upload renders no hint', byClass(tree, 'dfu-chip')[0].props!.title === undefined)
ok('failed upload keeps the remove action', byClass(tree, 'dfu-chip-remove').length === 1)
ok('every pick reached the transport', uploads.length === 6, uploads)

// ---- 5: batch controls once the dock holds more than one card --------------
reply = { ok: true, path: '/u/one.txt', size: 12, dedup: false }
await pick('one.txt')
reply = { ok: true, path: '/u/two.txt', size: 12, dedup: false }
await pick('two.txt')
tree = cards()
ok('two or more cards show the batch bar', byClass(tree, 'dfu-dock-bar').length === 1)
ok('the batch bar counts every card', textOf(tree).includes('3 个文件'), textOf(tree))

const findAction = (label: string): FakeNode | undefined =>
  byClass(cards(), 'dfu-dock-action').find((node) => textOf(node) === label)

const copyAllAction = findAction(dicts.zh.copyAllPaths)
ok('the batch bar offers copy-all', copyAllAction !== undefined)
;(copyAllAction!.props!.onClick as () => void)()
ok('copy-all copies every settled path', copiedTexts[0] === '/u/one.txt\n/u/two.txt', copiedTexts)
ok('copy-all acknowledges the copy', textOf(cards()).includes('已复制 2 条路径'), textOf(cards()))

const removeAllAction = findAction(dicts.zh.clearAllCards)
ok('the batch bar offers remove-all', removeAllAction !== undefined)
;(removeAllAction!.props!.onClick as () => void)()
tree = cards()
ok('remove-all asks before removing', textOf(tree).includes(dicts.zh.clearAllConfirm), textOf(tree))
ok('remove-all names the card count', textOf(tree).includes('3 个卡片？'), textOf(tree))
const cancelRemoveAction = findAction(dicts.zh.clearAllCancel)
ok('remove-all can be cancelled', cancelRemoveAction !== undefined)
;(cancelRemoveAction!.props!.onClick as () => void)()
tree = cards()
ok('cancel restores the batch actions', textOf(tree).includes(dicts.zh.clearAllCards), textOf(tree))

;(findAction(dicts.zh.clearAllCards)!.props!.onClick as () => void)()
;(findAction(dicts.zh.clearAllConfirm)!.props!.onClick as () => void)()
tree = cards()
ok('remove-all drops every card', byClass(tree, 'dfu-chip').length === 0, byClass(tree, 'dfu-chip').length)
ok(
  'remove-all un-references each stored path',
  ['/u/one.txt', '/u/two.txt'].every((path) => removes.some((r) => r.path === path)),
  removes,
)
ok('the batch bar disappears with the cards', tree === null, tree)

// ---- 6: delete-all permanently deletes what it can, skipping shared copies --
reply = { ok: true, path: '/u/del-me.txt', size: 12, dedup: false }
await pick('del-me.txt')
reply = { ok: true, path: '/u/shared-a.txt', size: 12, dedup: true }
await pick('shared-a.txt')
reply = { ok: false, error: 'nope' }
await pick('bad.txt')
tree = cards()
const deleteAllAction = findAction(dicts.zh.deleteAllCards)
ok('delete-all appears when a card can be deleted', deleteAllAction !== undefined)
;(deleteAllAction!.props!.onClick as () => void)()
tree = cards()
ok('delete-all asks before deleting', textOf(tree).includes(dicts.zh.deleteAllConfirm), textOf(tree))
ok('delete-all names the deletable count', textOf(tree).includes('永久删除 1 个文件？'), textOf(tree))
const cancelDeleteAction = findAction(dicts.zh.clearAllCancel)
ok('delete-all can be cancelled', cancelDeleteAction !== undefined)
;(cancelDeleteAction!.props!.onClick as () => void)()
tree = cards()
ok('cancel restores the delete action', textOf(tree).includes(dicts.zh.deleteAllCards), textOf(tree))

;(findAction(dicts.zh.deleteAllCards)!.props!.onClick as () => void)()
;(findAction(dicts.zh.deleteAllConfirm)!.props!.onClick as () => void)()
tree = cards()
ok('delete-all removes every settled card', tree === null, tree)
ok('delete-all deletes the ordinary file', deletes.some((d) => d.path === '/u/del-me.txt'), deletes)
ok('delete-all never deletes a shared copy', !deletes.some((d) => d.path === '/u/shared-a.txt'), deletes)
ok('delete-all un-references the shared card', removes.some((r) => r.path === '/u/shared-a.txt'), removes)

// A dock where every file is a shared copy has nothing safe to delete, so the
// action hides; the host also protects cross-session copies at delete time.
reply = { ok: true, path: '/u/shared-b.txt', size: 12, dedup: true }
await pick('shared-b.txt')
reply = { ok: true, path: '/u/shared-c.txt', size: 12, dedup: true }
await pick('shared-c.txt')
tree = cards()
ok('delete-all hides when every card is a shared copy', findAction(dicts.zh.deleteAllCards) === undefined)
ok('remove-all stays available for shared copies', findAction(dicts.zh.clearAllCards) !== undefined)

// ---- 7: the max-files limit trims a pick and shows a notice ---------------
// Section 6 left two shared-copy cards; clear them before counting.
;(findAction(dicts.zh.clearAllCards)!.props!.onClick as () => void)()
;(findAction(dicts.zh.clearAllConfirm)!.props!.onClick as () => void)()
tree = cards()
ok('the dock is empty before the max-files test', tree === null, tree)

maxFilesSetting = 2
const uploadsBeforeLimit = uploads.length
await pickMany([{ name: 'm1.txt', size: 1 }, { name: 'm2.txt', size: 1 }, { name: 'm3.txt', size: 1 }])
tree = cards()
ok('max-files refuses the whole over-limit pick', uploads.length === uploadsBeforeLimit, uploads.slice(uploadsBeforeLimit))
ok('max-files keeps no cards from the refused pick', byClass(tree, 'dfu-chip').length === 0, byClass(tree, 'dfu-chip').length)
ok('max-files shows the notice', textOf(tree).includes(dicts.zh.tooManyFilesTitle), textOf(tree))
ok('max-files notice names the limit', textOf(tree).includes('单次上传最多 2 个文件。'), textOf(tree))
const dismissNotice = byClass(tree, 'dfu-modal-keep')
ok('the notice has a dismiss button', dismissNotice.length === 1, dismissNotice.length)
;(dismissNotice[0].props!.onClick as () => void)()
tree = cards()
ok('dismissing clears the notice', tree === null, tree)
maxFilesSetting = 100

console.log(out.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

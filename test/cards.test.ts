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
// The settings switch "skip upload for local files" (default on). Off forces
// the upload channel even when the shell reports a real host path.
let skipLocalUploadSetting = true

// Local references: the composer asks the shell for each picked file's real
// host path. When one is available the card references it instead of uploading,
// regardless of permission mode (the DSH sandbox confines writes only). The
// stub maps file names to paths; a missing name answers null (upload as before).
interface LocalCall { sessionId?: string; cards: Array<{ id: string; name: string; mime: string; size: number; path: string }> }
const localCalls: LocalCall[] = []
let localFails = false
const hostPaths = new Map<string, string>()

// Card restore: a page reload rebuilds the client, so the composer asks the
// host for this session's live references and rebuilds a "done" card for each.
// A row whose stored copy vanished is released instead of drawn.
const pendingCalls: string[] = []
const thumbCalls: Array<{ sessionId: string; path: string }> = []
let pendingRows: Array<Record<string, unknown>> | null = null
let pendingFails = false

// Instant upload: the composer hashes a picked file locally, then asks the host
// whether those bytes are already stored. A hit references the copy and no byte
// is sent. The stub answers from `probeReply` so both branches are covered.
interface ProbeCall { sessionId?: string; id?: string; name: string; mime?: string; size?: number; sha256: string }
const probeCalls: ProbeCall[] = []
const hashCalls: string[] = []
let probeReply: UploadReply | null = null
let probeEnabled = false
let hashEnabled = false
let hashValue: string | null = 'a'.repeat(64)
// When set, hashFile parks on a promise so a suite can observe the card while
// the digest is still being computed.
let holdHash: { promise: Promise<string | null>; settle: (value: string | null) => void } | null = null

const core = createClientCore({
  react,
  upload: async (args) => {
    uploads.push(args.name)
    return reply
  },
  remove: async (args) => { removes.push(args); return { ok: true } },
  delete: async (args) => { deletes.push(args); return { ok: true } },
  localRef: async (args) => {
    localCalls.push(args)
    const card = args.cards[0]
    if (localFails) return { ok: false, results: [{ ok: false, error: 'not a file' }] }
    return { ok: true, results: [{ ok: true, name: card.name, path: card.path, size: card.size, local: true }] }
  },
  hostPathFor: (file: File) => hostPaths.get((file as unknown as { name: string }).name) ?? null,
  configGet: async () => ({ ttl: '7d', replaceOfficial: false, alwaysShowButton: true, maxFiles: maxFilesSetting, skipLocalUpload: skipLocalUploadSetting }),
  pendingList: async (sessionId: string) => {
    pendingCalls.push(sessionId)
    if (pendingFails) return null
    return pendingRows as never
  },
  thumbUrl: (sessionId: string, path: string) => {
    thumbCalls.push({ sessionId: sessionId, path: path })
    return '/dsh-web-file-uploader/thumb?session=' + sessionId + '&path=' + encodeURIComponent(path)
  },
  insertStyles: () => {},
  // Always wired: the feature gates read the current switch at call time, not at
  // core-construction time, so a suite can flip support on and off between picks.
  hashFile: async (file: File) => {
    if (!hashEnabled) return null
    hashCalls.push(file.name)
    if (holdHash !== null) return holdHash.promise
    return hashValue
  },
  probe: async (args: ProbeCall) => {
    if (!probeEnabled) return null
    probeCalls.push(args)
    return probeReply as never
  },
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
  const beforeLocal = localCalls.length
  const beforeProbe = probeCalls.length
  onChange({ target: { files: files.map((f) => ({ name: f.name, size: f.size, type: 'text/plain' })), value: '' } })
  // The picker awaits the config before starting the transport; wait for
  // whichever channel answers (upload, local reference, or the instant-upload
  // preflight), then let the stubbed replies settle.
  for (let i = 0; i < 50 && uploads.length === before && localCalls.length === beforeLocal && probeCalls.length === beforeProbe; i += 1) {
    await new Promise((r) => setTimeout(r, 0))
  }
  await settle()
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0))
}
// Closing a card is now two steps: × opens the un-reference question, and the
// dialog's confirm answer closes it. Most suites want "the card is closed", so
// this walks both steps; suites that assert on the dialog itself drive the
// buttons by hand.
const confirmUnref = async (): Promise<void> => {
  const tree = cards()
  const btn = byClass(tree, 'dfu-modal-cancel')[0]
  ;(btn.props!.onClick as () => void)()
  await settle()
}
const closeCard = async (): Promise<void> => {
  const tree = cards()
  const btn = byClass(tree, 'dfu-chip-remove')[0]
  ;(btn.props!.onClick as () => void)()
  await settle()
  if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
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

// Trash asks first: nothing is deleted until the confirmation is answered.
;(byClass(tree, 'dfu-chip-delete')[0].props!.onClick as () => void)()
await settle()
ok('trash alone deletes nothing', deletes.length === 0, deletes)
tree = cards()
ok('trash opens a confirmation dialog', byClass(tree, 'dfu-modal').length === 1)
ok('the dialog names the question', textOf(tree).includes(dicts.zh.deleteTitle), textOf(tree))
ok('the dialog names the file it will delete', textOf(tree).includes('note.txt'), textOf(tree))
ok('the dialog keeps the card visible underneath', byClass(tree, 'dfu-chip').length === 1)
ok('the confirmation owns both answers',
  all(byClass(tree, 'dfu-modal-actions')[0]).filter((n) => n.props?.type === 'button').length === 2,
  byClass(tree, 'dfu-modal-actions').length)
// Cancelling leaves both the card and the stored file alone.
;(byClass(tree, 'dfu-modal-keep')[0].props!.onClick as () => void)()
await settle()
ok('cancelling the dialog deletes nothing', deletes.length === 0, deletes)
tree = cards()
ok('cancelling closes the dialog', byClass(tree, 'dfu-modal').length === 0)
ok('cancelling keeps the card', byClass(tree, 'dfu-chip').length === 1)
// Confirming deletes the file and drops the card.
;(byClass(tree, 'dfu-chip-delete')[0].props!.onClick as () => void)()
await settle()
tree = cards()
;(byClass(tree, 'dfu-modal-cancel')[0].props!.onClick as () => void)()
await settle()
ok('confirming calls the delete RPC once', deletes.length === 1, deletes)
ok('confirming sends the card path', deletes[0] && deletes[0].path === '/u/shared.txt', deletes)
ok('confirming sends the session id', deletes[0] && deletes[0].sessionId === S, deletes)
ok('confirming sends the stable card id', typeof deletes[0]?.id === 'string' && deletes[0]!.id!.length > 0, deletes)
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
await settle()
if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
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
await settle()
if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
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
await settle()
if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
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

// ---- 8: a Desktop host path references the original file (no upload) ------
// The shell (Desktop preload) can report a picked file's real absolute path;
// the card references it instead of uploading bytes. Permission mode is not a
// gate: the DSH sandbox confines writes only, so the file stays readable.
hostPaths.set('local-note.txt', '/home/user/originals/local-note.txt')
const uploadsBeforeLocal = uploads.length
const localBefore = localCalls.length
await pick('local-note.txt')
await settle()
tree = cards()
ok('a host path registers a local reference instead of uploading', uploads.length === uploadsBeforeLocal && localCalls.length === localBefore + 1, { uploads, localCalls })
const localCall = localCalls[localCalls.length - 1]
ok('the local reference carries the absolute path', localCall.cards[0]?.path === '/home/user/originals/local-note.txt', localCall)
ok('the local reference carries the session id', localCall.sessionId === S)
ok('the local card shows the local badge', textOf(tree).includes(dicts.zh.localBadge), textOf(tree))
// The separator must stay OUTSIDE the badge: the pill's border closes around
// its children, so a separator child would be drawn inside the pill.
const localBadgeNode = byClass(tree, 'dfu-chip-local')[0]
ok('the local badge contains only its label', textOf(localBadgeNode) === dicts.zh.localBadge, textOf(localBadgeNode))
ok('the local badge keeps the separator outside', textOf(cards()).includes(dicts.zh.localBadge + ' |  · '), textOf(cards()))
ok('the local card hides the trash action', byClass(tree, 'dfu-chip-delete').length === 0)
ok('the local card keeps the remove action', byClass(tree, 'dfu-chip-remove').length === 1)
ok('the local card carries the local hint', byClass(tree, 'dfu-chip')[0].props!.title === dicts.zh.localCardHint, byClass(tree, 'dfu-chip')[0].props!.title)
ok('the local hint exists in both languages', typeof dicts.en.localCardHint === 'string' && dicts.en.localCardHint.length > 0)
ok('the local badge exists in both languages', typeof dicts.en.localBadge === 'string' && dicts.en.localBadge.length > 0)
ok('no local hint leaks into the en card', dicts.zh.localCardHint !== dicts.en.localCardHint)

// The remove action only drops the reference; the host never deletes the file.
;(byClass(tree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
await settle()
ok('removing a local card un-references it', removes.some((r) => r.path === '/home/user/originals/local-note.txt'), removes)
tree = cards()
ok('removing the local card drops it', byClass(tree, 'dfu-chip').length === 0)

// ---- 9: a file without a host path still uploads -------------------------
// A served web page has no bridge, and pasted bytes have no path; both answer
// null from hostPathFor and keep the upload transport.
const uploadsBeforeNoPath = uploads.length
const localsBeforeNoPath = localCalls.length
reply = { ok: true, path: '/u/no-path.txt', size: 12, dedup: false }
await pick('no-path.txt')
await settle()
tree = cards()
ok('a file without a host path keeps uploading', uploads.length === uploadsBeforeNoPath + 1 && localCalls.length === localsBeforeNoPath, { uploads, localCalls })
ok('the uploaded card renders no local badge', !textOf(tree).includes(dicts.zh.localBadge), textOf(tree))
ok('the uploaded card keeps the trash action', byClass(tree, 'dfu-chip-delete').length === 1)
await closeCard()

// A mixed pick decides per file: the path one references, the other uploads.
hostPaths.set('mixed-local.txt', '/home/user/originals/mixed-local.txt')
reply = { ok: true, path: '/u/mixed-upload.txt', size: 12, dedup: false }
const uploadsBeforeMixed = uploads.length
const localsBeforeMixed = localCalls.length
await pickMany([{ name: 'mixed-local.txt', size: 12 }, { name: 'mixed-upload.txt', size: 12 }])
await settle()
tree = cards()
ok('a mixed pick splits between reference and upload', uploads.length === uploadsBeforeMixed + 1 && localCalls.length === localsBeforeMixed + 1, { uploads, localCalls })
ok('the mixed pick keeps both cards', byClass(tree, 'dfu-chip').length === 2, byClass(tree, 'dfu-chip').length)
ok('only the path file is marked local', byClass(tree, 'dfu-chip-local').length === 1, byClass(tree, 'dfu-chip-local').length)
;(byClass(tree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
await settle()
;(byClass(cards(), 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
if (byClass(cards(), 'dfu-modal').length > 0) await confirmUnref()
await settle()
tree = cards()
ok('the mixed cards close', tree === null, tree)

// ---- 9b: the setting can force uploads even with a host path --------------
// "Skip upload for local files" is on by default; off must keep the upload
// channel for files that would otherwise be referenced in place.
skipLocalUploadSetting = false
hostPaths.set('forced-upload.txt', '/home/user/originals/forced-upload.txt')
reply = { ok: true, path: '/u/forced-upload.txt', size: 12, dedup: false }
const uploadsBeforeForced = uploads.length
const localsBeforeForced = localCalls.length
await pick('forced-upload.txt')
await settle()
tree = cards()
ok('skip-upload off forces the upload channel', uploads.length === uploadsBeforeForced + 1 && localCalls.length === localsBeforeForced, { uploads, localCalls })
ok('the forced-upload card is not marked local', !textOf(tree).includes(dicts.zh.localBadge), textOf(tree))
ok('the forced-upload card keeps the trash action', byClass(tree, 'dfu-chip-delete').length === 1)
await closeCard()
skipLocalUploadSetting = true

// ---- 10: a refused local reference falls back to uploading the bytes -------
hostPaths.set('fallback.txt', '/home/user/originals/fallback.txt')
localFails = true
const uploadsBeforeFallback = uploads.length
reply = { ok: true, path: '/u/fallback.txt', size: 12, dedup: false }
await pick('fallback.txt')
await settle()
tree = cards()
ok('a refused local reference falls back to upload', uploads.length === uploadsBeforeFallback + 1, uploads)
ok('the fallback card is not marked local', !textOf(tree).includes(dicts.zh.localBadge), textOf(tree))
ok('the fallback card keeps the trash action', byClass(tree, 'dfu-chip-delete').length === 1)
await closeCard()
localFails = false

// ---- 11: delete-all never deletes a local original -------------------------
hostPaths.set('local-del.txt', '/home/user/originals/local-del.txt')
await pick('local-del.txt')
await settle()
reply = { ok: true, path: '/u/normal-del.txt', size: 12, dedup: false }
await pick('normal-del.txt')
await settle()
tree = cards()
ok('the local and uploaded cards coexist', byClass(tree, 'dfu-chip').length === 2, byClass(tree, 'dfu-chip').length)
;(findAction(dicts.zh.deleteAllCards)!.props!.onClick as () => void)()
tree = cards()
ok('delete-all ignores the local reference in its count', textOf(tree).includes('永久删除 1 个文件？'), textOf(tree))
;(findAction(dicts.zh.deleteAllConfirm)!.props!.onClick as () => void)()
await settle()
tree = cards()
ok('delete-all drops both cards', tree === null, tree)
ok('delete-all deletes the uploaded file', deletes.some((d) => d.path === '/u/normal-del.txt'), deletes)
ok('delete-all never deletes a local original', !deletes.some((d) => d.path === '/home/user/originals/local-del.txt'), deletes)
ok('delete-all un-references the local card', removes.some((r) => r.path === '/home/user/originals/local-del.txt'), removes)

// ---- 12: a reload rebuilds the cards the host still holds ------------------
// The composer's cards live in client memory, so a reload drops them while the
// host keeps the references and keeps injecting them into later messages. On
// mount the composer pulls the session's live rows and redraws the cards, so
// the screen and the host agree again. A row whose stored copy vanished is
// released instead of drawn (a card that could never be read is worse).
const S_RELOAD = 'sess-reload'
pendingRows = [
  { id: 'r-txt', name: 'reloaded.txt', mime: 'text/plain', size: 34, path: '/u/reloaded.txt', dedup: false, local: false, exists: true, isImage: false },
  { id: 'r-png', name: 'reloaded.png', mime: 'image/png', size: 99, path: '/u/reloaded.png', dedup: false, local: false, exists: true, isImage: true },
  { id: 'r-gone', name: 'vanished.txt', mime: 'text/plain', size: 3, path: '/u/vanished.txt', dedup: false, local: false, exists: false, isImage: false },
]
const reloaded = (): unknown => draw(() => cardsSlot.render({ sessionId: S_RELOAD }))
// The restore is one awaited host round-trip, so the first paint is empty and
// the cards appear on the paint after it settles.
reloaded()
await settle()
let reloadTree = reloaded()
ok('a reload asks the host for this session once', pendingCalls.filter((s) => s === S_RELOAD).length === 1, pendingCalls)
ok('a reload redraws a card per live reference', byClass(reloadTree, 'dfu-chip').length === 2, byClass(reloadTree, 'dfu-chip').length)
ok('a redrawn card carries its stored path', textOf(reloadTree).includes('reloaded.txt'), textOf(reloadTree))
ok('a redrawn card shows the saved status', byClass(reloadTree, 'dfu-chip-status-ok').length === 2, byClass(reloadTree, 'dfu-chip-status-ok').length)
ok('a redrawn image card asks the host for a thumbnail', thumbCalls.some((t) => t.path === '/u/reloaded.png'), thumbCalls)
ok('a redrawn image card renders that thumbnail', (byClass(reloadTree, 'dfu-chip-thumb') as FakeNode[]).some((n) => typeof n.props?.src === 'string' && String(n.props.src).includes('reloaded.png')), all(reloadTree).map((n) => n.props?.src))
ok('a reference whose copy vanished is released, not drawn', removes.some((r) => r.path === '/u/vanished.txt' && r.id === 'r-gone'), removes)
ok('the vanished reference never becomes a card', !textOf(reloadTree).includes('vanished.txt'), textOf(reloadTree))
// Re-rendering (a keystroke, a streaming token) must not re-query or duplicate.
reloadTree = reloaded()
ok('re-rendering does not re-query the host', pendingCalls.filter((s) => s === S_RELOAD).length === 1, pendingCalls)
ok('re-rendering does not duplicate the cards', byClass(reloadTree, 'dfu-chip').length === 2, byClass(reloadTree, 'dfu-chip').length)
// A restored card is a normal finished card afterwards: × un-references it.
const restoredRemove = byClass(reloadTree, 'dfu-chip-remove')[0]
;(restoredRemove.props!.onClick as () => void)()
await settle()
// Un-referencing a restored card asks first, like any other card.
reloadTree = reloaded()
ok('a restored card asks before it is un-referenced', byClass(reloadTree, 'dfu-modal').length === 1)
;(byClass(reloadTree, 'dfu-modal-cancel')[0].props!.onClick as () => void)()
await settle()
reloadTree = reloaded()
ok('a restored card can be un-referenced', removes.some((r) => r.path === '/u/reloaded.txt' && r.id === 'r-txt'), removes)
ok('un-referencing a restored card drops it from the row', byClass(reloadTree, 'dfu-chip').length === 1, byClass(reloadTree, 'dfu-chip').length)

// An empty answer (fresh session, or a host without the feature) draws nothing.
const S_FRESH = 'sess-reload-empty'
pendingRows = []
draw(() => cardsSlot.render({ sessionId: S_FRESH }))
await settle()
const freshTree = draw(() => cardsSlot.render({ sessionId: S_FRESH }))
ok('a session with no references draws no card', freshTree === null, freshTree)
ok('an empty answer still queries the host', pendingCalls.includes(S_FRESH), pendingCalls)

// A host that cannot answer (older build, unreachable route) keeps the plain
// reload behaviour rather than breaking the composer.
const S_DOWN = 'sess-reload-down'
pendingFails = true
draw(() => cardsSlot.render({ sessionId: S_DOWN }))
await settle()
const downTree = draw(() => cardsSlot.render({ sessionId: S_DOWN }))
ok('an unreachable host leaves the card area empty', downTree === null, downTree)
pendingFails = false

// ---- 13: the delete confirmation is a localized second step ---------------
// The trash can is the only card action that destroys a stored file, so it
// asks first. Both languages must carry the question, and the safe answer is
// the one that holds focus.
for (const key of ['deleteTitle', 'deleteBody', 'deleteKeep', 'deleteConfirm']) {
  ok('the delete dialog string exists in zh: ' + key, typeof dicts.zh[key] === 'string' && dicts.zh[key].length > 0, dicts.zh[key])
  ok('the delete dialog string exists in en: ' + key, typeof dicts.en[key] === 'string' && dicts.en[key].length > 0, dicts.en[key])
}
// Backdrop click and Escape are the safe branch too: pressing outside a
// destructive question must never be read as consent.
pendingRows = [
  { id: 'r-del', name: 'del-esc.txt', mime: 'text/plain', size: 5, path: '/u/del-esc.txt', dedup: false, local: false, exists: true, isImage: false },
]
const S_ESC = 'sess-delete-escape'
draw(() => cardsSlot.render({ sessionId: S_ESC }))
await settle()
let escTree = draw(() => cardsSlot.render({ sessionId: S_ESC }))
const delBefore = deletes.length
;(byClass(escTree, 'dfu-chip-delete')[0].props!.onClick as () => void)()
await settle()
escTree = draw(() => cardsSlot.render({ sessionId: S_ESC }))
const backdrop = byClass(escTree, 'dfu-modal-backdrop')[0]
;(backdrop.props!.onClick as () => void)()
await settle()
escTree = draw(() => cardsSlot.render({ sessionId: S_ESC }))
ok('a backdrop click deletes nothing', deletes.length === delBefore, deletes.slice(delBefore))
ok('a backdrop click closes the dialog', byClass(escTree, 'dfu-modal').length === 0)
ok('a backdrop click keeps the card', byClass(escTree, 'dfu-chip').length === 1)
;(byClass(escTree, 'dfu-chip-delete')[0].props!.onClick as () => void)()
await settle()
escTree = draw(() => cardsSlot.render({ sessionId: S_ESC }))
const dialog = byClass(escTree, 'dfu-modal')[0]
;(dialog.props!.onKeyDown as (e: unknown) => void)({ key: 'Escape' })
await settle()
escTree = draw(() => cardsSlot.render({ sessionId: S_ESC }))
ok('Escape deletes nothing', deletes.length === delBefore, deletes.slice(delBefore))
ok('Escape closes the dialog', byClass(escTree, 'dfu-modal').length === 0)
ok('Escape keeps the card', byClass(escTree, 'dfu-chip').length === 1)
pendingRows = null

// ---- 14: the × confirmation is a localized second step --------------------
// Closing a card drops this session's only handle on the file, so × asks too.
// The stored file survives, which the dialog says; every "no" answer keeps the
// card. Both languages must carry the question.
for (const key of ['unrefTitle', 'unrefBody', 'unrefKeep', 'unrefConfirm']) {
  ok('the unref dialog string exists in zh: ' + key, typeof dicts.zh[key] === 'string' && dicts.zh[key].length > 0, dicts.zh[key])
  ok('the unref dialog string exists in en: ' + key, typeof dicts.en[key] === 'string' && dicts.en[key].length > 0, dicts.en[key])
}
ok('the two confirmations are distinct questions',
  dicts.zh.unrefTitle !== dicts.zh.deleteTitle && dicts.en.unrefTitle !== dicts.en.deleteTitle,
  [dicts.zh.unrefTitle, dicts.zh.deleteTitle])
pendingRows = [
  { id: 'r-u1', name: 'unref-one.txt', mime: 'text/plain', size: 5, path: '/u/unref-one.txt', dedup: false, local: false, exists: true, isImage: false },
]
const S_UNREF = 'sess-unref-confirm'
draw(() => cardsSlot.render({ sessionId: S_UNREF }))
await settle()
const unrefDraw = (): unknown => draw(() => cardsSlot.render({ sessionId: S_UNREF }))
let uTree = unrefDraw()
const removesBefore = removes.length
;(byClass(uTree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
ok('× alone un-references nothing', removes.length === removesBefore, removes.slice(removesBefore))
ok('× opens a confirmation dialog', byClass(uTree, 'dfu-modal').length === 1)
ok('the × dialog explains the file survives', textOf(uTree).includes(dicts.zh.unrefBody), textOf(uTree))
ok('the × dialog names the file', textOf(uTree).includes('unref-one.txt'), textOf(uTree))
// A backdrop click on the × dialog is also "no".
;(byClass(uTree, 'dfu-modal-backdrop')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
ok('a backdrop click on the × dialog un-references nothing', removes.length === removesBefore, removes.slice(removesBefore))
ok('a backdrop click on the × dialog keeps the card', byClass(uTree, 'dfu-chip').length === 1)
// Escape is "no" as well.
;(byClass(uTree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
;(byClass(uTree, 'dfu-modal')[0].props!.onKeyDown as (e: unknown) => void)({ key: 'Escape' })
await settle()
uTree = unrefDraw()
ok('Escape on the × dialog un-references nothing', removes.length === removesBefore, removes.slice(removesBefore))
ok('Escape on the × dialog keeps the card', byClass(uTree, 'dfu-chip').length === 1)
// Cancelling is "no" too, and only the confirm answer closes the card.
;(byClass(uTree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
;(byClass(uTree, 'dfu-modal-keep')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
ok('cancelling the × dialog keeps the card', byClass(uTree, 'dfu-chip').length === 1)
ok('cancelling the × dialog un-references nothing', removes.length === removesBefore, removes.slice(removesBefore))
;(byClass(uTree, 'dfu-chip-remove')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
;(byClass(uTree, 'dfu-modal-cancel')[0].props!.onClick as () => void)()
await settle()
uTree = unrefDraw()
ok('confirming the × dialog un-references the card', removes.some((r) => r.path === '/u/unref-one.txt'), removes.slice(removesBefore))
ok('confirming the × dialog drops the card', uTree === null, uTree)
pendingRows = null

// ---- 15: instant upload consults the hash before the transport --------------
// Picking a file hashes it locally and asks the host whether those bytes are
// already stored. A hit references the copy, so the transport never runs; a
// miss, a failure, or a host without the route all fall back to uploading.
const S_PROBE = 'sess-probe'
// A second, otherwise empty session: the "one dedup card" assertions count
// actions across the whole tree, so nothing else may live beside the card.
const S_HIT = 'sess-probe-hit'
let probeSessionId = S_PROBE
const probeSession = async (): Promise<void> => {
  draw(() => cardsSlot.render({ sessionId: probeSessionId }))
  await settle()
}
const probePick = async (name: string, size: number): Promise<void> => {
  const input = fileInput(attachSlot.render({ sessionId: probeSessionId }))
  const onChange = input.props!.onChange as (event: unknown) => void
  onChange({ target: { files: [{ name: name, size: size, type: 'text/plain' }], value: '' } })
  await settle()
  await settle()
}

// Feature off (an older host, or a caller that wires no hashing): unchanged.
probeEnabled = false
hashEnabled = false
await probeSession()
await probePick('off.txt', 10)
ok('without hashing support the file still uploads', uploads.includes('off.txt'), uploads)
ok('without hashing support no probe is sent', probeCalls.length === 0, probeCalls)

// A hit: hashed locally, probed, referenced, and never uploaded. The hit runs in
// an otherwise empty session so the tree holds only the card under test.
probeSessionId = S_HIT
await probeSession()
probeEnabled = true
hashEnabled = true
probeReply = { ok: true, path: '/u/already-stored.txt', size: 4096, dedup: true }
uploads.length = 0
probeCalls.length = 0
hashCalls.length = 0
await probePick('stored.txt', 4096)
ok('a hit hashes the file locally', hashCalls.includes('stored.txt'), hashCalls)
ok('a hit sends the hash to the host', probeCalls.some((c) => c.name === 'stored.txt' && /^[0-9a-f]{64}$/.test(c.sha256)), probeCalls)
ok('a hit never runs the transport', !uploads.includes('stored.txt'), uploads)
ok('a hit probes under the picking session', probeCalls.every((c) => c.sessionId === probeSessionId), probeCalls)
ok('a hit carries the card id', probeCalls.every((c) => typeof c.id === 'string' && c.id !== ''), probeCalls)
const hitTree = await (async () => { await probeSession(); return draw(() => cardsSlot.render({ sessionId: probeSessionId })) })()
ok('a hit still draws a card', textOf(hitTree).includes('stored.txt'), textOf(hitTree))
ok('a hit marks the card saved', byClass(hitTree, 'dfu-chip-status-ok').length >= 1, byClass(hitTree, 'dfu-chip-status-ok').length)
ok('a hit keeps a dedup card without the trash action', byClass(hitTree, 'dfu-chip-delete').length === 0, byClass(hitTree, 'dfu-chip-delete').length)

// A miss: the probe answers "not stored" and the bytes are uploaded as before.
probeReply = { ok: false, error: 'not stored' }
uploads.length = 0
probeCalls.length = 0
reply = { ok: true, path: '/u/fresh.txt', size: 20, dedup: false }
await probePick('fresh.txt', 20)
ok('a miss probes once', probeCalls.filter((c) => c.name === 'fresh.txt').length === 1, probeCalls)
ok('a miss falls back to the transport', uploads.includes('fresh.txt'), uploads)

// A broken hash (null) skips the probe entirely and uploads.
hashValue = null
probeReply = { ok: true, path: '/u/x.txt', size: 5, dedup: true }
uploads.length = 0
probeCalls.length = 0
await probePick('unhashable.txt', 5)
ok('an unhashable file skips the probe', !probeCalls.some((c) => c.name === 'unhashable.txt'), probeCalls)
ok('an unhashable file still uploads', uploads.includes('unhashable.txt'), uploads)
hashValue = 'a'.repeat(64)

// A probe that throws must not lose the pick either.
probeEnabled = false
hashEnabled = true
uploads.length = 0
probeCalls.length = 0
await probePick('noprobe.txt', 7)
ok('a host without the probe route still uploads', uploads.includes('noprobe.txt'), uploads)

// The hashing state shows while the digest is computed, before any transfer:
// hashFile parks on a promise here so the card is observable mid-digest.
probeEnabled = true
probeReply = { ok: true, path: '/u/slow-stored.txt', size: 100, dedup: true }
uploads.length = 0
probeCalls.length = 0
let releaseHash: (value: string | null) => void = () => {}
holdHash = {
  promise: new Promise<string | null>((resolve) => { releaseHash = resolve }),
  settle: (value: string | null) => releaseHash(value),
}
const hashInput = fileInput(attachSlot.render({ sessionId: S_PROBE }))
const onHashChange = hashInput.props!.onChange as (event: unknown) => void
onHashChange({ target: { files: [{ name: 'slow.txt', size: 100, type: 'text/plain' }], value: '' } })
await settle()
const midTree = draw(() => cardsSlot.render({ sessionId: S_PROBE }))
ok('the card reports hashing before it uploads', textOf(midTree).includes(dicts.zh.hashing), textOf(midTree))
ok('the hashing label is localized', typeof dicts.zh.hashing === 'string' && dicts.en.hashing.length > 0, [dicts.zh.hashing, dicts.en.hashing])
ok('nothing is sent while hashing', uploads.length === 0 && probeCalls.length === 0, [uploads, probeCalls.length])
holdHash!.settle('b'.repeat(64))
await settle()
await settle()
ok('the hash resumes the flow into the probe', probeCalls.some((c) => c.name === 'slow.txt'), probeCalls)
ok('a hash that lands as a hit still skips the transport', !uploads.includes('slow.txt'), uploads)
holdHash = null

// Closing the card while it is still hashing must not fall back to uploading:
// no transport may start for a card the user already dismissed.
probeSessionId = 'sess-probe-cancel'
await probeSession()
probeEnabled = true
hashEnabled = true
probeCalls.length = 0
uploads.length = 0
let releaseCancel: (value: string | null) => void = () => {}
holdHash = {
  promise: new Promise<string | null>((resolve) => { releaseCancel = resolve }),
  settle: (value: string | null) => releaseCancel(value),
}
const cancelInput = fileInput(attachSlot.render({ sessionId: probeSessionId }))
const onCancelChange = cancelInput.props!.onChange as (event: unknown) => void
onCancelChange({ target: { files: [{ name: 'abandoned.txt', size: 64, type: 'text/plain' }], value: '' } })
await settle()

ok('a hashing card shows the hashing state', textOf(draw(() => cardsSlot.render({ sessionId: probeSessionId }))).includes(dicts.zh.hashing), textOf(draw(() => cardsSlot.render({ sessionId: probeSessionId }))))
const hashTree = draw(() => cardsSlot.render({ sessionId: probeSessionId }))
// `closeCard` renders the shared session, so this one drives its own ×.
const hashRemove = byClass(hashTree, 'dfu-chip-remove')[0]
;(hashRemove.props!.onClick as () => void)()
await settle()
ok('closing a hashing card needs no confirm dialog', byClass(draw(() => cardsSlot.render({ sessionId: probeSessionId })), 'dfu-modal').length === 0)
holdHash!.settle('c'.repeat(64))
await settle()
await settle()
ok('a closed card never starts a transport', !uploads.includes('abandoned.txt'), uploads)
ok('a closed card never probes afterwards', !probeCalls.some((c) => c.name === 'abandoned.txt'), probeCalls)
ok('a closed card is gone from the list', !textOf(draw(() => cardsSlot.render({ sessionId: probeSessionId }))).includes('abandoned.txt'))
holdHash = null
probeEnabled = false
hashEnabled = false
hashValue = 'a'.repeat(64)

console.log(out.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

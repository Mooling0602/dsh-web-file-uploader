#!/usr/bin/env node
// test/settings-panel.test.ts — browser-free UI test for the settings
// "manage uploaded files" panel.
//
// The client core takes React through DI, so this harness supplies a minimal
// React: function components are called inline and hook state is keyed by the
// component function. The render loop applies a queued setState at the START of
// the next pass — an update can arrive from an awaited filesList() outside the
// loop, and clearing before rendering would throw it away.
//
// Why a stub instead of a real renderer: this asserts *our* contract (which
// rows lock, when the in-use notice appears, what the dictionaries contain),
// not React's behaviour, and it runs in a fraction of a second with no browser
// and no display server.

import { createClientCore } from '../src/core/client.ts'
import type { FilesListResult } from '../src/core/client.ts'
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
// The stubs only need the shape the core touches; assign them through a
// permissive view of globalThis rather than casting each one to its DOM type.
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
  useRef: (init: unknown) => {
    const comp = current
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)!
    const i = cursor++
    if (!(i in arr)) arr[i] = { current: init }
    return arr[i]
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: () => unknown) => fn,
}

interface Captured { meta: unknown; render: () => unknown }
const captured: Record<string, Captured> = {}
const dicts: { zh: Record<string, string>; en: Record<string, string> } = { zh: {}, en: {} }
const slots = {
  inject: (_name: string, fn: () => void) => { fn() },
  register: (meta: { id: string }, render: () => unknown) => { captured[meta.id] = { meta, render }; return { dispose() {} } },
}
const locale = {
  register: (_ns: string, lang: string, dict: Record<string, string>) => { for (const k of Object.keys(dict)) dicts[lang as 'zh' | 'en'][k] = dict[k] },
  bind: () => (key: string) => (dicts.zh[key] !== undefined ? dicts.zh[key] : key),
}

let listResult: FilesListResult | null = { ok: true, files: [], ttl: 604800000, now: Date.now() }
let savedConfig: Record<string, unknown> | null = null
let configResult: Record<string, unknown> = {
  ttl: '7d',
  replaceOfficial: false,
  alwaysShowButton: true,
  maxFiles: 100,
}

const core = createClientCore({
  react,
  upload: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  delete: async () => ({ ok: true }),
  configGet: async () => configResult,
  configSet: async (cfg) => {
    savedConfig = cfg as Record<string, unknown>
    return {
      ok: true,
      ttl: String(cfg.ttl ?? ''),
      replaceOfficial: cfg.replaceOfficial === true,
      alwaysShowButton: cfg.alwaysShowButton !== false,
      maxFiles: cfg.maxFiles,
    }
  },
  filesList: async () => listResult,
  deleteMany: async (args) => ({ ok: true, removed: args.paths.length, skipped: 0, failed: 0 }),
  insertStyles: () => {},
})
const ctx = {
  get: (n: string) => (n === 'slots' ? slots : (n === 'locale' ? locale : undefined)),
  effect: () => {},
  on: () => {},
}
core.apply(ctx as unknown as PluginContext)
if (!captured['dfu-settings']) { console.error('settings slot never registered'); process.exit(2) }

let pass = 0, fail = 0
const out: string[] = []
const ok = (n: string, c: unknown, x?: unknown) => { if (c) { pass++; out.push('PASS  ' + n) } else { fail++; out.push('FAIL  ' + n + (x !== undefined ? '  <- ' + JSON.stringify(x) : '')) } }

const el = captured['dfu-settings'].render as () => unknown

const pass1 = () => {
  for (const [comp, updates] of pendingByComp) {
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)!
    for (const k of Object.keys(updates)) (arr as unknown as Record<string, unknown>)[k] = updates[k]
  }
  pendingByComp = new Map()
  current = TOP
  cursor = 0
  return el()
}
const draw = () => {
  let tree = pass1()
  for (let i = 0; i < 50 && pendingByComp.size > 0; i++) tree = pass1()
  return tree
}
const mount = async () => {
  slotsByComp = new Map()
  effectDeps = new Map()
  pendingByComp = new Map()
  draw()
  await new Promise((r) => setTimeout(r, 0))
  return draw()
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
const boxIn = (node: FakeNode | undefined): FakeNode | undefined => ((node && node.kids) || []).find((k): k is FakeNode => typeof k === 'object' && k !== null && (k as FakeNode).props?.type === 'checkbox')

listResult = { ok: true, files: [], ttl: 604800000 }
let tree = await mount()
ok('empty list shows the empty state', textOf(tree).includes(dicts.zh.manageEmpty))
ok('empty list shows no in-use notice', byClass(tree, 'dfu-manage-notice').length === 0)

// ---- case 2: only selectable rows ----
listResult = { ok: true, files: [
  { hash: 'a', path: '/u/a.txt', name: 'a.txt', size: 10, at: Date.now(), exists: true, inUse: false, sessions: [], overdue: false },
  { hash: 'b', path: '/u/b.txt', name: 'b.txt', size: 20, at: Date.now(), exists: true, inUse: false, sessions: [], overdue: false },
], ttl: 604800000 }
tree = await mount()
ok('two rows render', byClass(tree, 'dfu-manage-row').length === 2, byClass(tree, 'dfu-manage-row').length)
ok('selectable-only list shows no notice', byClass(tree, 'dfu-manage-notice').length === 0)
ok('no row is locked', byClass(tree, 'dfu-manage-row-locked').length === 0)

// ---- case 3: one referenced file ----
listResult = { ok: true, files: [
  { hash: 'a', path: '/u/a.txt', name: 'a.txt', size: 10, at: Date.now(), exists: true, inUse: false, sessions: [], overdue: false },
  { hash: 'c', path: '/u/c.txt', name: 'c.txt', size: 30, at: Date.now(), exists: true, inUse: true, sessions: ['s1'], overdue: false },
], ttl: 604800000 }
tree = await mount()
ok('an in-use file raises the notice', byClass(tree, 'dfu-manage-notice').length === 1, byClass(tree, 'dfu-manage-notice').length)
const noticeText = flatten(byClass(tree, 'dfu-manage-notice')[0], []).filter((x) => typeof x === 'string').join(' ')
ok('notice names the x / trash release path', noticeText.includes('\u00d7') && noticeText.includes('\u5783\u573e\u6876'), noticeText)
ok('notice names the restart release path', noticeText.includes('\u91cd\u542f dsh web'), noticeText)
ok('referenced row is locked', byClass(tree, 'dfu-manage-row-locked').length === 1)
ok('in-use badge is shown', byClass(tree, 'dfu-manage-badge-use').length === 1)
const lockedBox = boxIn(byClass(tree, 'dfu-manage-row-locked')[0])
ok('locked checkbox is disabled', lockedBox && lockedBox.props!.disabled === true)
ok('locked checkbox tooltip is the release hint', lockedBox && lockedBox.props!.title === dicts.zh.manageInUseHint, lockedBox && lockedBox.props!.title)
ok('badge tooltip is the release hint too', byClass(tree, 'dfu-manage-badge-use')[0].props!.title === dicts.zh.manageInUseHint)

// ---- case 4: select-all skips the locked row; the delete needs confirming ----
const allBox = boxIn(byClass(tree, 'dfu-manage-all')[0])
ok('select-all checkbox exists', !!allBox)
;(allBox!.props!.onChange as () => void)()
tree = draw()
const checked = byClass(tree, 'dfu-manage-row').filter((row) => { const b = boxIn(row); return b && b.props!.checked === true }).length
ok('select-all selects only the selectable row', checked === 1, checked)
ok('selection counter reads 1', textOf(tree).includes('\u5df2\u9009 1 \u9879'), textOf(tree))
const delBtn = byClass(tree, 'dfu-manage-delete')[0]
ok('delete button is enabled with one row selected', delBtn && delBtn.props!.disabled === false)
;(delBtn.props!.onClick as () => void)()
tree = draw()
ok('confirm modal opens', byClass(tree, 'dfu-modal').length === 1)
ok('modal body names the count', textOf(tree).includes('\u5c06\u6c38\u4e45\u5220\u9664\u4ee5\u4e0b 1 \u4e2a\u6587\u4ef6'), textOf(tree))

// ---- case 5: bytes already gone ----
listResult = { ok: true, files: [
  { hash: 'd', path: '/u/d.txt', name: 'd.txt', size: 5, at: Date.now(), exists: false, inUse: false, sessions: [], overdue: false },
], ttl: 604800000 }
tree = await mount()
ok('missing-only list shows no in-use notice', byClass(tree, 'dfu-manage-notice').length === 0)
ok('missing row is locked', byClass(tree, 'dfu-manage-row-locked').length === 1)
ok('missing badge is shown', textOf(tree).includes(dicts.zh.manageMissing))

// ---- case 6: past retention but unreferenced ----
listResult = { ok: true, files: [
  { hash: 'e', path: '/u/e.txt', name: 'e.txt', size: 7, at: 1, exists: true, inUse: false, sessions: [], overdue: true },
], ttl: 604800000 }
tree = await mount()
ok('overdue badge is shown', textOf(tree).includes(dicts.zh.manageOverdue))
ok('overdue does not lock the row', byClass(tree, 'dfu-manage-row-locked').length === 0)

// ---- case 7: the list call fails ----
listResult = null
tree = await mount()
ok('a failed list shows an error', byClass(tree, 'dfu-manage-error').length === 1)

// ---- case 8: released again ----
listResult = { ok: true, files: [
  { hash: 'c', path: '/u/c.txt', name: 'c.txt', size: 30, at: Date.now(), exists: true, inUse: false, sessions: [], overdue: false },
], ttl: 604800000 }
tree = await mount()
ok('notice disappears once released', byClass(tree, 'dfu-manage-notice').length === 0)
ok('row becomes selectable again', byClass(tree, 'dfu-manage-row-locked').length === 0)

// ---- upload-entry switches ----
tree = await mount()
const switches = () => byClass(tree, 'dfu-switch')
ok('two upload-entry switches render', switches().length === 2, switches().length)
ok('replace switch is labelled for the add-file entry',
  byClass(tree, 'dfu-settings-toggle-label').some(n => textOf(n) === dicts.zh.replaceOfficial),
  byClass(tree, 'dfu-settings-toggle-label').map(textOf))
const alwaysSwitch = switches().find(s => s.props!['aria-label'] === dicts.zh.alwaysShowButton)
ok('always-show switch exists', alwaysSwitch !== undefined)
ok('always-show switch defaults on', alwaysSwitch?.props!['aria-checked'] === true, alwaysSwitch?.props!['aria-checked'])
;(alwaysSwitch!.props!.onClick as () => void)()
tree = draw()
const toggled = switches().find(s => s.props!['aria-label'] === dicts.zh.alwaysShowButton)
ok('always-show switch toggles off', toggled?.props!['aria-checked'] === false, toggled?.props!['aria-checked'])
const saveBtn = byClass(tree, 'dfu-settings-save').find(n => n.props!.className === 'dfu-settings-save')
ok('save button exists', saveBtn !== undefined)
;(saveBtn!.props!.onClick as () => void)()
await new Promise((r) => setTimeout(r, 0))
ok('save sends the always-show setting', (savedConfig as Record<string, unknown> | null)?.alwaysShowButton === false, savedConfig)
ok('save keeps the replacement setting', (savedConfig as Record<string, unknown> | null)?.replaceOfficial === false, savedConfig)

// ---- max-files stepper ----
configResult = { ttl: '7d', replaceOfficial: false, alwaysShowButton: true, maxFiles: 7 }
tree = await mount()
const stepperInput = () => byClass(tree, 'dfu-stepper-input')[0]
ok('max-files stepper renders the configured value', stepperInput()?.props!.value === '7', stepperInput()?.props!.value)
const stepperButtons = byClass(tree, 'dfu-stepper-btn')
ok('max-files stepper has two buttons', stepperButtons.length === 2, stepperButtons.length)
const plusBtn = stepperButtons.find((b) => b.props!.title === dicts.zh.increase)
ok('the plus button is labelled', plusBtn !== undefined)
;(plusBtn!.props!.onClick as () => void)()
tree = draw()
ok('plus steps by ten', stepperInput()?.props!.value === '17', stepperInput()?.props!.value)
;(stepperInput().props!.onChange as (e: unknown) => void)({ target: { value: '0' } })
tree = draw()
ok('zero renders the unlimited warning', byClass(tree, 'dfu-settings-warning').length === 1)
ok('the warning copies the dictionary line', textOf(byClass(tree, 'dfu-settings-warning')[0]) === dicts.zh.maxFilesWarning)
const saveZero = byClass(tree, 'dfu-settings-save').find((n) => n.props!.className === 'dfu-settings-save')
;(saveZero!.props!.onClick as () => void)()
await new Promise((r) => setTimeout(r, 0))
tree = draw()
ok('save sends the unlimited value', (savedConfig as Record<string, unknown> | null)?.maxFiles === 0, savedConfig)
;(stepperInput().props!.onChange as (e: unknown) => void)({ target: { value: '99999' } })
tree = draw()
ok('non-zero value clears the warning', byClass(tree, 'dfu-settings-warning').length === 0)
const saveBig = byClass(tree, 'dfu-settings-save').find((n) => n.props!.className === 'dfu-settings-save')
;(saveBig!.props!.onClick as () => void)()
await new Promise((r) => setTimeout(r, 0))
ok('save clamps an oversized value', (savedConfig as Record<string, unknown> | null)?.maxFiles === 10000, savedConfig)
configResult = { ttl: '7d', replaceOfficial: false, alwaysShowButton: true, maxFiles: 100 }

// ---- i18n contract ----
ok('zh carries manageInUseNotice', typeof dicts.zh.manageInUseNotice === 'string' && dicts.zh.manageInUseNotice.length > 0)
ok('en carries manageInUseNotice', typeof dicts.en.manageInUseNotice === 'string' && dicts.en.manageInUseNotice.length > 0)
ok('zh hint mentions restart', dicts.zh.manageInUseHint.includes('\u91cd\u542f'))
ok('en hint mentions restart', dicts.en.manageInUseHint.toLowerCase().includes('restart'))
const zhKeys = Object.keys(dicts.zh).sort(), enKeys = Object.keys(dicts.en).sort()
ok('zh and en have identical key sets', JSON.stringify(zhKeys) === JSON.stringify(enKeys), zhKeys.filter((k) => !enKeys.includes(k)).concat(enKeys.filter((k) => !zhKeys.includes(k))))
ok('en notice has no literal escape sequence', !dicts.en.manageInUseNotice.includes('\\u'))

console.log(out.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

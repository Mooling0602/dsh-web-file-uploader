#!/usr/bin/env node
// test/settings-panel.test.mjs — browser-free UI test for the settings
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

const noop = () => {}
const fakeEl = {
  setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
  appendChild: noop, removeChild: noop, insertBefore: noop, remove: noop,
  addEventListener: noop, removeEventListener: noop, querySelector: () => null,
  querySelectorAll: () => [], closest: () => null, contains: () => false,
  style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  parentNode: null, firstChild: null, children: [], dataset: {},
}
globalThis.document = {
  documentElement: fakeEl, head: fakeEl, body: fakeEl,
  createElement: () => Object.assign({}, fakeEl, { style: {}, classList: fakeEl.classList }),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop, getElementById: () => null,
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.window = globalThis

const { createClientCore } = await import('../src/core/client-core.js')

const TOP = function TOP_LEVEL() {}

let slotsByComp = new Map()
let effectDeps = new Map()
let pendingByComp = new Map()
let current = TOP
let cursor = 0

const react = {
  createElement: (type, props, ...kids) => {
    if (typeof type === 'function') {
      const prevComp = current
      const prevCursor = cursor
      current = type
      cursor = 0
      try {
        return type(props || {})
      } finally {
        current = prevComp
        cursor = prevCursor
      }
    }
    return { type, props: props || {}, kids: kids.flat(Infinity) }
  },
  useState: (init) => {
    const comp = current
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)
    const i = cursor++
    if (!(i in arr)) arr[i] = typeof init === 'function' ? init() : init
    const set = (v) => {
      const p = pendingByComp.get(comp) || {}
      p[i] = (typeof v === 'function') ? v(arr[i]) : v
      pendingByComp.set(comp, p)
    }
    return [arr[i], set]
  },
  useEffect: (fn, deps) => {
    const comp = current
    const i = cursor++
    if (!effectDeps.has(comp)) effectDeps.set(comp, [])
    const d = effectDeps.get(comp)
    const prev = d[i]
    let run
    if (prev === undefined) run = true
    else if (deps === undefined || deps === null) run = true
    else if (deps.length === 0) run = false
    else run = prev.length !== deps.length || deps.some((v, k) => v !== prev[k])
    d[i] = deps
    if (run) fn()
  },
  useRef: (init) => {
    const comp = current
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)
    const i = cursor++
    if (!(i in arr)) arr[i] = { current: init }
    return arr[i]
  },
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}

const captured = {}
const dicts = { zh: {}, en: {} }
const slots = {
  inject: (name, fn) => { fn() },
  register: (meta, render) => { captured[meta.id] = { meta, render }; return { dispose() {} } },
}
const locale = {
  register: (ns, lang, dict) => { for (const k of Object.keys(dict)) dicts[lang][k] = dict[k] },
  bind: () => (key) => (dicts.zh[key] !== undefined ? dicts.zh[key] : key),
}

let listResult = { ok: true, files: [], ttl: 604800000, now: Date.now() }

const core = createClientCore({
  react,
  upload: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  delete: async () => ({ ok: true }),
  configGet: async () => ({ ttl: '7d', replaceOfficial: false }),
  configSet: async () => ({ ok: true, ttl: '7d', replaceOfficial: false }),
  filesList: async () => listResult,
  deleteMany: async (args) => ({ ok: true, removed: args.paths.length, skipped: 0, failed: 0 }),
  insertStyles: () => {},
})
const ctx = { get: (n) => (n === 'slots' ? slots : (n === 'locale' ? locale : undefined)) }
core.apply(ctx)
if (!captured['dfu-settings']) { console.error('settings slot never registered'); process.exit(2) }

let pass = 0, fail = 0
const out = []
const ok = (n, c, x) => { if (c) { pass++; out.push('PASS  ' + n) } else { fail++; out.push('FAIL  ' + n + (x !== undefined ? '  <- ' + JSON.stringify(x) : '')) } }

const el = captured['dfu-settings'].render

const pass1 = () => {
  for (const [comp, updates] of pendingByComp) {
    if (!slotsByComp.has(comp)) slotsByComp.set(comp, [])
    const arr = slotsByComp.get(comp)
    for (const k of Object.keys(updates)) arr[k] = updates[k]
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

const flatten = (n, acc) => {
  if (n === null || n === undefined || n === false || n === true) return acc
  if (Array.isArray(n)) { n.forEach((c) => flatten(c, acc)); return acc }
  if (typeof n !== 'object') { acc.push(String(n)); return acc }
  acc.push(n)
  ;(n.kids || []).forEach((c) => flatten(c, acc))
  return acc
}
const all = (t) => flatten(t, [])
const byClass = (t, cls) => all(t).filter((n) => n && n.props && typeof n.props.className === 'string' && n.props.className.split(/\s+/).includes(cls))
const textOf = (t) => all(t).filter((n) => typeof n === 'string').join(' | ')
const boxIn = (node) => ((node && node.kids) || []).find((k) => k && k.props && k.props.type === 'checkbox')

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
ok('locked checkbox is disabled', lockedBox && lockedBox.props.disabled === true)
ok('locked checkbox tooltip is the release hint', lockedBox && lockedBox.props.title === dicts.zh.manageInUseHint, lockedBox && lockedBox.props.title)
ok('badge tooltip is the release hint too', byClass(tree, 'dfu-manage-badge-use')[0].props.title === dicts.zh.manageInUseHint)

// ---- case 4: select-all skips the locked row; the delete needs confirming ----
const allBox = boxIn(byClass(tree, 'dfu-manage-all')[0])
ok('select-all checkbox exists', !!allBox)
allBox.props.onChange()
tree = draw()
const checked = byClass(tree, 'dfu-manage-row').filter((row) => { const b = boxIn(row); return b && b.props.checked === true }).length
ok('select-all selects only the selectable row', checked === 1, checked)
ok('selection counter reads 1', textOf(tree).includes('\u5df2\u9009 1 \u9879'), textOf(tree))
const delBtn = byClass(tree, 'dfu-manage-delete')[0]
ok('delete button is enabled with one row selected', delBtn && delBtn.props.disabled === false)
delBtn.props.onClick()
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
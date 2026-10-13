#!/usr/bin/env node
// test/bundle.test.mjs — packaging smoke test for the shipped client bundle.
//
// The client half reaches the browser through a hand-rolled wrapper
// (scripts/build.mjs inlines the compiled core into the seam and wraps it in
// the web module loader's factory contract) — the one part of this plugin the
// READMEs flag as best-effort. This suite loads the SHIPPED lib/client.js
// exactly the way the web profile does and drives apply() with stub services,
// so a break in tsc → inline → wrap → load fails here instead of in a browser.
//
// It rebuilds first, so it always exercises the current sources rather than
// whatever was last committed into lib/.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'ignore' })

let pass = 0, fail = 0
const out = []
const ok = (n, c, x) => { if (c) { pass++; out.push('PASS  ' + n) } else { fail++; out.push('FAIL  ' + n + (x !== undefined ? '  <- ' + JSON.stringify(x) : '')) } }

// --- load lib/client.js through the web loader contract ----------------------

const loaded = []
globalThis.window = { __ModuleLoader__: { load: (m) => loaded.push(m) } }
// The core touches the DOM on apply (style insertion, nav mark); the guards
// there handle a missing document, but insertStyles runs before them.
globalThis.document = {
  createElement: () => ({ setAttribute() {}, set textContent(v) {} }),
  head: { appendChild() {} },
  documentElement: {},
  querySelectorAll: () => [],
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }

await import(join(root, 'lib', 'client.js'))

ok('loader called exactly once', loaded.length === 1, loaded.length)
const mod = loaded[0] || {}
ok('module id is the package name', mod.id === 'dsh-web-file-uploader', mod.id)
ok('module exposes a factory', typeof mod.factory === 'function')

const fakeReact = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (init) => [init, () => {}],
  useEffect: () => {},
}
let exported = null
try {
  exported = mod.factory((name) => (name === 'react' ? fakeReact : {}))
} catch (err) {
  ok('factory runs with the injected react', false, String((err && err.message) || err))
}
ok('factory runs with the injected react', exported !== null)
if (exported === null) {
  console.log(out.join('\n'))
  process.exit(1)
}

ok('inject lists slots and locale', Array.isArray(exported.inject) && exported.inject.join(',') === 'slots,locale', exported.inject)
ok('apply is exported', typeof exported.apply === 'function')

// --- drive apply() with stub services ----------------------------------------

const registered = {}
const slots = { inject: (n, f) => f(), register: (meta) => { registered[meta.id] = meta } }
const dicts = {}
const locale = { register: (ns, lang, dict) => { dicts[lang] = dict }, bind: () => (k) => k }
let applyError = null
try {
  exported.apply({ get: (n) => (n === 'slots' ? slots : n === 'locale' ? locale : undefined) })
} catch (err) {
  applyError = String((err && err.message) || err)
}
ok('apply runs without throwing', applyError === null, applyError)

const ids = Object.keys(registered)
ok('settings section registered', ids.includes('dfu-settings'), ids)
ok('composer attach button registered', ids.includes('dfu-attach'), ids)
ok('upload dock registered', ids.includes('dfu-uploads'), ids)
ok('zh dictionary registered', !!dicts.zh && typeof dicts.zh.attachTitle === 'string', dicts.zh && Object.keys(dicts.zh).length)
ok('en dictionary registered', !!dicts.en && typeof dicts.en.attachTitle === 'string', dicts.en && Object.keys(dicts.en).length)
ok('zh and en carry the same keys',
  !!dicts.zh && !!dicts.en && JSON.stringify(Object.keys(dicts.zh).sort()) === JSON.stringify(Object.keys(dicts.en).sort()))

console.log(out.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

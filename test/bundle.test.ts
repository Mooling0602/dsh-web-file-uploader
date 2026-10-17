#!/usr/bin/env node
// test/bundle.test.ts — packaging smoke test for the shipped client bundle.
//
// The client half reaches the browser through a hand-rolled wrapper
// (scripts/build.ts inlines the compiled core into the seam and wraps it in
// the web module loader's factory contract) — the one part of this plugin the
// READMEs flag as best-effort. This suite loads the SHIPPED lib/client.js
// exactly the way the web profile does and drives apply() with stub services,
// so a break in tsc → inline → wrap → load fails here instead of in a browser.
//
// It rebuilds first, so it always exercises the current sources rather than
// whatever was last built into lib/.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

execFileSync(process.execPath, [join(root, 'scripts', 'build.ts')], { cwd: root, stdio: 'ignore' })

let pass = 0, fail = 0
const out: string[] = []
const ok = (name: string, condition: boolean, detail?: unknown): void => {
  if (condition) { pass++; out.push('PASS  ' + name) } else { fail++; out.push('FAIL  ' + name + (detail !== undefined ? '  <- ' + JSON.stringify(detail) : '')) }
}

// --- load lib/client.js through the web loader contract ----------------------

const loaded: any[] = []
Object.assign(globalThis, {
  window: { __ModuleLoader__: { load: (m: any) => loaded.push(m) } },
  // The core touches the DOM on apply (style insertion, nav mark); the guards
  // there handle a missing document, but insertStyles runs before them.
  document: {
    createElement: () => ({ setAttribute() {}, set textContent(_value: string) {} }),
    head: { appendChild() {} },
    documentElement: {},
    querySelectorAll: () => [],
  },
  MutationObserver: class { observe() {} disconnect() {} },
})

await import(join(root, 'lib', 'client.js'))

ok('loader called exactly once', loaded.length === 1, loaded.length)
const mod: any = loaded[0] || {}
ok('module id is the package name', mod.id === 'dsh-web-file-uploader', mod.id)
ok('module exposes a factory', typeof mod.factory === 'function')

const fakeReact = {
  createElement: (type: unknown, props: unknown, ...kids: unknown[]) => ({ type, props, kids }),
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
}
let exported: any = null
try {
  exported = mod.factory((name: string) => (name === 'react' ? fakeReact : {}))
} catch (error) {
  ok('factory runs with the injected react', false, error instanceof Error ? error.message : String(error))
}
ok('factory runs with the injected react', exported !== null)
if (exported === null) {
  console.log(out.join('\n'))
  process.exit(1)
}

ok('inject lists slots and locale', Array.isArray(exported.inject) && exported.inject.join(',') === 'slots,locale', exported.inject)
ok('apply is exported', typeof exported.apply === 'function')

// --- drive apply() with stub services ----------------------------------------

const registered: Record<string, any> = {}
const slots = { inject: (_name: string, fn: () => void) => fn(), register: (meta: any) => { registered[meta.id] = meta } }
const dicts: Record<string, any> = {}
const locale = { register: (_namespace: string, lang: string, dict: any) => { dicts[lang] = dict }, bind: () => (key: string) => key }
let applyError: string | null = null
try {
  exported.apply({ get: (name: string) => (name === 'slots' ? slots : name === 'locale' ? locale : undefined) })
} catch (error) {
  applyError = error instanceof Error ? error.message : String(error)
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

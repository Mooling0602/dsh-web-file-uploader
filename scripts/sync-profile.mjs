#!/usr/bin/env node
// scripts/sync-profile.mjs — copy every shipped file into an installed profile
// package, then verify the result.
//
// The shipped lib/ is self-contained (the compiled host half imports only
// ./core/*), so a full copy of it plus the client scan target is everything
// the running plugin loads. Older profiles may still carry the pre-TypeScript
// layout (src/, scripts/ and the .js cores); those stale copies are removed,
// because an editor who patches them would see nothing change — the same
// "loads stale code" failure this script exists to prevent.
//
// Usage: node scripts/sync-profile.mjs [target-package-dir]
//   default target: ~/.dsh/profiles/web/node_modules/dsh-web-file-uploader

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(
  process.argv[2] ?? join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-web-file-uploader'),
)

/** Every file the running halves can load. */
const FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'lib/core/host.js',
  'lib/types.js',
  'client/src/client.js',
]

/** Layouts this script used to ship; removed from the target when present. */
const STALE = ['src', 'scripts']

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

if (!existsSync(target)) {
  console.error(`sync-profile: target does not exist: ${target}`)
  process.exit(1)
}

let failed = false
for (const rel of FILES) {
  const from = join(root, rel)
  const to = join(target, rel)
  if (!existsSync(from)) {
    console.error(`FAIL ${rel} (missing in this checkout)`)
    failed = true
    continue
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  const same = sha256(from) === sha256(to)
  if (!same) failed = true
  console.log(`${same ? 'ok  ' : 'FAIL'} ${rel}`)
}

// The host half pulls its core in relatively, so resolve every relative import
// inside the target and compare it with this checkout — a partial copy would
// otherwise only surface at runtime, as a missing method on the core.
for (const match of readFileSync(join(target, 'lib', 'index.js'), 'utf8').matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
  const spec = match[1]
  const installed = resolve(join(target, 'lib'), spec)
  const checkout = resolve(join(root, 'lib'), spec)
  const ok = existsSync(installed) && existsSync(checkout) && sha256(installed) === sha256(checkout)
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} lib/index.js -> ${spec}`)
}

for (const rel of STALE) {
  const stale = join(target, rel)
  if (!existsSync(stale)) continue
  rmSync(stale, { recursive: true, force: true })
  console.log(`ok   removed stale ${rel}/ (no longer shipped)`)
}

if (failed) {
  console.error('\nsync-profile: INCOMPLETE — the installed plugin would load stale code')
  process.exit(1)
}
console.log(`\nsync-profile: verified ${FILES.length} files + the seam import graph against this checkout`)

#!/usr/bin/env node
// scripts/sync-profile.mjs — copy every shipped file into an installed profile
// package, then verify the result.
//
// Why this exists: lib/index.js is a thin seam that imports ../src/core/*.js,
// so copying only lib/ leaves the installed host half calling the core revision
// it replaced — and the mistake stays invisible until runtime, where it reads
// as "core.beginStream is not a function". The static client half is immune
// (the build inlines its core), which is exactly what makes the partial copy
// look successful.
//
// Usage: node scripts/sync-profile.mjs [target-package-dir]
//   default target: ~/.dsh/profiles/web/node_modules/dsh-web-file-uploader

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(
  process.argv[2] ?? join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-web-file-uploader'),
)

/** Every file package.json#files ships that the running halves can load. */
const FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'src/core/client-core.js',
  'src/core/host-core.js',
  'src/seams/client-dynamic.template.js',
  'src/seams/client-static.template.js',
  'src/seams/host-dynamic.template.js',
  'client/src/client.js',
]

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

// The seam pulls its core in relatively: a fresh lib/index.js over a stale
// src/core is the exact failure this check exists for, so resolve every
// relative import inside the target and compare it with this checkout.
for (const match of readFileSync(join(target, 'lib', 'index.js'), 'utf8').matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
  const spec = match[1]
  const installed = resolve(join(target, 'lib'), spec)
  const checkout = resolve(join(root, 'lib'), spec)
  const ok = existsSync(installed) && existsSync(checkout) && sha256(installed) === sha256(checkout)
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} lib/index.js -> ${spec}`)
}

if (failed) {
  console.error('\nsync-profile: INCOMPLETE — the installed plugin would load stale code')
  process.exit(1)
}
console.log(`\nsync-profile: verified ${FILES.length} files + the seam import graph against this checkout`)

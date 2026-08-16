#!/usr/bin/env node
// scripts/build-dynamic.mjs — generate the self-contained dynamic plugin
// sources (and the static client source) by inlining the canonical cores into
// the seam templates.
//
// The dynamic sandbox forbids `import`/`require`, so the transport-agnostic
// cores (src/core/*.js) are inlined verbatim (with `export ` stripped) into
// the seam templates. The static host (lib/index.js) imports the cores
// normally; the static client source is generated here and then wrapped into
// lib/client.js by scripts/build-client.mjs.
//
// Outputs:
//   src/host.js               <- host-dynamic.template + host-core
//   src/client.js             <- client-dynamic.template + client-core
//   client/src/client.js      <- client-static.template + client-core

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (p) => readFileSync(join(root, p), 'utf8')
const write = (p, content) => writeFileSync(join(root, p), content)

// Inline a core: strip `export ` keywords so the factory becomes a plain
// top-level function usable inside the sandbox / module body.
const inlineCore = (coreFile) => read(coreFile).replace(/^export\s+(function|const)\s+/gm, '$1 ').trim()

const build = (templateFile, coreFile, outFile) => {
  const template = read(templateFile)
  const core = inlineCore(coreFile)
  const marker = '// __CORE__'
  if (!template.includes(marker)) throw new Error(`${templateFile}: missing ${marker} marker`)
  write(outFile, template.replace(marker, core) + '\n')
  console.log('generated', outFile)
}

build('src/seams/host-dynamic.template.js', 'src/core/host-core.js', 'src/host.js')
build('src/seams/client-dynamic.template.js', 'src/core/client-core.js', 'src/client.js')
build('src/seams/client-static.template.js', 'src/core/client-core.js', 'client/src/client.js')

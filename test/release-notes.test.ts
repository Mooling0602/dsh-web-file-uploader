#!/usr/bin/env node
// test/release-notes.test.ts — CLI contract of scripts/release-notes.ts.
//
// The release workflow turns the output of this script into the GitHub Release
// body, so the extraction rules are covered here with fixture changelogs: the
// version heading forms accepted, the section boundary, and every failure the
// release gate relies on (missing, empty, duplicated, placeholder).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'release-notes.ts')

let pass = 0
let fail = 0
const results: string[] = []
const ok = (name: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    pass++
    results.push('PASS  ' + name)
  } else {
    fail++
    results.push('FAIL  ' + name + (detail !== undefined ? '  <- ' + JSON.stringify(detail) : ''))
  }
}

const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

// Each fixture gets its own directory so `--changelog` exercises the same path
// the release workflow uses, without touching the real CHANGELOG.md.
const fixture = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dfu-changelog-'))
  const file = join(dir, 'CHANGELOG.md')
  writeFileSync(file, content)
  return file
}

// --- happy path: section content, boundary, and heading forms ----------------

const basic = fixture(`# CHANGELOG

## 1.2.3

**Features**

- Add a thing in commit \`abcdef1\`.

## 1.2.2

- Older entry.
`)

const basicRun = run(['1.2.3', '--changelog', basic])
ok('exits 0 for an existing section', basicRun.status === 0, basicRun.stderr)
ok(
  'returns the section verbatim',
  basicRun.stdout === '**Features**\n\n- Add a thing in commit `abcdef1`.\n',
  basicRun.stdout,
)
ok('stops at the next level-2 heading', !basicRun.stdout.includes('Older entry'), basicRun.stdout)

const bracketed = fixture(`# CHANGELOG

## [v1.2.3] - 2026-10-17

- Bracket and date heading.
`)
const bracketedRun = run(['1.2.3', '--changelog', bracketed])
ok('accepts a bracketed, v-prefixed, dated heading', bracketedRun.status === 0, bracketedRun.stderr)
ok('keeps the body of the dated heading', bracketedRun.stdout.trim() === '- Bracket and date heading.', bracketedRun.stdout)

const level3 = fixture(`# CHANGELOG

## 1.2.3

**Fixes**

### Settings

- Level-3 headings stay inside the notes.
`)
const level3Run = run(['1.2.3', '--changelog', level3])
ok('keeps level-3 headings inside the section', level3Run.status === 0 && level3Run.stdout.includes('### Settings'), level3Run.stdout)

// --- failure gates used by the release workflow -----------------------------

const missing = run(['9.9.9', '--changelog', basic])
ok('fails on a missing version section', missing.status === 1, missing.status)
ok('names the missing version', /no "## 9\.9\.9" section/.test(missing.stderr), missing.stderr)

const empty = fixture(`# CHANGELOG

## 1.2.3

## 1.2.2

- Older entry.
`)
const emptyRun = run(['1.2.3', '--changelog', empty])
ok('fails on an empty section', emptyRun.status === 1, emptyRun.status)
ok('says the section is empty', /empty/.test(emptyRun.stderr), emptyRun.stderr)

const placeholder = fixture(`# CHANGELOG

## 1.2.3

- Add the file in commit hash123.
`)
const placeholderRun = run(['1.2.3', '--changelog', placeholder])
ok('fails on the hash123 placeholder', placeholderRun.status === 1, placeholderRun.status)
ok('tells the author to replace the placeholder', /hash123/.test(placeholderRun.stderr), placeholderRun.stderr)

const duplicated = fixture(`# CHANGELOG

## 1.2.3

- First.

## 1.2.3

- Second.
`)
const duplicatedRun = run(['1.2.3', '--changelog', duplicated])
ok('fails on duplicated version sections', duplicatedRun.status === 1, duplicatedRun.status)

// --- CLI surface ------------------------------------------------------------

const outputDir = mkdtempSync(join(tmpdir(), 'dfu-changelog-out-'))
const outputFile = join(outputDir, 'release-notes.md')
const written = run(['1.2.3', '--changelog', basic, '--output', outputFile])
ok('writes --output with a trailing newline', written.status === 0 && readFileSync(outputFile, 'utf8') === '**Features**\n\n- Add a thing in commit `abcdef1`.\n', written.stderr)
ok('keeps stdout empty when writing a file', written.stdout === '', written.stdout)

const noVersion = run(['--changelog', basic])
ok('fails without a version argument', noVersion.status === 1 && /usage:/.test(noVersion.stderr), noVersion.stderr)

const missingFile = run(['1.2.3', '--changelog', join(tmpdir(), 'dfu-does-not-exist', 'CHANGELOG.md')])
ok('fails when the changelog file is missing', missingFile.status === 1 && /cannot read/.test(missingFile.stderr), missingFile.stderr)

const unknownOption = run(['1.2.3', '--changelog', basic, '--wat'])
ok('fails on an unknown option', unknownOption.status === 1 && /unknown option/.test(unknownOption.stderr), unknownOption.stderr)

const help = run(['--help'])
ok('prints usage for --help', help.status === 0 && /usage:/.test(help.stdout), help.stdout)

console.log(results.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

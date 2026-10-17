#!/usr/bin/env node
// scripts/release-notes.mjs — extract one version's section from CHANGELOG.md.
//
// The release workflow copies the extracted section verbatim into the GitHub
// Release body, so this script is the single gate that keeps a release tag and
// its changelog entry in sync. It fails when the section for the tag's version
// is missing, empty, duplicated, or still contains the template's `hash123`
// placeholder.
//
// Usage:
//   node scripts/release-notes.mjs <version>                    # stdout
//   node scripts/release-notes.mjs <version> --output <file>    # write file
//   node scripts/release-notes.mjs <version> --changelog <file> # other source
//
// The section starts at a level-2 heading whose text is the version (optionally
// bracketed, v-prefixed, and followed by a date, e.g. `## [1.2.3] - 2026-01-01`)
// and ends at the next level-1 or level-2 heading. Level-3+ headings inside the
// section are kept as notes content.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultChangelog = join(root, 'CHANGELOG.md')

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Extract and validate the notes for `version` from a CHANGELOG body. */
const extractReleaseNotes = (changelog, version) => {
  const heading = new RegExp(`^##\\s+\\[?v?${escapeRegex(version)}\\]?(?:\\s+.*)?$`)
  const lines = changelog.split(/\r?\n/)
  const starts = []
  lines.forEach((line, index) => {
    if (heading.test(line.trim())) starts.push(index)
  })

  if (starts.length === 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`)
  if (starts.length > 1) throw new Error(`CHANGELOG.md has ${starts.length} "## ${version}" sections; keep exactly one`)

  const body = []
  for (const line of lines.slice(starts[0] + 1)) {
    if (/^#{1,2}\s/.test(line.trim())) break
    body.push(line)
  }

  const notes = body.join('\n').trim()
  if (!notes) throw new Error(`the "## ${version}" section in CHANGELOG.md is empty`)
  if (/hash123/i.test(notes)) {
    throw new Error(
      `the "## ${version}" section in CHANGELOG.md still contains the ` +
        '`hash123` placeholder; replace it with the real commit short hash',
    )
  }
  return notes
}

const usage = 'usage: node scripts/release-notes.mjs <version> [--output <file>] [--changelog <file>]'

const main = () => {
  const args = process.argv.slice(2)
  let version = null
  let output = null
  let changelogFile = defaultChangelog

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--output' || arg === '-o') {
      output = args[++index]
      if (!output) throw new Error('--output needs a file path')
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length)
    } else if (arg === '--changelog' || arg === '-c') {
      changelogFile = args[++index]
      if (!changelogFile) throw new Error('--changelog needs a file path')
    } else if (arg.startsWith('--changelog=')) {
      changelogFile = arg.slice('--changelog='.length)
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage + '\n')
      return
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`)
    } else if (version) {
      throw new Error(`unexpected extra argument: ${arg}`)
    } else {
      version = arg
    }
  }

  if (!version) throw new Error(usage)

  let changelog
  try {
    changelog = readFileSync(changelogFile, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${changelogFile}: ${error.message}`)
  }
  const notes = extractReleaseNotes(changelog, version)

  if (output) {
    writeFileSync(output, notes + '\n')
    console.error(`release-notes: wrote ${output} from ${changelogFile} (${notes.split('\n').length} lines)`)
  } else {
    process.stdout.write(notes + '\n')
  }
}

try {
  main()
} catch (error) {
  console.error(`release-notes: ${error.message}`)
  process.exit(1)
}

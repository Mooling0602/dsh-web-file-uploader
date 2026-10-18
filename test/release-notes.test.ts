#!/usr/bin/env node
// test/release-notes.test.ts — CLI contract of scripts/release-notes.ts.
//
// The release workflow turns the output of this script into the GitHub Release
// body, so the composition rules are covered here with fixture changelogs: the
// global Header and Endfix wrappers (titles stripped, the Full Changelog link
// generated), the version heading forms accepted, the section boundary, and
// every failure the release gate relies on.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'release-notes.ts')

const REPO = 'https://github.com/example/repo'
const HEADER = `_**Copy the attached plugin package link and paste to dsh to install or update.**_

_**复制插件包链接到 dsh 中即可更新或安装。**_`
const ENDFIX = '**full_changelog!**'

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

const changelog = (versions: string, header: string | null = HEADER, endfix: string | null = ENDFIX): string => {
  const sections = ['# CHANGELOG', '', 'Changelog intro.']
  if (header !== null) sections.push('', '## Header', '', header)
  if (endfix !== null) sections.push('', '## Endfix', '', endfix)
  return sections.join('\n') + '\n\n' + versions
}

const VERSIONS = `## 1.2.3

### Features

- Add a thing in commit \`abcdef1\`.

## 1.2.2

- Older entry.
`

// Each fixture gets its own directory so `--changelog` exercises the same path
// the release workflow uses, without touching the real CHANGELOG.md.
const fixture = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dfu-changelog-'))
  const file = join(dir, 'CHANGELOG.md')
  writeFileSync(file, content)
  return file
}

const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

const compareLink = (previous: string, tag: string): string => `**Full Changelog**: ${REPO}/compare/${previous}...${tag}`

// Every happy-path invocation pins the repo and previous tag so the suite is
// hermetic; the tag defaults to the bare version.
const notesArgs = (file: string): string[] => ['--changelog', file, '--repo', REPO, '--previous', '1.2.2']

// --- composition: header first, version section, generated Full Changelog ----

const basic = fixture(changelog(VERSIONS))
const basicRun = run(['1.2.3', ...notesArgs(basic)])
ok('exits 0 for an existing section', basicRun.status === 0, basicRun.stderr)
ok('puts the Header content first', basicRun.stdout.startsWith(HEADER + '\n\n'), basicRun.stdout.slice(0, 60))
ok('omits the Header title', !basicRun.stdout.includes('## Header'), basicRun.stdout)
ok('keeps the version section body', basicRun.stdout.includes('### Features') && basicRun.stdout.includes('Add a thing in commit `abcdef1`.'), basicRun.stdout)
ok('omits the Endfix title', !basicRun.stdout.includes('## Endfix'), basicRun.stdout)
ok('ends with the generated Full Changelog link', basicRun.stdout.trimEnd().endsWith(compareLink('1.2.2', '1.2.3')), basicRun.stdout)
ok('leaves no placeholder behind', !basicRun.stdout.includes('full_changelog!'), basicRun.stdout)
{
  const at = (text: string) => basicRun.stdout.indexOf(text)
  ok('orders header, section and link', at(HEADER) === 0 && at('### Features') > 0 && at('**Full Changelog**') > at('### Features'), [at(HEADER), at('### Features'), at('**Full Changelog**')])
}

// --- tag and heading forms ---------------------------------------------------

const overrideTag = run(['1.2.3', '--tag', 'v9.9.9', ...notesArgs(basic)])
ok('uses --tag in the compare link', overrideTag.status === 0 && overrideTag.stdout.trimEnd().endsWith(compareLink('1.2.2', 'v9.9.9')), overrideTag.stdout)

const bracketed = fixture(changelog(`## [v1.2.3] - 2026-10-17

- Bracket and date heading.
`))
const bracketedRun = run(['1.2.3', ...notesArgs(bracketed)])
ok('accepts a bracketed, v-prefixed, dated heading', bracketedRun.status === 0 && bracketedRun.stdout.includes('- Bracket and date heading.'), bracketedRun.stderr)

const level3 = fixture(changelog(`## 1.2.3

### Fixes

#### Settings

- Level-4 headings stay inside the notes.
`))
const level3Run = run(['1.2.3', ...notesArgs(level3)])
ok('keeps deeper headings inside the section', level3Run.status === 0 && level3Run.stdout.includes('#### Settings'), level3Run.stdout)

// --- soft-wrap reflow -------------------------------------------------------
//
// GitHub renders a single newline in a release body as a hard line break, so a
// changelog kept wrapped at ~80 columns must be joined before publishing; block
// structure (blank lines, headings, alert markers, explicit breaks) must survive.

const wrapped = fixture(changelog(`## 1.2.3

### Features

- Add a thing that is described across
  two wrapped source lines and keeps
  going, in commit \`abcdef1\`.

- A second item wrapped across
  lines too.
`))
const wrappedRun = run(['1.2.3', ...notesArgs(wrapped)])
ok('joins a soft-wrapped list item into one line', wrappedRun.stdout.includes('- Add a thing that is described across two wrapped source lines and keeps going, in commit `abcdef1`.'), wrappedRun.stdout)
ok('joins every soft-wrapped list item', wrappedRun.stdout.includes('- A second item wrapped across lines too.'), wrappedRun.stdout)
ok('keeps block structure around joined lines', wrappedRun.stdout.includes('### Features\n\n- ') && wrappedRun.stdout.includes('\n\n- A second item'), wrappedRun.stdout)

const wrappedHeader = fixture(changelog(`## 1.2.3

- Entry.
`, `> [!NOTE]
> Copy the attached plugin package link and paste it into
> dsh's "Add plugin" input field.
>
> 复制插件包链接并粘贴到 dsh 的“添加插件”输入框中。`))
const wrappedHeaderRun = run(['1.2.3', ...notesArgs(wrappedHeader)])
ok('joins wrapped blockquote paragraphs', wrappedHeaderRun.stdout.includes('> Copy the attached plugin package link and paste it into dsh\'s "Add plugin" input field.'), wrappedHeaderRun.stdout)
ok('keeps the alert marker on its own line', wrappedHeaderRun.stdout.includes('> [!NOTE]\n'), wrappedHeaderRun.stdout)
ok('keeps the quoted paragraph separator', wrappedHeaderRun.stdout.includes('input field.\n>\n> 复制'), wrappedHeaderRun.stdout)

const hardBreak = fixture(changelog('## 1.2.3\n\n- First line ends with a hard break.  \n  Second line stays on its own line.\n'))
const hardBreakRun = run(['1.2.3', ...notesArgs(hardBreak)])
ok('preserves explicit hard breaks', hardBreakRun.stdout.includes('- First line ends with a hard break.  \n  Second line stays on its own line.'), hardBreakRun.stdout)

// --- failure gates used by the release workflow -----------------------------

const missing = run(['9.9.9', ...notesArgs(basic)])
ok('fails on a missing version section', missing.status === 1, missing.status)
ok('names the missing version', /no "## 9\.9\.9" section/.test(missing.stderr), missing.stderr)

const empty = fixture(changelog(`## 1.2.3

## 1.2.2

- Older entry.
`))
const emptyRun = run(['1.2.3', ...notesArgs(empty)])
ok('fails on an empty section', emptyRun.status === 1, emptyRun.status)
ok('says the section is empty', /empty/.test(emptyRun.stderr), emptyRun.stderr)

const placeholder = fixture(changelog(`## 1.2.3

- Add the file in commit hash123.
`))
const placeholderRun = run(['1.2.3', ...notesArgs(placeholder)])
ok('fails on the hash123 placeholder', placeholderRun.status === 1, placeholderRun.status)
ok('tells the author to replace the placeholder', /hash123/.test(placeholderRun.stderr), placeholderRun.stderr)

const duplicated = fixture(changelog(`## 1.2.3

- First.

## 1.2.3

- Second.
`))
const duplicatedRun = run(['1.2.3', ...notesArgs(duplicated)])
ok('fails on duplicated version sections', duplicatedRun.status === 1 && /keep exactly one/.test(duplicatedRun.stderr), duplicatedRun.stderr)

const noHeader = fixture(changelog(VERSIONS, null))
const noHeaderRun = run(['1.2.3', ...notesArgs(noHeader)])
ok('fails without a Header section', noHeaderRun.status === 1 && /no "## Header" section/.test(noHeaderRun.stderr), noHeaderRun.stderr)

const emptyHeader = fixture(changelog(VERSIONS, ''))
const emptyHeaderRun = run(['1.2.3', ...notesArgs(emptyHeader)])
ok('fails on an empty Header section', emptyHeaderRun.status === 1 && /"## Header" section in CHANGELOG.md is empty/.test(emptyHeaderRun.stderr), emptyHeaderRun.stderr)

const noEndfix = fixture(changelog(VERSIONS, HEADER, null))
const noEndfixRun = run(['1.2.3', ...notesArgs(noEndfix)])
ok('fails without an Endfix section', noEndfixRun.status === 1 && /no "## Endfix" section/.test(noEndfixRun.stderr), noEndfixRun.stderr)

const bareEndfix = fixture(changelog(VERSIONS, HEADER, 'Nothing to link.'))
const bareEndfixRun = run(['1.2.3', ...notesArgs(bareEndfix)])
ok('fails when Endfix carries no placeholder', bareEndfixRun.status === 1 && /must contain \*\*full_changelog!\*\*/.test(bareEndfixRun.stderr), bareEndfixRun.stderr)

const duplicatedHeader = fixture(`# CHANGELOG\n\n## Header\n\n${HEADER}\n\n## Header\n\n${HEADER}\n\n## Endfix\n\n${ENDFIX}\n\n${VERSIONS}`)
const duplicatedHeaderRun = run(['1.2.3', ...notesArgs(duplicatedHeader)])
ok('fails on duplicated Header sections', duplicatedHeaderRun.status === 1 && /keep exactly one/.test(duplicatedHeaderRun.stderr), duplicatedHeaderRun.stderr)

// --- CLI surface ------------------------------------------------------------

const outputDir = mkdtempSync(join(tmpdir(), 'dfu-changelog-out-'))
const outputFile = join(outputDir, 'release-notes.md')
const written = run(['1.2.3', '--changelog', basic, '--output', outputFile, '--repo', REPO, '--previous', '1.2.2'])
ok('writes --output with a trailing newline', written.status === 0
  && readFileSync(outputFile, 'utf8') === `${HEADER}\n\n### Features\n\n- Add a thing in commit \`abcdef1\`.\n\n${compareLink('1.2.2', '1.2.3')}\n`,
  written.stderr)
ok('keeps stdout empty when writing a file', written.stdout === '', written.stdout)

const noVersion = run(['--changelog', basic])
ok('fails without a version argument', noVersion.status === 1 && /usage: node scripts\/release-notes\.ts/.test(noVersion.stderr), noVersion.stderr)

const missingFile = run(['1.2.3', '--changelog', join(tmpdir(), 'dfu-does-not-exist', 'CHANGELOG.md')])
ok('fails when the changelog file is missing', missingFile.status === 1 && /cannot read/.test(missingFile.stderr), missingFile.stderr)

const unknownOption = run(['1.2.3', '--changelog', basic, '--wat'])
ok('fails on an unknown option', unknownOption.status === 1 && /unknown option/.test(unknownOption.stderr), unknownOption.stderr)

const missingTagValue = run(['1.2.3', '--changelog', basic, '--tag'])
ok('fails when --tag has no value', missingTagValue.status === 1 && /--tag needs a tag name/.test(missingTagValue.stderr), missingTagValue.stderr)

const extraArgument = run(['1.2.3', '2.0.0', ...notesArgs(basic)])
ok('fails on an extra argument', extraArgument.status === 1 && /unexpected extra argument/.test(extraArgument.stderr), extraArgument.stderr)

const help = run(['--help'])
ok('prints usage for --help', help.status === 0 && /usage: node scripts\/release-notes\.ts/.test(help.stdout), help.stdout)

console.log(results.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

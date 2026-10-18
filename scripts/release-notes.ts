#!/usr/bin/env node
// scripts/release-notes.ts — compose one version's GitHub Release body from
// CHANGELOG.md.
//
// The release workflow publishes the composed text verbatim, so this script is
// the single gate that keeps a release tag and its changelog entry in sync. The
// body is, in order: the global `## Header` content, the version's
// `## <version>` section, and the global `## Endfix` content. The `Header` and
// `Endfix` titles themselves are not part of the body.
//
// `**full_changelog!**` is a placeholder inside the Endfix section. It is
// replaced with a `**Full Changelog**` compare link covering the previous
// release tag and the tag being released. The CI script computes that link
// instead of a maintainer copying one into the changelog.
//
// GitHub renders every single newline in a release body as a hard line break,
// so publishing the wrapped `CHANGELOG.md` text verbatim would turn each
// ~80-column source line into its own short line: the notes would render as a
// narrow column with the rest of the page empty on wide screens. The composer
// therefore joins the soft-wrapped lines of each paragraph, list item and
// blockquote paragraph back into one line; blank lines, headings, fenced code,
// tables and explicit hard breaks are kept as they are, so the changelog itself
// stays wrapped for readability.
//
// It fails when the version section is missing, empty, duplicated, or still
// contains the template's `hash123` placeholder, when `Header` or `Endfix` is
// missing or empty, or when the Endfix placeholder is absent.
//
// Usage:
//   node scripts/release-notes.ts <version> [--tag <tag>] [--previous <tag>]
//                                [--repo <url>] [--output <file>]
//                                [--changelog <file>]
//
// `--tag` defaults to the bare version, `--previous` to the nearest tag before
// the release, and `--repo` to package.json#repository.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultChangelog = join(root, 'CHANGELOG.md')

const FULL_CHANGELOG_TAG = '**full_changelog!**'
const usage = 'usage: node scripts/release-notes.ts <version> [--tag <tag>] [--previous <tag>] [--repo <url>] [--output <file>] [--changelog <file>]'

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface ChangelogSection {
  readonly heading: string
  readonly body: string
}

/** Split a Markdown document into its level-2 sections (`## <heading>`). */
const splitSections = (markdown: string): ChangelogSection[] => {
  const sections: { heading: string; lines: string[] }[] = []
  let current: { heading: string; lines: string[] } | undefined
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(\S.*)$/.exec(line.trim())
    if (heading) {
      current = { heading: (heading[1] as string).trim(), lines: [] }
      sections.push(current)
      continue
    }
    current?.lines.push(line)
  }
  return sections.map(({ heading, lines }) => ({ heading, body: lines.join('\n').trim() }))
}

/** The single section whose heading matches `match`; anything else is a bug in the changelog. */
const uniqueSection = (sections: ChangelogSection[], match: (heading: string) => boolean, description: string): string => {
  const found = sections.filter(section => match(section.heading))
  if (found.length === 0) throw new Error(`CHANGELOG.md has no ${description} section`)
  if (found.length > 1) throw new Error(`CHANGELOG.md has ${found.length} ${description} sections; keep exactly one`)
  return (found[0] as ChangelogSection).body
}

/** Extract and validate the notes body of `version`. */
const extractVersionSection = (sections: ChangelogSection[], version: string): string => {
  const heading = new RegExp(`^\\[?v?${escapeRegex(version)}\\]?(?:\\s+.*)?$`)
  const body = uniqueSection(sections, candidate => heading.test(candidate), `"## ${version}"`)
  if (!body) throw new Error(`the "## ${version}" section in CHANGELOG.md is empty`)
  if (/hash123/i.test(body)) {
    throw new Error(
      `the "## ${version}" section in CHANGELOG.md still contains the ` +
        '`hash123` placeholder; replace it with the real commit short hash',
    )
  }
  return body
}

/** The compare URL's base: package.json#repository without the git+ protocol or .git suffix. */
const repositoryUrl = (): string => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    repository?: string | { url?: string }
  }
  const declared = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  if (!declared) throw new Error('package.json has no repository URL; pass --repo <url>')
  return declared.replace(/^git\+/, '').replace(/#.*$/, '').replace(/\.git$/, '').replace(/\/+$/, '')
}

const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

const tagExists = (tag: string): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * The release tag before `tag`: the nearest tag reachable from the tag itself
 * (CI), or from HEAD when the local tag has not been created yet (preview).
 */
const previousReleaseTag = (tag: string): string => {
  const describe = (reference: string): string => git(['describe', '--tags', '--abbrev=0', reference])
  try {
    if (tagExists(tag)) return describe(`${tag}^`)
    const nearest = describe('HEAD')
    return nearest === tag ? describe('HEAD^') : nearest
  } catch {
    throw new Error(`cannot determine the release before ${tag}; pass --previous <tag>`)
  }
}

/** GitHub alert markers (`> [!NOTE]`) must stay on their own line. */
const ALERT_MARKER_RE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/

/** A line that starts a new Markdown block and must not be joined to the previous line. */
const BLOCK_START_RE = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|<|---\s*$)/

/** Whether `line` continues the paragraph or list item that ended on `previous`. */
const joinsPrevious = (line: string, previous: string): boolean => {
  if (BLOCK_START_RE.test(line)) return false
  // A four-space indent is an indented code block, not a soft-wrapped line.
  if (/^(?: {4,}|\t)/.test(line)) return false
  // An explicit hard break (two trailing spaces or a trailing backslash) means
  // the author wants the line break, so the next line starts a new line.
  if (/(?: {2,}|\\)$/.test(previous)) return false
  return true
}

/**
 * Join the soft-wrapped lines of one Markdown document, so the GitHub Release
 * body reflows to the page width instead of publishing every source line as a
 * hard break. Block structure is preserved: blank lines, headings, list
 * markers, fenced code, tables and blockquotes keep their own lines.
 */
const unwrapSoftWraps = (markdown: string): string => {
  const lines = markdown.split('\n')
  const out: string[] = []
  let buffer: string | null = null
  const flush = (): void => {
    if (buffer !== null) {
      out.push(buffer)
      buffer = null
    }
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index] as string
    const previous = index > 0 ? (lines[index - 1] as string) : ''
    if (line.trim() === '') {
      flush()
      out.push('')
      index++
      continue
    }
    if (/^(?:```|~~~)/.test(line)) {
      // A fenced code block is copied verbatim through its closing fence.
      flush()
      const fence = line.trimStart().slice(0, 3)
      out.push(line)
      index++
      while (index < lines.length) {
        const code = lines[index] as string
        out.push(code)
        index++
        if (code.trimStart().startsWith(fence)) break
      }
      continue
    }
    if (/^>/.test(line)) {
      // Quote the inner text, reflow it recursively, then restore the marker.
      flush()
      const quoted: string[] = []
      while (index < lines.length && /^>/.test(lines[index] as string)) {
        quoted.push((lines[index] as string).replace(/^>\s?/, ''))
        index++
      }
      let marker: string | null = null
      if (quoted.length > 0 && ALERT_MARKER_RE.test((quoted[0] as string).trim())) {
        marker = quoted.shift() as string
      }
      const inner = unwrapSoftWraps(quoted.join('\n')).split('\n')
      if (marker !== null) out.push(`> ${marker}`)
      for (const innerLine of inner) {
        out.push(innerLine === '' ? '>' : `> ${innerLine}`)
      }
      continue
    }
    if (buffer === null) {
      buffer = line
    } else if (joinsPrevious(line, previous)) {
      buffer = `${buffer} ${line.trim()}`
    } else {
      flush()
      buffer = line
    }
    index++
  }
  flush()
  return out.join('\n').trim()
}

/** Replace the Endfix placeholder with the generated Full Changelog link. */
const withFullChangelog = (endfix: string, repo: string, previous: string, tag: string): string => {
  if (!endfix.includes(FULL_CHANGELOG_TAG)) {
    throw new Error(`the "## Endfix" section in CHANGELOG.md must contain ${FULL_CHANGELOG_TAG}`)
  }
  return endfix.replace(FULL_CHANGELOG_TAG, `**Full Changelog**: ${repo}/compare/${previous}...${tag}`)
}

const main = (): void => {
  const args = process.argv.slice(2)
  let version: string | null = null
  let tag: string | null = null
  let previous: string | null = null
  let repo: string | null = null
  let output: string | null = null
  let changelogFile = defaultChangelog

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string
    if (arg === '--output' || arg === '-o') {
      output = args[++index] ?? null
      if (!output) throw new Error('--output needs a file path')
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length)
    } else if (arg === '--tag') {
      tag = args[++index] ?? null
      if (!tag) throw new Error('--tag needs a tag name')
    } else if (arg.startsWith('--tag=')) {
      tag = arg.slice('--tag='.length)
    } else if (arg === '--previous') {
      previous = args[++index] ?? null
      if (!previous) throw new Error('--previous needs a tag name')
    } else if (arg.startsWith('--previous=')) {
      previous = arg.slice('--previous='.length)
    } else if (arg === '--repo') {
      repo = args[++index] ?? null
      if (!repo) throw new Error('--repo needs a URL')
    } else if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length)
    } else if (arg === '--changelog' || arg === '-c') {
      changelogFile = args[++index] ?? ''
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

  let changelog = ''
  try {
    changelog = readFileSync(changelogFile, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${changelogFile}: ${errorMessage(error)}`)
  }

  const sections = splitSections(changelog)
  const header = uniqueSection(sections, heading => heading === 'Header', '"## Header"')
  const notes = extractVersionSection(sections, version)
  const endfix = uniqueSection(sections, heading => heading === 'Endfix', '"## Endfix"')
  if (!header) throw new Error('the "## Header" section in CHANGELOG.md is empty')
  if (!endfix) throw new Error('the "## Endfix" section in CHANGELOG.md is empty')

  const releaseTag = tag ?? version
  const releaseRepo = repo ?? repositoryUrl()
  const previousTag = previous ?? previousReleaseTag(releaseTag)
  const body = `${unwrapSoftWraps(header)}\n\n${unwrapSoftWraps(notes)}\n\n${withFullChangelog(unwrapSoftWraps(endfix), releaseRepo, previousTag, releaseTag)}\n`

  if (output) {
    writeFileSync(output, body)
    console.error(`release-notes: wrote ${output} from ${changelogFile} (${body.split('\n').length} lines)`)
  } else {
    process.stdout.write(body)
  }
}

try {
  main()
} catch (error) {
  console.error(`release-notes: ${errorMessage(error)}`)
  process.exit(1)
}

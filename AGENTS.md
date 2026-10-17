# AGENTS.md

Guidelines for AI agents and contributors working on this repository.

## Language conventions

This project has a strict language split. Follow it for every change:

### English-only content

The following are always written in **English**:

- **Commit messages** — use [Conventional Commits](https://www.conventionalcommits.org/)
  format, e.g. `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Keep the
  summary line imperative and under ~72 characters.
- **Code comments and docstrings** — all comments in `src/core/*`,
  `src/index.ts`, `src/client-static.ts`, `scripts/*` are English. Comments on
  the "generated" files (`client/src/client.js`, `lib/client.js`) say *do not
  edit*; edit the core or the seam and rebuild.
- **Prompts read by the model** — the injected `[Attached files]` block
  (and any other text the model consumes) is English-only. Models think in
  English; multilingual prompt scaffolding reduces accuracy.
- **Repository docs for maintainers** — `PUBLISHING.md`, this file, and the
  code-level sections of the READMEs.

### I18n content

Everything a **human user sees in the UI** is localized through the app's
`locale` service. The primary languages are **English** and **Chinese
(Simplified)**:

- UI strings live in the `DICT` inside `src/core/client.ts` with a `zh`
  (Simplified Chinese) and an `en` dictionary for every key.
- Components call `tFn('key')`; never hard-code user-facing text in a
  component.
- When adding a new UI string, add the key to **both** dictionaries in the
  same change.
- Runtime error strings returned to the client are English (they are
  developer-facing); the card UI displays them verbatim.

### Examples

| Context | Language | Example |
| --- | --- | --- |
| Commit message | English | `fix: consume pending batch after injection` |
| Code comment | English | `// claimed messages are deep-frozen; clone, don't mutate` |
| Model prompt | English | `[Attached files] Some files have uploaded with this message: …` |
| UI button | i18n | `zh: '上传附件'`, `en: 'Attach files'` |

## Architecture cheat-sheet

- **Single source of truth**: `src/core/host.ts` and `src/core/client.ts`.
  Edit these, not the generated files.
- **Seams**: `src/client-static.ts` (client) and `src/index.ts` (host) wire
  transport / IO / services into the cores. The plugin ships as a static
  bundle only — there is no dynamic (session) mode.
- **Toolchain**: TypeScript (`strict`) compiled by `tsc`; `pnpm typecheck`
  checks sources and tests, `pnpm test` runs the suites — `host.test.ts` and
  `settings-panel.test.ts` run the TypeScript sources directly (Node ≥ 22.6
  strips the types), `bundle.test.mjs` rebuilds and then loads the shipped
  `lib/client.js` through the web loader contract, and
  `release-notes.test.mjs` covers the `CHANGELOG.md` extraction CLI the release
  workflow uses. `pnpm build` (scripts/build.mjs) compiles the host half into
  `lib/` and inlines the client core into the web loader factory
  (`lib/client.js`, plus the unwrapped `client/src/client.js` the dsh.client
  scan reads).
- **dsh API types** are a hand-maintained subset in `src/types.ts` — dsh ships
  none and its interfaces carry breaking changes.
- **Distribution**: the repository commits no build output. `lib/` and
  `client/src/client.js` are git-ignored; `pnpm build` generates them, the
  `prepare` script runs that build on `pnpm install`, on git installs and before
  packing, and the installable artifact is the `npm pack` tarball attached to
  the GitHub Release. Rebuild before hot-patching a profile or adding a local
  directory, and never commit the generated files.
- **Installed profile hot-patch**: run `node scripts/sync-profile.mjs` rather
  than copying `lib/` by hand. `lib/` is self-contained (the host half imports
  only `./core/*`), so a full copy of it is enough.

## Changelog ownership

`CHANGELOG.md` is the source of the GitHub Release body, and the maintainer
writes it. Agents must not invent release entries:

- Do not create, rewrite, prune, or auto-generate changelog entries. `docs:` /
  `ci:` changes that ship before a release still get their entry from the
  maintainer.
- The one mechanical edit agents may make is the template's `hash123`
  placeholder, when the maintainer prepares a release: replace it with the
  short hash(es) of the commits the entry describes and leave the rest of the
  entry untouched. Report a missing or malformed section instead of writing
  one.
- Write commit short hashes as **plain text, never in backticks or any other
  code formatting**. GitHub autolinks bare short hashes in the rendered
  release body; code formatting suppresses the link.
- Preview what the workflow will publish with
  `node scripts/release-notes.mjs <version>`. The release workflow rejects a
  missing, empty, or duplicated `## <version>` section and any remaining
  `hash123` placeholder.
- Keep the section format the maintainer uses: an exact `## <version>`
  heading, bold category groups (for example `**CI/CD**`), and bullets that
  point at the commit short hash.

## Release conventions

- The git tag is the **bare** `package.json` version: `1.0.0-alpha.3`, never
  `v1.0.0-alpha.3`. `.github/workflows/release.yml` triggers on bare version
  tags only, and a `v`-prefixed tag fails the manual-dispatch validation.
- The release commit subject is exactly `release: v<version>`:
  `release: v1.0.0-alpha.3`. A version-bump commit must **never** use a
  `chore:` / `chore(release):` header: the `ci` gate treats `chore` pushes as
  skippable, and `release.yml` rejects a tag whose commit subject is not
  `release: v<version>`.
- The annotated tag message carries the release commit hash:
  `git tag -a 1.0.0-alpha.3 -m "commit <short-hash>"`.
- The GitHub Release title keeps the `v` prefix: `v1.0.0-alpha.3`.
- Push the release commit and the tag together:
  `git push origin main 1.0.0-alpha.3`.

## Workflow notes

- Never commit runtime artifacts (`.dfu-*`, `uploads/`) — see `.gitignore`.
- Do not add secrets, tokens, or personal absolute paths (e.g.
  `/home/<user>/...`) to committed files.
- Verify SSH signatures on commits when the repository uses commit signing.
- Releases are tag-driven: pushing a bare version tag (`1.0.0-alpha.3`) runs
  `.github/workflows/release.yml`; a `v`-prefixed tag does not trigger it — the
  prefix belongs to the release commit subject and the GitHub Release title.
  Never move or delete a published tag — bump the version instead.
- The `ci` workflow starts with a gate: a single-commit push whose subject
  starts with `docs:` or `chore:` (scoped forms included) skips
  checkout/install/typecheck/test/build and finishes green in seconds —
  unless the commit touches `package.json` (version bumps and dependency edits
  always run the full gate). Multi-commit pushes and pull requests always run
  the full gate.

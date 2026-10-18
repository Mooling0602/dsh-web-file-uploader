# AGENTS.md

Guidelines for AI agents and contributors working on this repository.

## Language conventions

This project has a strict language split. Follow it for every change:

### English-only content

The following are always written in **English**:

- **Commit messages** — use [Conventional Commits](https://www.conventionalcommits.org/)
  format with the type that matches the change's primary purpose (see
  [Commit types](#commit-types)). Keep the summary line imperative and under
  ~72 characters.
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
| Model prompt | English | `[Attached files] Some files have been uploaded with this message: …` |
| UI button | i18n | `zh: '上传附件'`, `en: 'Attach files'` |

## Commit types

Choose the type from what the commit primarily does, and verify it against the
staged diff right before committing. Mixed changes take the type of their main
purpose: a source change that also edits a CI script stays `feat` / `fix`,
while a CI change that also refreshes docs is `ci`. Editing the release
workflow or the release-note script is `ci`, not `feat`.

| Type | Use for |
| --- | --- |
| `feat`, `fix` | Source changes that affect the plugin's runtime behavior; append `!` for a breaking change (`feat!`, `fix!`). |
| `ci` | CI/CD changes: `.github/workflows/*`, release-note composition, and the automation that builds or publishes releases. |
| `refactor` | Restructuring with no runtime behavior change; `refactor!` when the break is deliberate. |
| `build` | Packaging configuration or build options: `package.json` scripts / `files` / `engines`, `scripts/build.ts`, `tsconfig*.json`. |
| `release` | Version bumps only, as `release: v<version>`; it triggers the release build, packs the artifacts and pushes the new tag. |
| `docs` | Documentation, `CHANGELOG.md` entries and repository guides. |
| `test` | Test-only changes. |
| `chore` | Repository housekeeping that fits no other type; never use it for a version bump. |

## Architecture cheat-sheet

- **Single source of truth**: `src/core/host.ts` and `src/core/client.ts`.
  Edit these, not the generated files.
- **Seams**: `src/client-static.ts` (client) and `src/index.ts` (host) wire
  transport / IO / services into the cores. The plugin ships as a static
  bundle only — there is no dynamic (session) mode.
- **Toolchain**: TypeScript (`strict`) compiled by `tsc`; every tool script and
  suite is TypeScript run directly through Node's type stripping (Node ≥ 22.19,
  dsh's own engine floor). `pnpm typecheck` checks sources, suites and scripts;
  `pnpm test` runs `host.test.ts` against the host core and the browser-free UI
  suites against the client core (`settings-panel.test.ts` for the settings
  panel, `cards.test.ts` for the composer attachment cards), `bundle.test.ts`
  rebuilds and then loads the shipped `lib/client.js` through the web loader
  contract, and `release-notes.test.ts` covers the release-note composition CLI
  the release workflow uses. `pnpm build`
  (scripts/build.ts) compiles the host half into `lib/` and inlines the client
  core into the web loader factory (`lib/client.js`, plus the unwrapped
  `client/src/client.js` the dsh.client scan reads).
- **dsh API types** are a hand-maintained subset in `src/types.ts` — dsh ships
  none and its interfaces carry breaking changes.
- **Distribution**: the repository commits no build output. `lib/` and
  `client/src/client.js` are git-ignored; `pnpm build` generates them, the
  `prepare` script runs that build on `pnpm install`, on git installs and before
  packing, and the installable artifact is the `npm pack` tarball attached to
  the GitHub Release. A tag push also publishes the package to npm through OIDC
  trusted publishing when the `NPM_PUBLISH_ENABLED` repository variable is
  `true` — no npm token is stored, and the package's first publish is the
  manual bootstrap documented in `PUBLISHING.md`; the variable stays unset
  until that bootstrap and the trusted-publisher setup are complete. Rebuild
  before hot-patching a profile or adding a local directory, and never commit
  the generated files.
- **Installed profile hot-patch**: run `node scripts/sync-profile.ts` rather
  than copying `lib/` by hand. `lib/` is self-contained (the host half imports
  only `./core/*`), so a full copy of it is enough.

## Local references (Desktop only)

The composer may reference a picked file by its original absolute path instead
of uploading it. This is a deliberate platform decision, not a missing
adaptation:

- **Desktop only.** The Desktop shell hosts its own local dsh core and exposes
  `__DSH_HOST_PATHS__.pathFor`, so the client knows the real host path and the
  host can `stat`/read the same file. That path is stable and needs no extra
  transport, which keeps the feature robust.
- **No web support, by decision.** A served web page cannot see absolute file
  paths (browser File API limitation); a host-side file picker or manual path
  entry would add a lot of surface for little benefit. The web frontend always
  uploads. Do not add a web fallback without re-opening this decision with the
  maintainer.
- **Permission gate.** The client reads the session `permissions` projection at
  pick time; only `danger-full-access` and `auto` (which also runs without a
  sandbox) register local references. Every other value — `workspace-write`,
  `read-only`, `custom`, or a missing projection — keeps uploading. Cards
  already in the dock are never converted.
- **No copying, no ownership.** The host route (`POST /local`, loopback callers
  only) stats the file and registers a pending reference; nothing enters
  `uploads/`, the dedup index, or TTL/GC. References fold and inject like the
  existing-file group, and the host never deletes the original — the card only
  un-references it.

## Changelog ownership

`CHANGELOG.md` is the source of the GitHub Release body, and the maintainer
writes it. Agents must not invent release entries:

- Do not create, rewrite, prune, or auto-generate changelog entries unless the
  maintainer has explicitly authorized it in the conversation (for example
  "write the changelog" or "release it"). Under that authorization an agent may
  draft and commit the entry in the maintainer's place, following the format
  rules below. `docs:` / `ci:` changes that ship before a release still get
  their entry from the maintainer.
- Without that authorization, the one mechanical edit agents may make is the
  template's `hash123` placeholder, when the maintainer prepares a release:
  replace it with the short hash(es) of the commits the entry describes and
  leave the rest of the entry untouched. Report a missing or malformed section
  instead of writing one.
- Write commit short hashes as **plain text, never in backticks or any other
  code formatting**. GitHub autolinks bare short hashes in the rendered
  release body; code formatting suppresses the link.
- Preview what the workflow will publish with
  `node scripts/release-notes.ts <version>`: it composes the body from
  `## Header` + the `## <version>` section + `## Endfix` and derives the
  Full Changelog compare link. The release workflow rejects a missing, empty,
  or duplicated `## <version>` section, a missing or empty `## Header` /
  `## Endfix`, an Endfix without the `**full_changelog!**` placeholder, and any
  remaining `hash123` placeholder.
- Keep the format the maintainer uses: an exact `## <version>` heading, `###`
  category groups (for example `### CI/CD`), and bullets that point at the
  commit short hash.
- `## Header` and `## Endfix` are global wrappers around every generated
  release note and are maintained outside the version sections. Keep
  `**full_changelog!**` as a placeholder in `## Endfix`: the workflow replaces
  it with the generated
  `**Full Changelog**: <repo>/compare/<previous-tag>...<tag>` line, so never
  hand-write that link.

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
- Before committing, re-read the staged diff and confirm the commit type is
  accurate (see [Commit types](#commit-types)): correct the type, or split the
  commit, when it is not.
- Fix a commit that has not been pushed in place: `git commit --amend` (or a
  local rebase) may correct its message or content, and the type must be
  re-checked after the amend. Once a commit is on `origin`, leave it alone —
  never force-push or otherwise rewrite pushed history.
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

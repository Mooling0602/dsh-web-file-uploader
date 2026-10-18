# Publishing & Installation Guide

## Installation

`dsh plugin --profile web add <package>` is a thin pnpm forwarder: it runs
`pnpm add <package>` inside the web profile directory and promotes the package
to a profile layer **only if** its `package.json` declares `dsh.bundle.patch`
(this package does — see `cordis.patch.yml`).

The installable artifact is the **built tarball attached to a GitHub Release**:
the repository commits no build output, so a git tree or checkout holds sources
only. Any pnpm-supported source works — **no npm account is required**:

```bash
# Tarball from a GitHub Release (recommended; already built)
dsh plugin --profile web add \
  https://github.com/Mooling0602/dsh-web-file-uploader/releases/download/1.0.0-alpha.2/dsh-web-file-uploader-1.0.0-alpha.2.tgz

# npm registry (after the first manual publish; pre-releases live under the
# `next` tag until a stable release moves `latest`)
dsh plugin --profile web add dsh-web-file-uploader@next

# Git repository (rebuilds on install through the prepare script)
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader

# Local directory (fastest for development; run pnpm build there first)
dsh plugin --profile web add ../dsh-web-file-uploader
```

The npm channel starts with the first manual publish (see [npm
publishing](#npm-publishing-oidc-trusted-publishing)); the release tarball
works before that.

> **Git spec note**: pnpm's git shorthand is `github:<owner>/<repo>`; a bare
> `github.com/<owner>/<repo>` is treated as a local directory and fails with a
> "non-existent directory" warning. Alternatives:
> `git+https://github.com/Mooling0602/dsh-web-file-uploader.git` or
> `https://github.com/Mooling0602/dsh-web-file-uploader.git`.

A tarball URL is pinned in the profile manifest: switching releases means
`remove` and `add` the new URL (see [Update](#update)). A downloaded asset can
be installed with its local path (`./dsh-web-file-uploader-<version>.tgz`)
instead. After installing, **restart the dsh web process** and refresh the page.

### Prerequisites

- The repository ships **sources only**: `lib/` and `client/src/client.js` are
  git-ignored build output. The GitHub Release tarball and the npm package
  contain the built files; a checkout does not.
- Build a checkout with `pnpm build` (compiles `src/` into `lib/` and writes
  `lib/client.js` + `client/src/client.js`); `pnpm install` also runs that
  build through the `prepare` script.
- Git-hosted installs run the `prepare` script on install. pnpm blocks build
  scripts by default — allow the exact key pnpm prints in
  `pnpm-workspace.yaml` (`allowBuilds`) of the profile, then re-run (the plugin
  manager UI asks for the same approval).
- ⚠️ The client build wrapper in `scripts/build.ts` is a best-effort
  emulation of the DSH web toolchain output. **Verify it against the real web
  build before distributing** (compare with a shipped
  `@deepseek-ai/dsh-client-*` `lib/client.js`).

### Troubleshooting: `ERR_PNPM_UNEXPECTED_STORE`

If `dsh plugin --profile web add <package>` fails with
`ERR_PNPM_UNEXPECTED_STORE` ("Unexpected store location"), it is **not a
plugin issue** — it is a pnpm store-version mismatch in the web profile:

- The profile's `node_modules` was installed by a different pnpm major version
  (e.g. pnpm 10) than the one currently on `PATH` (e.g. pnpm 11). Any `pnpm`
  operation in that profile fails the same way, for any package — it fires
  before dependency resolution.
- Fix: migrate the profile to the current pnpm store:

  ```bash
  # allow non-interactive module purge, then migrate
  printf 'confirmModulesPurge=false\n' >> ~/.dsh/profiles/web/.npmrc
  cd ~/.dsh/profiles/web && pnpm install
  ```

  Afterwards `dsh plugin --profile web add <package>` works again. Fresh users
  (no existing profile) never hit this — the profile is initialized with the
  current pnpm.

## Releases

Releases are cut by CI — `.github/workflows/release.yml` — from **bare version
tags** (`1.0.0-alpha.3`, no `v` prefix). The only manual input is the
maintainer-written `CHANGELOG.md` entry: the workflow composes the GitHub
Release body from the global `## Header` content, the version's
`## <version>` section and the global `## Endfix` content (titles excluded),
and generates the `**Full Changelog**` compare link from the previous release
tag. No notes are generated from commits or PRs.

Every release attaches `dsh-web-file-uploader-<version>.tgz` — the built,
installable package, since the repository commits no `lib/` — and the run page
prints the matching `dsh plugin ... add <asset URL>` command.

### Cutting a release

The tag name is the exact `package.json` version **without** a `v` prefix
(`1.0.0-alpha.3`); the prefix belongs to the release commit subject
(`release: v1.0.0-alpha.3`) and the GitHub Release title (`v1.0.0-alpha.3`).
A `v`-prefixed tag does not trigger the workflow. Two steps:

1. Add the release's section to `CHANGELOG.md` and commit it:

   ```markdown
   ## 1.0.0-alpha.3

   ### CI/CD

   - Add CHANGELOG.md and improve the release workflow in commit 167d6f6.
   ```

   The heading is the exact bare version, and commit short hashes stay plain
   text (no backticks) so GitHub renders them as commit links. Category groups
   are `###` headings. Replace the template's `hash123` placeholder before
   tagging; the workflow rejects a missing, empty, or duplicated section and
   any leftover `hash123`. The global `## Header` and `## Endfix` sections are
   added around the section automatically — keep their content edited in
   `CHANGELOG.md`, not in a release note.

   ```bash
   git add CHANGELOG.md
   git commit -m "docs: update the 1.0.0-alpha.3 changelog"
   ```

2. Bump the version, commit as `release: v<version>`, and tag the bare
   version:

   ```bash
   # pre-release: 1.0.0-alpha.2 -> 1.0.0-alpha.3 (same for -beta.N / -rc.N)
   npm version 1.0.0-alpha.3 --no-git-tag-version
   git commit -am "release: v1.0.0-alpha.3"

   # annotated bare tag; the message carries the release commit hash
   git tag -a 1.0.0-alpha.3 -m "commit $(git rev-parse --short HEAD)"

   # push the commit and the tag — the workflow does the rest
   git push origin main 1.0.0-alpha.3
   ```

   The release commit subject must be exactly `release: v<version>` — never
   `chore(release):`; the workflow validates it against the tag.

   A final release works the same way (`npm version 1.0.0
   --no-git-tag-version`, commit `release: v1.0.0`, tag `1.0.0`).

`npm version --no-git-tag-version` only rewrites `package.json`; the release
commit and the annotated bare tag are created explicitly, so the tag never
picks up the `v` prefix. The workflow then:

1. rejects a tag that carries a `v` prefix, does not match `package.json`, is
   not valid semver, whose commit is not reachable from `main`, or whose commit
   subject is not `release: v<version>`;
2. composes the body from `CHANGELOG.md` — global `## Header`, the
   `## <version>` section and global `## Endfix` — and fails when the version
   section is missing, empty, duplicated, or still contains `hash123`, when
   `## Header` or `## Endfix` is missing or empty, or when the Endfix has no
   `**full_changelog!**` placeholder; the generated body ends with a
   `**Full Changelog**` link covering the previous release tag and this tag.
   It joins the soft-wrapped lines of each paragraph, list item and blockquote
   paragraph into one line before publishing: GitHub renders a single newline
   in a release body as a hard line break, so wrapped source would otherwise
   publish as a narrow column of short lines. It lint-checks `CHANGELOG.md`
   with markdownlint before composing; a failed
   lint still ships the build and the GitHub Release, but with an empty body
   and a failed run (see
   [Regenerating release notes](#regenerating-release-notes));
3. runs the same gate as CI (`typecheck`, `test`, `build`) and fails when the
   build modifies a tracked file (`git status` must stay clean; the generated
   output is git-ignored);
4. packs the npm tarball and asserts the shipped files are inside it;
5. creates a **GitHub Release** titled `v<version>` whose body is the composed
   notes, with the tarball attached. Any semver prerelease
   (`-alpha.N`, `-beta.N`, `-rc.N`, ...) is flagged as a **pre-release**; a
   final `X.Y.Z` release is marked latest. From `1.0.0-rc.1` on the repository
   enables **immutable releases**, so a published release's tag and assets are
   locked (see [Immutable releases](#immutable-releases));
6. publishes the package to npm through OIDC trusted publishing when the
   `NPM_PUBLISH_ENABLED` repository variable is `true` — this repository
   stores no npm token; prereleases use `--tag next` so `latest` keeps pointing
   at the last stable version, final releases use `latest`; trusted publishing
   signs the provenance attestation automatically; while the variable is
   unset, the step logs a notice and skips;
7. uploads the tarball as a workflow artifact and writes a summary table to
   the run page.

Preview the composed notes and the changelog lint locally before tagging:

```bash
node scripts/release-notes.ts 1.0.0-alpha.3
# the same markdownlint check that CI and the release run apply
npx --yes markdownlint-cli2@0.23.3 CHANGELOG.md
```

Re-running a failed workflow is safe: an existing GitHub Release gets its title
and notes refreshed, and an already-published npm version is skipped. When that
release is **immutable** its assets are locked, so the rerun keeps the published
tarball (never replaces an asset) and the summary reports
`existing immutable (assets kept)`. This applies to tags that carry the
`## Header` / `## Endfix` format; a tag from before that format change fails the
compose step, so cut a new version instead of re-running its release.

### Regenerating release notes

A markdownlint failure in the release workflow never puts malformed notes into a
published release: the run still ships the build, the tarball and the GitHub
Release, but with an **empty body**, and it ends marked failed. Repair it with
the manual **release-notes** workflow (`.github/workflows/release-notes.yml`):

1. Fix `CHANGELOG.md` on `main` (a `docs:` commit; CI lints it on the way in)
   and push.
2. *Actions → release-notes → Run workflow* with:
   - `tag` — the bare version tag of the release to repair (`1.0.0-rc.1`);
     any published tag works, not only the last one;
   - `ref` — where the notes are composed from, default `main`; any branch or
     commit is accepted, so upcoming notes can be previewed;
   - `dry_run` — compose and print the notes without editing the release; dry
     runs also skip the tag/release existence checks, so an unreleased
     version's notes can be previewed.
3. The workflow validates the tag and the existing release, lints the
   changelog, composes the body from `CHANGELOG.md` (global `## Header`, the
   `## <version>` section, global `## Endfix`, and the generated
   `**Full Changelog**` link) and writes only the GitHub Release body. Assets
   are never touched, so this also works for immutable releases, whose title and
   notes stay editable.

A failed lint leaves the release body exactly as it was; the run page shows the
markdownlint errors to fix.

### Immutable releases

From **`1.0.0-rc.1`** on, the repository enables GitHub's
[immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
(repository Settings → General → Releases → *Enable release immutability*; the
setting can also be made at the organization level). Once enabled, every new
release — including pre-releases — locks its assets and its tag to the released
commit, and GitHub generates a release attestation covering the tag, the commit
SHA and the shipped assets.

- **Locked:** release assets cannot be modified or deleted; the tag cannot be
  moved or deleted, and its name cannot be reused after the release is deleted.
- **Still editable:** title, release notes, and the pre-release / latest flags.
- **Repair policy:** never replace a published asset. If a published release is
  broken, bump the version and cut a new release; the workflow fails with a
  clear message when an immutable release is missing its tarball.
- **Rerun behavior:** creating a release attaches the tarball in the same step,
  so the first run already ships assets before publication; a rerun on an
  immutable release keeps the assets and refreshes only the title and notes.
  The run summary carries a `release immutable` row.

Releases cut before the setting was enabled (`1.0.0-alpha.5` and earlier) stay
mutable; only releases published after enabling are immutable.

Verify one release:

```bash
gh api repos/Mooling0602/dsh-web-file-uploader/releases/tags/1.0.0-rc.1 --jq '.immutable'
```

### npm publishing (OIDC trusted publishing)

The workflow publishes to npm with [Trusted
Publishing](https://docs.npmjs.com/trusted-publishers/): the job's
`id-token: write` permission lets npm exchange a GitHub OIDC identity for a
short-lived registry credential, so the repository stores **no npm token** —
there is no `NODE_AUTH_TOKEN` secret to create.

Three one-time steps make it work:

1. **Claim the package name with a manual first publish.** npm cannot configure
   a trusted publisher for a package that does not exist yet (and `npm trust`
   rejects it too). From a checkout of the first release tag:

   ```bash
   git checkout 1.0.0-alpha.4
   pnpm install                        # runs the build through `prepare`
   npm login                           # web login + 2FA, 2-hour session token
   npm publish --access public --tag next   # prerelease -> `next`, never `latest`
   ```

   The bootstrap publish is signed by your account, not by CI, so it has no
   provenance. Stable versions publish without `--tag next`; a first stable
   release uses plain `npm publish --access public` and creates `latest`.
   Until a stable release does that, the npm channel is `dsh plugin --profile
   web add dsh-web-file-uploader@next` — `latest` does not exist yet.

2. **Configure the trusted publisher** — npmjs.com → *Packages →
   dsh-web-file-uploader → Settings → Trusted publishing → GitHub Actions*, or
   from a logged-in CLI with npm ≥ 11.15.0:

   ```bash
   npm trust github dsh-web-file-uploader \
     --repository Mooling0602/dsh-web-file-uploader \
     --file release.yml \
     --allow-publish --yes
   ```

   Fields: organization/user `Mooling0602`, repository
   `dsh-web-file-uploader` (no owner), workflow filename `release.yml` (file
   name only), environment empty (this workflow sets none), and allowed action
   `npm publish` — newer configurations allow `npm stage publish` by default,
   so enable `npm publish` explicitly. If the workflow ever adds an
   `environment:`, the name must match this form exactly. Inspect the saved
   relationship with `npm trust list dsh-web-file-uploader`.

3. **Validate within 48 hours.** npm expires a trusted publisher that has not
   completed a successful publish within two days; an expired configuration
   cannot be edited, only deleted and recreated. Cut the next release right
   after configuring it. npm does not validate the form on save: a wrong
   workflow filename or environment only shows up on the first publish as
   `ENEEDAUTH`.

> **Before the first CI-published release:** the npm step is gated by the
> `NPM_PUBLISH_ENABLED` repository variable; leave it unset while completing
> steps 1–3. A tag pushed while it is unset still creates the GitHub Release
> and skips npm cleanly. Once the trusted publisher is configured, set the
> variable to `true` and cut (or re-run) the release.

### Enabling and pausing npm publishing

The npm step is gated by the repository variable `NPM_PUBLISH_ENABLED`; it is
unset by default, so releases keep shipping the GitHub Release while the
one-time npm setup is incomplete. Set it only after steps 1–3:

```bash
gh variable set NPM_PUBLISH_ENABLED --body true
gh variable list
```

To pause npm publishing again (for example while rotating credentials), delete
the variable or set it to `false`:

```bash
gh variable delete NPM_PUBLISH_ENABLED
```

With the variable unset, the workflow reports
`npm_status=disabled (NPM_PUBLISH_ENABLED != true)` and keeps the run green.
After enabling it, re-run the release workflow for a tag whose npm step was
skipped to publish that version.

Verify a CI-published release:

```bash
npm view dsh-web-file-uploader version _npmUser dist.attestations --json
# _npmUser.name is "GitHub Actions"; dist.attestations has SLSA provenance
npm audit signatures   # in a project that installed the package
```

The npm package page shows a **Provenance** badge for versions published by CI.

### Manual / dry-run release

*Actions → release → Run workflow* releases an existing tag, which is how a
release that failed midway is retried. The `tag` input takes the bare version
tag (`1.0.0-alpha.3`); a `v`-prefixed tag is rejected. Set `dry_run: true` to
run every check, the build and the pack (including the tarball artifact)
without creating a release or publishing — useful to validate the pipeline or
a suspicious build. A manual release run composes the notes from
`CHANGELOG.md` on `main` (not from the tag), so a full retry also repairs an
empty release body; use the
[release-notes workflow](#regenerating-release-notes) when only the body needs
regenerating.

### Manual publish (debugging only)

Never needed for a normal release, but available for emergencies:

```bash
pnpm install
pnpm typecheck && pnpm test
pnpm build
npm login                              # 2FA web login, 2-hour session token
npm publish --access public --tag next # prereleases; `latest` for final releases
```

Trusted publishing only applies inside GitHub Actions; a local publish is
signed by your npm account and carries no provenance.

## Update

`dsh plugin --profile web <args>` is a forwarder: it runs `pnpm <args>` inside
the web profile directory, so any pnpm management verb works. Never edit
`~/.dsh/profiles/web/node_modules/dsh-web-file-uploader` by hand — pnpm owns
that tree and the next operation rewrites it.

### Tarball channel (recommended)

The profile records the exact asset URL, so moving to a new release needs a
clean remove + add:

```bash
# switch to the new release asset
dsh plugin --profile web remove dsh-web-file-uploader
dsh plugin --profile web add \
  https://github.com/Mooling0602/dsh-web-file-uploader/releases/download/<version>/dsh-web-file-uploader-<version>.tgz
```

### Git channel

A git install rebuilds the bundle through the `prepare` script, so pnpm must be
allowed to run it (see Prerequisites).

```bash
# re-resolve the git spec to the newest commit of its default branch
# (forwarded to `pnpm update dsh-web-file-uploader`)
dsh plugin --profile web update dsh-web-file-uploader

# if the lockfile-pinned resolution refuses to move, fall back to a clean
# remove + add
dsh plugin --profile web remove dsh-web-file-uploader
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader
```

### Local-directory channel

`lib/` is not committed, so build the checkout before adding it (and rebuild
whenever `src/` changed):

```bash
cd <path-to-checkout> && pnpm build   # regenerates lib/ + client/src
dsh plugin --profile web add ../dsh-web-file-uploader
```

### Verify and restart

```bash
dsh plugin --profile web ls dsh-web-file-uploader   # installed version
```

Restart the dsh web process and refresh the page afterwards. The client
bundle is served as `/plugins/dsh-web-file-uploader/client.js?rev=<short
hash>` where `rev` is the content hash of `lib/client.js`, so a changed
bundle automatically busts the browser cache once the server recomposes its
boot manifest — no manual cache clearing is needed.

## Uninstall

```bash
dsh plugin --profile web remove dsh-web-file-uploader
```

## Compatibility note

- The plugin ships as a **static bundle only** (installed via `dsh plugin`):
  uploads land in `$DSH_HOME/uploads` (default `~/.dsh/uploads`) via `node:fs`
  — the proper dsh data directory. The dynamic (session) mode was removed in
  1.0.0-alpha.1 together with the TypeScript rewrite.

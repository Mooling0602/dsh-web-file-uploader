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

# npm registry (after the first CI publish, see Releases)
dsh plugin --profile web add dsh-web-file-uploader

# Git repository (rebuilds on install through the prepare script)
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader

# Local directory (fastest for development; run pnpm build there first)
dsh plugin --profile web add ../dsh-web-file-uploader
```

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
   `**Full Changelog**` link covering the previous release tag and this tag;
3. runs the same gate as CI (`typecheck`, `test`, `build`) and fails when the
   build modifies a tracked file (`git status` must stay clean; the generated
   output is git-ignored);
4. packs the npm tarball and asserts the shipped files are inside it;
5. creates a **GitHub Release** titled `v<version>` whose body is the composed
   notes, with the tarball attached. Any semver prerelease
   (`-alpha.N`, `-beta.N`, `-rc.N`, ...) is flagged as a **pre-release**; a
   final `X.Y.Z` release is marked latest;
6. publishes to npm **when** `NODE_AUTH_TOKEN` is configured — prereleases use
   `--tag next` so a plain `dsh plugin ... add dsh-web-file-uploader` keeps
   resolving to the last stable version, final releases use `latest`; both are
   published with `--provenance` from this public repository;
7. uploads the tarball as a workflow artifact and writes a summary table to
   the run page.

Preview the composed notes locally before tagging:

```bash
node scripts/release-notes.ts 1.0.0-alpha.3
```

Re-running a failed workflow is safe: an existing GitHub Release gets its
title, tarball, and notes refreshed, and an already-published npm version is
skipped. This applies to tags that carry the `## Header` / `## Endfix` format;
a tag from before that format change fails the compose step, so cut a new
version instead of re-running its release.

### npm credentials (optional)

The GitHub Release needs no secret at all. The npm step needs one repository
secret (Settings → Secrets and variables → Actions):

- `NODE_AUTH_TOKEN` — npm automation token with publish rights for
  `dsh-web-file-uploader`; the first publish claims the name for that account.

When the secret is missing the workflow logs a notice and skips the npm step,
so tagging works before npm is set up. [npm Trusted
Publishing](https://docs.npmjs.com/trusted-publishers/) can replace the token:
configure this repository and `release.yml` on npmjs.com and drop the secret
(the workflow already grants `id-token: write`).

### Manual / dry-run release

*Actions → release → Run workflow* releases an existing tag, which is how a
release that failed midway is retried. The `tag` input takes the bare version
tag (`1.0.0-alpha.3`); a `v`-prefixed tag is rejected. Set `dry_run: true` to
run every check, the build and the pack (including the tarball artifact)
without creating a release or publishing — useful to validate the pipeline or
a suspicious build.

### Manual publish (debugging only)

Never needed for a normal release, but available for emergencies:

```bash
pnpm install
pnpm typecheck && pnpm test
pnpm build
npm publish --tag next        # prereleases; `latest` for final releases
```

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

# Publishing & Installation Guide

## Installation

`dsh plugin --profile web add <package>` is a thin pnpm forwarder: it runs
`pnpm add <package>` inside the web profile directory and promotes the package
to a profile layer **only if** its `package.json` declares `dsh.bundle.patch`
(this package does — see `cordis.patch.yml`).

Any pnpm-supported source works — **no npm account is required** for local or
git-based distribution:

```bash
# Local directory (fastest for development)
dsh plugin --profile web add ../dsh-web-file-uploader

# Git repository (recommended for distribution)
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader

# Tarball
dsh plugin --profile web add ./dsh-web-file-uploader-1.0.0-alpha.1.tgz

# npm registry (requires publishing, see below)
dsh plugin --profile web add dsh-web-file-uploader
```

> **Git spec note**: pnpm's git shorthand is `github:<owner>/<repo>`; a bare
> `github.com/<owner>/<repo>` is treated as a local directory and fails with a
> "non-existent directory" warning. Alternatives:
> `git+https://github.com/Mooling0602/dsh-web-file-uploader.git` or
> `https://github.com/Mooling0602/dsh-web-file-uploader.git`.
```

After installing, **restart the dsh web process** and refresh the page.

### Prerequisites

- The bundle must be built before install: `pnpm build` (compiles `src/` into
  `lib/` and writes `lib/client.js` + `client/src/client.js`). `lib/` is
  committed, so a fresh clone ships the last build — rebuild after touching
  `src/`.
- Git-hosted installs run the `prepare` script on install (it rebuilds the
  bundle). pnpm blocks build scripts by default — allow the exact key pnpm
  prints in `pnpm-workspace.yaml` (`allowBuilds`) of the profile, then re-run.
- ⚠️ The client build wrapper in `scripts/build.mjs` is a best-effort
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

## Publishing to the npm registry (optional)

Only needed for `dsh plugin --profile web add dsh-web-file-uploader` (bare
name). **Requires your help** — npm credentials and CI configuration:

### What is needed from you

1. **npm access**: an npm account with publish rights for the package name
   `dsh-web-file-uploader` (or an org-scoped name). Two options:
   - an `NODE_AUTH_TOKEN` (automation token, read-only publish) for CI, and/or
   - an interactive `npm login` for manual publishes.
2. **CI platform**: GitHub Actions is assumed below; any runner that can run
   `pnpm` + `npm publish` works.

### Manual publish

```bash
pnpm install
pnpm typecheck && pnpm test   # gate the release
pnpm build                    # produces lib/ + client/src/client.js
npm publish --tag next        # --tag next keeps 1.0.0-alpha.x off `latest`
```

Use `--tag next` for the alpha line so a plain
`dsh plugin --profile web add dsh-web-file-uploader` keeps resolving to the
last stable version; drop the flag when 1.0.0 final ships.

### CI (GitHub Actions)

Add the following secrets to the repository:
- `NODE_AUTH_TOKEN` — npm automation token with publish scope.

`.github/workflows/publish.yml`:

```yaml
name: publish
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

Tag a release (`git tag v1.0.0-alpha.1 && git push --tags`) to trigger it.

## Update

`dsh plugin --profile web <args>` is a forwarder: it runs `pnpm <args>` inside
the web profile directory, so any pnpm management verb works. Never edit
`~/.dsh/profiles/web/node_modules/dsh-web-file-uploader` by hand — pnpm owns
that tree and the next operation rewrites it.

### Git channel (recommended)

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

The checkout must be rebuilt before each `add` when `src/` changed — `lib/` is
committed, so a clean checkout can be added as-is:

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

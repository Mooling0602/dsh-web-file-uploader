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
dsh plugin --profile web add ./dsh-web-file-uploader-0.2.0.tgz

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

- The client half must be built before install: `pnpm build:client` (writes
  `lib/client.js`). Local/git installs of a checkout need this build to have
  run; a published tarball ships the built artifact.
- Git-hosted installs run the `prepare` script on install. pnpm blocks build
  scripts by default — allow the exact key pnpm prints in
  `pnpm-workspace.yaml` (`allowBuilds`) of the profile, then re-run.
- ⚠️ The client build wrapper in `scripts/build-client.mjs` is a best-effort
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
pnpm build:client        # produces lib/client.js
npm publish              # uses .npmrc auth (npm login)
```

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
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:client
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

Tag a release (`git tag v0.2.0 && git push --tags`) to trigger it.

## Uninstall

```bash
dsh plugin --profile web remove dsh-web-file-uploader
```

## Compatibility note

- **Dynamic mode** (this repo's `src/`): runs in the current session via
  `cordis_define` + `cordis_run`; uploads land in `<session workspace>/uploads`
  because the sandboxed shell/fs cannot write outside the workspace.
- **Static bundle** (`lib/`, installed via `dsh plugin`): uploads land in
  `$DSH_HOME/uploads` (default `~/.dsh/uploads`) via `node:fs` — the proper dsh
  data directory.

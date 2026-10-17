# CHANGELOG

Here are the changelogs of plugin versions, and used for CI also. Some old version's
changelogs is not included. For AI agents, add missing commit short-hash (replace
`hash123`) before release action starts.

For CI, Add `Header` or `Endfix` section to every version's release note, do not
include the title(as `Header` or `Endfix`). Header content add to the first line,
and Endfix content in the last line. Especially, `**full_changelog!**` is a tag,
need to convert to real `Full Changelog` link.

For example, the content of `**full_changelog!**` is:

```markdown
**Full Changelog**: https://github.com/Mooling0602/dsh-web-file-uploader/compare/0.4.3...v1.0.0-alpha.1
```

> Do not copy this! Caculate it with scripts in CI actions.

Notice that CI is not responsible for editing the old version's release note, it
only generates new version's release note.

## Header

_**Copy the attached plugin package link and paste to dsh to install or update.**_

_**复制插件包链接到 dsh 中即可更新或安装。**_

## Endfix

**full_changelog!**

## 1.0.0-alpha.2

### CI/CD

- Add CHANGELOG.md and improve release workflow in commits 167d6f6 and 6654cdd.

No other real source code changes.

## 1.0.0-alpha.3

### Release & CI

- Trigger releases from bare version tags and give each GitHub Release a
  v-prefixed title in commit 56dcf2d.
- Skip the full CI gate for docs and chore pushes in commit dd14d12.
- Never skip the gate for a push that touches package.json, and reject a
  release tag whose commit subject is not `release: v<version>` in commit
  1274fc7.

### Distribution

- Mark the committed build artifacts as generated for GitHub's language
  statistics in commit 2be2273.
- Stop committing the generated bundle: lib/ and client/src/client.js are now
  git-ignored and ship only inside the release tarball, in commit 85c070a.
- Document installing from the GitHub Release tarball, with rebuild
  instructions for git and local-directory installs, in commit 4451763.

### Tooling

- Convert every tool script and test suite from JavaScript to TypeScript in
  commit d912d71.

### Docs

- Record the release naming conventions (bare tags, v-prefixed commit subject
  and release title) in commit 3f4d4c4.
- Forbid chore headers on version-bump commits in commit 8730130.
- Document the CI skip gate in commit bb7aeed and fix misleading details in
  PUBLISHING.md in commit b044917.
- Point the documented tooling paths at the TypeScript scripts in commit
  a0ca332.

No functional changes to the plugin's runtime behavior.

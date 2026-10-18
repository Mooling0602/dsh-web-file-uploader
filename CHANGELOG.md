# CHANGELOG

Here are the changelogs of plugin versions, and used for CI also. Some old version's changelogs is not included. For AI agents, add missing commit short-hash (replace `hash123`) before release action starts. Version sections are ordered newest first; CI locates each section by its heading, so the order is for readers only.

For CI, Add `Header` or `Endfix` section to every version's release note, do not include the title(as `Header` or `Endfix`). Header content add to the first line, and Endfix content in the last line. Especially, `**full_changelog!**` is a tag, need to convert to real `Full Changelog` link.

For example, the content of `**full_changelog!**` is:

```markdown
**Full Changelog**: https://github.com/Mooling0602/dsh-web-file-uploader/compare/0.4.3...v1.0.0-alpha.1
```

> Do not copy this! Caculate it with scripts in CI actions.

Notice that CI is not responsible for editing the old version's release note, it only generates new version's release note.

## Header

> [!NOTE]
> Copy the attached plugin package link and paste it into dsh's "Add plugin" input field to install or update.
>
> 复制插件包链接并粘贴到 dsh 的“添加插件”输入框中，即可安装或更新。

## Endfix

**full_changelog!**

## 1.0.0-rc.1

### Features

- Reference Desktop local files by their original absolute path instead of uploading them: when the shell reports a real host path the composer registers a local reference (card marked **Local**), nothing is copied into the uploads directory, no dedup index entry is written and TTL/GC never touches the file. References inject and fold like the existing-file group, and the host never deletes the original. The web UI keeps uploading because a browser page cannot see absolute paths. Permission mode is not a gate — the DSH sandbox confines writes only, so reads stay available in every mode — in commits 5e3e9cd and 6e7977e.
- Add the "Skip upload for local files" setting (default on, Desktop only): turning it off sends every file through the upload channel even when a host path is available, in commit b1eecc7.

### Fixes

- End the folded existing-group `paths.txt` with a newline so line-based readers see the last entry, in commit a894e01.
- Use "have been uploaded" in the injected `[Attached files]` prompt, in commit d85c4d0.
- Keep the local badge separator outside the badge border so the pill closes around its label only, in commit 5588c41.
- Simplify the skip-upload hint to say "Desktop" only, in commit 4d99f3c.

### CI/CD

- Make release reruns safe for immutable releases: an existing immutable release keeps its assets and only its editable title and notes are refreshed; a missing expected asset fails with a clear "bump the version" message, in commit b53906b.
- Lint `CHANGELOG.md` with markdownlint before its content can reach a release body: a `docs:` push that edits it is lint-checked in CI even on the fast path, the release workflow lints it again before composing the notes, and a failing lint still ships the build and the GitHub Release but with an empty body and a failed run, in commit c747fa2.
- Add the `.markdownlint.json` config the changelog lint runs with, allowing repeated category headings across version sections, in commit 3a51717.
- Add a manual **release-notes** workflow that lints the changelog and regenerates only the body of an existing release from `main`'s `CHANGELOG.md`, for any published tag, with `ref` and `dry_run` inputs; assets are never touched, so it repairs immutable releases too, in commit c747fa2.
- Resolve a single-commit push's changed files through the commit-files API in the CI gate: the Actions push payload carries no file lists, so a docs push editing `CHANGELOG.md` skipped the changelog lint and a docs push that changed `package.json` would have skipped the full gate; an unreadable file list now runs the checks instead of skipping them, in commit e33d8ba.

### Docs

- Record the Desktop-only local-reference decision: the web UI always uploads, permission mode is not consulted, and the host never copies or deletes the original file, in commit 27f03b0.
- Document the changelog lint, the empty-body behavior on a failed lint and the release-notes repair workflow in `AGENTS.md` and `PUBLISHING.md`, in commit c747fa2.
- Turn the release-note Header into a bilingual GitHub note that tells readers to copy the attached package link into dsh's "Add plugin" input field, in commits e8478e0 and b2e82d9.

## 1.0.0-alpha.5

### Features

- Fold large upload groups at send time: a card group that reaches the fold threshold is injected as one timestamped folder (the new uploads move into it) or one `paths.txt` (the existing deduplicated uploads are not moved), and the files return to the uploads root once the session's cards are cleared or on the next startup sweep; add the fold-threshold setting (2..100, default 100) in commit 341bb3c.
- Add a "max files per upload" setting (default 100, 0 = unlimited): a picker selection over the limit is refused whole with a notice — nothing is uploaded or discarded — and the host config persists the limit in commit cdc84e3.
- Add batch actions to the upload dock: "copy all paths", a two-step "remove all" that drops the cards but keeps the files, and a two-step "delete all" that deletes the files and un-references shared deduplicated copies, in commits 4c7ff54 and 001afe2.

### Fixes

- Give the settings page the shell's content inset, so its copy starts and ends where the shell's own settings pages do, in commit e1357f0.
- Cap the upload dock's card list at two rows and scroll it vertically instead of letting the dock push the conversation off screen in commit 23d5227.
- Inject every card reference: drop the 100-entry pending cap, so a card in the composer can no longer silently disappear from the injected context in commit 2f8a269.
- Keep shared card references in sync with folds: the injected text no longer lists uploads-root paths that have moved, and a folded group counts distinct files instead of card entries, in commit a0d4201.
- Merge a repeat upload into the existing card for the same stored path instead of showing a duplicate card, and release a card by its stable id so clearing the cards after a fold removes the injection in commit 5a11053.

### CI/CD

- Publish the npm package through OIDC trusted publishing instead of an optional token secret, keeping the pre-release dist-tag policy and letting npm sign the provenance attestation, in commit d235d76.
- Gate the npm publish step behind the `NPM_PUBLISH_ENABLED` repository variable, so GitHub Releases keep shipping while the one-time trusted publisher setup is pending, in commit 1b0f8ae.

### Docs

- Document the npm channel bootstrap, the repository-variable switch and the tarball install path used until the first publish in commit b4f1787.
- Describe the fold-threshold and max-files settings and the extended config keys in the READMEs in commits 341bb3c and cdc84e3.

## 1.0.0-alpha.4

### Breaking changes

- Replace the official add-file entry instead of hiding an official composer button: the shell's Add → File row, shared by the add (+) menu and the / slash menu, is swapped in place for this plugin's own attach-file row, and the standalone composer button is now governed by two settings — "Replace the official add-file entry" and "Always show the standalone attach button" — in commit 3a7ffdf.
- Rename the replacement setting and persist three keys in the settings file (`{ ttl, replaceOfficial, alwaysShowButton }`) in commit 3a7ffdf.

### Fixes

- Place the composer paperclip button directly to the right of the add button, ahead of the permission/mode chips, in commit 434ed56.
- Hide the permanent delete action on cards created by a deduplicated re-upload: such a card borrows a shared stored copy and now only un-references it (×), leaving file-level deletion to the settings panel, in commit 7f73a31.

### CI/CD

- Compose each release body from CHANGELOG.md's Header, version section and Endfix, derive the Full Changelog compare link from the previous release tag and adopt the Header/Endfix format in commits 8ee22a4 and 6d97000.

### Docs

- Describe the current composer-button placement and add-menu replacement behavior, the three-key settings config and the new card actions in commit 59581f6.
- Add the commit-type selection rules and allow amending unpushed commits in commits 2fd89f8 and b8d3054.
- Allow agents to write changelog entries when the maintainer explicitly authorizes it in commit 1a34695.

## 1.0.0-alpha.3

### Release & CI

- Trigger releases from bare version tags and give each GitHub Release a v-prefixed title in commit 56dcf2d.
- Skip the full CI gate for docs and chore pushes in commit dd14d12.
- Never skip the gate for a push that touches package.json, and reject a release tag whose commit subject is not `release: v<version>` in commit 1274fc7.

### Distribution

- Mark the committed build artifacts as generated for GitHub's language statistics in commit 2be2273.
- Stop committing the generated bundle: lib/ and client/src/client.js are now git-ignored and ship only inside the release tarball, in commit 85c070a.
- Document installing from the GitHub Release tarball, with rebuild instructions for git and local-directory installs, in commit 4451763.

### Tooling

- Convert every tool script and test suite from JavaScript to TypeScript in commit d912d71.

### Docs

- Record the release naming conventions (bare tags, v-prefixed commit subject and release title) in commit 3f4d4c4.
- Forbid chore headers on version-bump commits in commit 8730130.
- Document the CI skip gate in commit bb7aeed and fix misleading details in PUBLISHING.md in commit b044917.
- Point the documented tooling paths at the TypeScript scripts in commit a0ca332.

No functional changes to the plugin's runtime behavior.

## 1.0.0-alpha.2

### CI/CD

- Add CHANGELOG.md and improve release workflow in commits 167d6f6 and 6654cdd.

No other real source code changes.

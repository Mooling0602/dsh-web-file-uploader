# dsh-web-file-uploader

> **🌐 Language** · [English](README.md) | [中文](README_zh_CN.md)

A file-upload plugin for the **DeepSeek Harness** web UI. It adds a
DeepSeek-web-style **paperclip attach button** to the composer input row and
uploads the selected files to the **DSH host machine** — with **model-aware
adaptation** so the files are actually usable by the running model, and
**content-addressed deduplication** so storage never gets flooded by
re-uploads.

- **Repository**: https://github.com/Mooling0602/dsh-web-file-uploader

## Features

- 📎 Paperclip attach button in the composer tool row, wearing the official
  attach button's chrome (28px circle, `--dsw-specific-selector` fill, 14px
  filled glyph, `--dsw-alias-interactive-bg-hover-solid` hover) with the
  paperclip rotated 45° to keep this plugin's long-standing diagonal, so the
  two buttons stay tellable apart at a glance. It sits directly to the right of
  the official attach button, ahead of the permission chips — and Settings can
  optionally hide the official button and let this one take its place
- Multi-file selection with **preview-style attachment cards** (image
  thumbnails) in the dock above the composer: reading → uploading → saved,
  with copy-path and remove buttons
- Files are stored on the DSH host, never only in the browser
- Name sanitization (path separators, `..`, control characters rejected) and
  automatic `-1`/`-2` collision suffixes for distinct files with the same name
- **Content-addressed deduplication** — see [Deduplication](#deduplication)
- UI strings localized through the app's `locale` service (zh / en; follows
  the dsh web language setting or the system default)

## Model-aware adaptation & the attachment-card design

Uploaded files are shown as **attachment cards** in the dock above the
composer. The cards are the source of truth for injection:

| State | Behavior |
|---|---|
| Card present | The file's absolute path is injected into **every** user message sent while the card is visible |
| Card closed (`×`) | The plugin calls the host `remove` RPC — the file is dropped from the pending registry, **no longer injected**, and the file is **kept on disk** so the model can still re-read it from the uploads folder |
| Card deleted (🗑) | The plugin calls the host `delete` RPC — the file is **permanently removed from the DSH host** and the dedup index is scrubbed |
| Ctrl+V paste | Pasted images ride the native draft-image pipeline — no card is created and the plugin never touches them |

The distinction between `×` and 🗑 is intentional: `×` just stops injecting
(you might want the model to find the file later), while 🗑 is a statement that
you are **done with the file forever**. Deleting the last reference to a file
removes it from disk; if another live session still references the same
deduplicated copy, the file is kept and only this session's reference is
dropped.

This is a deliberate design decision: the cards persist after sending (unlike
paste previews that clear on send), so you decide how long a file stays
"attached" to the conversation. Injection is one-shot per message, and the
injected block lists exactly the files whose cards are currently open.

Injection is model-aware:

| Model type | Image files (png/jpeg/webp/gif) | Other files |
|---|---|---|
| **Multimodal** (reported `inputModalities` includes `image`) | Native `ImageBlock` via the attachments service — the image is part of the request, like a normal attached image, with **no extra prompt text** | Path text block |
| **Text-only** (e.g. DeepSeek V4 series) | Path text block — the model can call read/vision tools to inspect them | Path text block |

The capability check uses `llm.resolveModelInfo().inputModalities` (cached for
10 minutes, safe text-only fallback).

The injected prompt uses a readable, English-only format (the model reads it):

```
-----
[Attached files] Some files have uploaded with this message:
- /path/to/file1.txt
- /path/to/image1.png
Read the files or use tools to analyse (like vision tools), then answer the user.
```

### Compatibility with vision-tools and other plugins

- **Zero coupling**: the plugin only injects absolute file paths into the
  prompt. It never calls, wraps, or assumes any auxiliary tool — vision-tools
  or any other reader simply receives the path and works independently.
- **Native multimodal path**: for image-capable models, images are injected as
  native `ImageBlock`s; the model uses its own multimodal ability and is not
  prompted to reach for external tools.
- **Non-invasive**: injection targets only real user messages
  (`source.kind === 'user'`); steering/system messages are never touched, and
  a message that already carries the `[Attached files]` marker is never
  injected twice (guard against concurrent host instances). Pasting images
  via Ctrl+V is handled entirely by the product's native pipeline.

## Deduplication

Re-uploads cannot flood storage:

1. On upload, the plugin computes the **SHA-256** of the decoded bytes (the
   host hashes the request body while streaming it to the staging file with
   `node:crypto`).
2. A persisted index at `uploads/.dfu-index.json` maps `hash → stored path`.
3. If identical content is uploaded again (same name or different name), the
   existing stored copy is **reused** — no new file is written, no `-1`
   suffix copy is created, and the response carries `dedup: true`.
4. Uploads are serialized through a promise queue so concurrent identical
   uploads cannot race; a stale index entry (file deleted) falls back to a
   fresh store.

| Scenario | Result |
|---|---|
| Same file uploaded N times | One copy on disk; all uploads resolve to the same path |
| Same content, different filename | Reuses the first stored copy |
| Same name, different content | Normal `-1` collision handling (correct) |
| Process restart | The index file persists, dedup keeps working |

The index entry is `hash → { path, at }` where `at` is the upload timestamp
(epoch ms) used by the TTL cleanup below. Legacy `hash → path` entries are read
transparently and upgraded to the object form on the next write; legacy entries
carrying no timestamp are never reclaimed by TTL (only scrubbed when the file
is gone).

## Cleanup & retention (TTL GC + manual delete)

Uploaded files are reclaimed in two complementary ways:

### Automatic TTL garbage collection

Every upload, every permanent delete, and plugin start trigger a **lazy sweep**
(after the success). Files older than the TTL that are **not** referenced by
any live session's pending set are removed from disk and their index entries
are dropped. Sweeps run on the same serialized queue as uploads, so they never
race in-flight writes; no background task is required.

- **Default TTL**: `7d` (7 days).
- **Retention units**: `1s` (seconds), `1m` (minutes), `1h` (hours), `1d`
  (days); a bare number with no unit is treated as days (legacy behavior).
  `0` (or an empty/invalid value) **disables automatic GC** — files are only
  removed when you explicitly click 🗑.
- **Configure** in **Settings → File uploads** (native DSH settings panel; the
  tab carries its own paperclip mark - the composer button's own diagonal
  glyph, at the same scale - so it never reads as the gear rows other plugins
  get): the retention field and the *replace the official attach button*
  switch share one Save button. The bundle persists both in
  `~/.dsh/dsh-web-file-uploader.json` (`{ ttl, replaceOfficial }`) and merges
  updates field by field, so saving one never clears the other. The environment
  variable `DSH_UPLOAD_TTL` (e.g. `DSH_UPLOAD_TTL=30m`) is honored as a
  fallback before the default.

Files whose timestamp is unknown (legacy index entries) are never auto-removed,
protecting pre-existing uploads from being deleted on migration.

### Attach-button placement & replacing the official button

The composer tool row reads `[+ menu] [official attach] [permission chips]`.
This plugin's button always stays visible and is placed **directly to the right
of the official attach button**, ahead of the permission chips. No node React
owns is moved: the shell's slot wrapper is `display: contents`, so flex
`order` re-sequences the row — ours at 1, everything the shell draws after its
own attach button at 2.

| *Replace the official attach button* | Result |
|---|---|
| Off (default) | Two buttons side by side: the official upright paperclip, then this plugin's diagonal one |
| On | The official button is hidden and this plugin's button stands in its place — a single upload control in the row |

- Saving applies at once, with no refresh, and to every composer mounted later.
- Switching it off and saving — or disabling/unloading the plugin — puts the
  official button back exactly as the shell drew it: hiding writes one inline
  style and never detaches a node, so React's tree stays intact.
- While the official button is hidden, its own pending-attachment rail can no
  longer be triggered; uploads, progress and cleanup all belong to this plugin.
- This plugin's button is never disabled by a running turn — a file picked while
  the machine is busy is injected at the next step.
- If a future shell stops matching, the row is left exactly as drawn, the
  official button stays visible, and one console warning names the reason.

### Two card actions (recap)

| Action | Host call | File on disk |
|---|---|---|
| `×` close | `remove` | **Kept** — model may re-read it |
| 🗑 delete | `delete` | **Removed permanently** |

Closing a card whose upload is **still in flight** asks first, because the bytes
are still moving and both answers are real: *Cancel upload* aborts the transfer
and drops the staged bytes (nothing lands on disk), while *Keep uploading*
dismisses the question and leaves the card — and, once it finishes, its
reference — intact. Neither answer leaves an orphan copy behind, and the
question only appears while the transfer runs: a finished card still closes in
one click.

The `delete` host call drops this session's reference, checks that no other
live session references the same deduplicated copy, and only then unlinks the
file and scrubs the index. If another session still references it, the file is
kept (`removed: false`) but this session's card is still cleared.

## Attachment size limits

- **No per-file cap.** The host writes the request body through to a staging
  file as it arrives while hashing the same pass, so the only bound left is
  disk space (a 120 MiB upload grew the process by < 1 MiB).
- The card shows a percentage while uploading, from XHR `upload.onprogress`.
- **The encoded fallback** (a caller handing over base64 instead of a `File`)
  decodes in the browser and posts the bytes through the same streaming route
  — no per-file cap, though the decoded copy does live in page memory.
- Images additionally follow the deployment's `attachments` limits (per-message
  byte/pixel caps) when injected natively for multimodal models.

## Installation

The plugin ships as a **static bundle** — a persistent dsh profile layer — and
the installable artifact is the **built tarball attached to a GitHub Release**.
The package declares `dsh.bundle.patch` (see `cordis.patch.yml`), so
`dsh plugin --profile web add` recognizes it as a profile layer:

```bash
# GitHub Release tarball (recommended: already built)
dsh plugin --profile web add \
  https://github.com/Mooling0602/dsh-web-file-uploader/releases/download/1.0.0-alpha.2/dsh-web-file-uploader-1.0.0-alpha.2.tgz

# npm registry (after the first CI publish)
dsh plugin --profile web add dsh-web-file-uploader

# Git repository (rebuilds on install; pnpm asks to allow the build script)
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader

# Local checkout (development; run `pnpm build` in it first)
dsh plugin --profile web add ../dsh-web-file-uploader
```

The repository ships **sources only**: `lib/` and `client/src/client.js` are
git-ignored build output, generated by `pnpm build` (and by the `prepare`
script when a package is installed from git). A plain checkout has no bundle
until it is built, so use the release tarball (or npm) for a ready-to-install
package, or allow pnpm to run the `prepare` script for git installs. A tarball
URL is pinned in the profile: switching releases means `remove` + `add` the new
URL.

> **Git spec note**: pnpm's git shorthand is `github:<owner>/<repo>` (e.g.
> `github:Mooling0602/dsh-web-file-uploader`). A bare `github.com/<owner>/<repo>`
> is treated by pnpm as a *local directory* and will fail with a
> "non-existent directory" warning. Other valid forms:
> `git+https://github.com/Mooling0602/dsh-web-file-uploader.git` or
> `https://github.com/Mooling0602/dsh-web-file-uploader.git`.

Restart the dsh web process and refresh the page. See
[PUBLISHING.md](PUBLISHING.md) for distribution details and the tag-driven
release workflow (bare version tags publish pre-releases automatically).

### Update

`dsh plugin` forwards to pnpm in the profile directory, so update through it
(never edit `~/.dsh/profiles/web/node_modules` by hand — the next pnpm
operation rewrites it):

```bash
# GitHub Release tarball: the URL is pinned, so switch to the new asset
dsh plugin --profile web remove dsh-web-file-uploader
dsh plugin --profile web add \
  https://github.com/Mooling0602/dsh-web-file-uploader/releases/download/<version>/dsh-web-file-uploader-<version>.tgz

# git channel: re-resolve the branch and rebuild on install
dsh plugin --profile web update dsh-web-file-uploader
# or, if the lockfile-pinned resolution refuses to move:
dsh plugin --profile web remove dsh-web-file-uploader
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader
```

Restart the dsh web process afterwards; the served bundle URL carries a
content-hash revision (`?rev=…`) so the browser picks up the new build on
refresh. For local-directory installs, run `pnpm build` in the checkout
before re-adding it. Details: [PUBLISHING.md](PUBLISHING.md#update).

## Architecture

```
Browser (Client)                          DSH host (Host)
─────────────                             ─────────────────
conversation.input.left                   webServer route POST /upload
  └ paperclip ── File (body) ────────────► stage .dfu-tmp-*, incremental SHA-256
                                            commit: dedup → name → move → .dfu-index.json
                                            $DSH_HOME/uploads
conversation.input.dock                   remove route (keep file)
  └ attachment cards (persist)             └ pending entry deleted (file kept)
       └ × closes card → stop injecting    delete route (permanent)
       └ 🗑 deletes card                     └ pending dropped → unlink + index scrub
                                           lazy TTL sweep (upload / delete / start)
                                              └ remove files past TTL, not in pending
                                          agent/pre-step waterfall
                                             ├ resolveModelInfo → multimodal?
                                             ├ attachments.saveImage → ImageBlock
                                             └ path text block (user messages only)
```

The browser never holds the bytes as base64: the `File` itself is the request
body, and the host streams it to a staging file while hashing the same pass.

## Storage location

Uploads land in `$DSH_HOME/uploads` (default `~/.dsh/uploads`) via `node:fs` —
the dsh data directory.

The dedup index (`uploads/.dfu-index.json`) lives next to the stored files and
maps `hash → { path, at }` (see [Deduplication](#deduplication) and
[Cleanup & retention](#cleanup--retention-ttl-gc--manual-delete)).

## Repository layout

The project follows a **single-source-of-truth core + thin seam** architecture,
written in TypeScript: all business logic lives in `src/core/`; the shipped
bundle is a thin adapter over it, so changes are made once.

```
dsh-web-file-uploader/
├── src/
│   ├── core/
│   │   ├── host.ts             # canonical host logic (transport-agnostic, DI)
│   │   └── client.ts           # canonical client logic (transport-agnostic, DI)
│   ├── index.ts                # host seam: webServer routes + node:fs/crypto
│   ├── client-static.ts        # client seam: XHR/fetch transport + module react
│   └── types.ts                # hand-maintained subset of the dsh plugin API
├── lib/                        # BUILD OUTPUT (git-ignored): the shipped bundle
│   ├── index.js                # compiled host half (imports only ./core/*)
│   ├── core/host.js
│   └── client.js               # client core inlined into the web loader factory
├── client/src/client.js        # BUILD OUTPUT (git-ignored): generated from src/
├── test/
│   ├── host.test.ts            # host core regression suite (streaming intake)
│   ├── settings-panel.test.ts  # settings panel suite (stub React, no browser)
│   ├── bundle.test.mjs         # loads the shipped client bundle via the loader contract
│   └── release-notes.test.mjs  # CHANGELOG extraction CLI (release-notes gate)
├── scripts/
│   ├── build.mjs               # tsc + inline the client core + wrap the factory
│   ├── release-notes.mjs       # extract the tag version's CHANGELOG section
│   └── sync-profile.mjs        # hot-patch an installed profile, then verify
├── tsconfig.json               # strict; compiles src/ into lib/
├── cordis.patch.yml            # dsh.bundle patch (profile layer row)
├── package.json                # publishable manifest (dsh.bundle + dsh.client)
├── PUBLISHING.md               # install & release guide
├── CHANGELOG.md                # release notes source (CI copies the tag's section)
├── README.md / README_zh_CN.md
└── LICENSE                     # MIT
```

**How to change code**: edit `src/core/*` (or a seam), then run `pnpm build` —
it compiles the host half into `lib/` and regenerates the client bundle
(`lib/client.js` and `client/src/client.js`). Both are git-ignored: a checkout
ships sources only, `pnpm install` runs the same build through the `prepare`
script, and the release workflow builds the bundle before packing the tarball.
`pnpm typecheck` and `pnpm test` gate every change; the TypeScript suites run
the sources directly (Node strips the types) and the `.mjs` suites load the
shipped bundle and exercise the release-notes CLI.

## Development status

- ✅ Static bundle: card-driven injection, model-aware adaptation, dedup, i18n
  UI, settings panel with batch delete — all covered by the test suites
- ✅ Distribution: each bare-version tag runs CI, builds the bundle and attaches
  the installable tarball to the GitHub Release (no build needed to install)
- ⚠️ The client build wrapper in `scripts/build.mjs` is a best-effort emulation
  of the DSH web toolchain output; verify it against the real web build before
  distributing (compare with a shipped `@deepseek-ai/dsh-client-*`
  `lib/client.js`)

## License

MIT

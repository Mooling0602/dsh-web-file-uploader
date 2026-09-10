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

- 📎 Paperclip attach button in the composer tool row (thin line, circular
  theme-aware hover background via `--dsw-alias-interactive-bg-hover`,
  light ≈ `#F2F3F4` / dark ≈ white 8%)
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

1. On upload, the plugin computes the **SHA-256** of the decoded bytes
   (dynamic mode pipes `base64 -d | sha256sum` through the shell service;
   the static bundle uses `node:crypto`).
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
  tab carries its own paperclip mark, so it never reads as the gear rows other
  plugins get) — a single field that persists via the `settings` service namespace
  `dsh-web-file-uploader` (`{ ttl }`). The environment variable
  `DSH_UPLOAD_TTL` (e.g. `DSH_UPLOAD_TTL=30m`) is honored as a fallback before
  the default. In dynamic (session) mode the setting lives in memory; in the
  static bundle it persists through the settings document.

Files whose timestamp is unknown (legacy index entries) are never auto-removed,
protecting pre-existing uploads from being deleted on migration.

### Two card actions (recap)

| Action | Host call | File on disk |
|---|---|---|
| `×` close | `remove` | **Kept** — model may re-read it |
| 🗑 delete | `delete` | **Removed permanently** |

The `delete` host call drops this session's reference, checks that no other
live session references the same deduplicated copy, and only then unlinks the
file and scrubs the index. If another session still references it, the file is
kept (`removed: false`) but this session's card is still cleared.

## Attachment size limits

- **No per-file cap.** The static bundle writes the request body through as it
  arrives while hashing the same pass; the dynamic plugin has the browser slice
  the File and append one chunk per RPC call. Neither path holds the file in
  memory (a 120 MiB upload grew the process by < 1 MiB), so the only bound left
  is disk space.
- The card shows a percentage while uploading: XHR `upload.onprogress` in the
  static bundle, sent-chunk accounting in the dynamic plugin.
- **The fallback path still has a ceiling.** A caller that hands over base64
  instead of a `File` (the old call shape) stays under the single-shot 64 MiB
  base64 / ≈48 MiB payload cap; that path is kept for compatibility only.
- Images additionally follow the deployment's `attachments` limits (per-message
  byte/pixel caps) when injected natively for multimodal models.

## Installation

### A. Dynamic plugin (current session, no install)

```text
cordis_define + cordis_run   # host = src/host.js, client = src/client.js
```

Approve the run card and the paperclip button appears immediately. The plugin
is process-local: after a restart, define and run it again.

### B. Static bundle (persistent, `dsh plugin`)

The package declares `dsh.bundle.patch` (see `cordis.patch.yml`), so
`dsh plugin --profile web add` recognizes it as a profile layer. Any
pnpm-supported source works:

```bash
# Git repository (recommended distribution channel)
dsh plugin --profile web add github:Mooling0602/dsh-web-file-uploader

# Local directory (development)
dsh plugin --profile web add ../dsh-web-file-uploader

# Tarball
dsh plugin --profile web add ./dsh-web-file-uploader-0.2.0.tgz

# npm registry (after publishing)
dsh plugin --profile web add dsh-web-file-uploader
```

> **Git spec note**: pnpm's git shorthand is `github:<owner>/<repo>` (e.g.
> `github:Mooling0602/dsh-web-file-uploader`). A bare `github.com/<owner>/<repo>`
> is treated by pnpm as a *local directory* and will fail with a
> "non-existent directory" warning. Other valid forms:
> `git+https://github.com/Mooling0602/dsh-web-file-uploader.git` or
> `https://github.com/Mooling0602/dsh-web-file-uploader.git`.

Restart the dsh web process and refresh the page. See
[PUBLISHING.md](PUBLISHING.md) for distribution details and the optional npm
publish flow (requires your npm credentials).

### Update

`dsh plugin` forwards to pnpm in the profile directory, so update through it
(never edit `~/.dsh/profiles/web/node_modules` by hand — the next pnpm
operation rewrites it):

```bash
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
conversation.input.left                   harness.handle('upload-begin'/'upload-chunk'/
  └ paperclip ── File (sliced) ┐              'upload-finish'/'upload-abort')  [dynamic]
                              │           webServer route POST /upload        [static]
                              ▼           ┌ sandboxPolicy.resolve() → workspace root
              File slices / body          ├ session cwd / DSH_HOME + /uploads/
                              │           ├ stage .dfu-tmp-*, incremental SHA-256
                              ▼           ├ commit: dedup → name → move → .dfu-index.json
                                          └ base64 -d >> tmp (dynamic) / node:fs stream (static)
conversation.input.dock
  └ attachment cards (persist)            harness.handle('remove', …) / remove route
       └ × closes card → stop injecting     └ pending entry deleted (file kept)
       └ 🗑 deletes card                  harness.handle('delete', …) / delete route
                                              └ pending dropped → unlink + index scrub
                                           lazy TTL sweep (upload / delete / start)
                                              └ remove files past TTL, not in pending
                                          agent/pre-step waterfall
                                             ├ resolveModelInfo → multimodal?
                                             ├ attachments.saveImage → ImageBlock
                                             └ path text block (user messages only)
```

Why does the dynamic mode go through the shell's `base64 -d`? The dynamic
sandbox disables `require`, and the `fs` service only writes whole UTF-8 text —
so binary has no other way to disk than the shell service's `stdin`. Appending
per chunk (`>>`) keeps each command bounded by the chunk size instead of the
file size. The static bundle has no such restriction and streams with
`node:fs` instead.

## Storage location

| Mode | Destination |
|---|---|
| Dynamic plugin | `<session workspace>/uploads/` (sandboxed shell/fs cannot leave the workspace) |
| Static bundle | `$DSH_HOME/uploads` (default `~/.dsh/uploads`) via `node:fs` — the dsh data directory |

The dedup index (`uploads/.dfu-index.json`) lives next to the stored files and
maps `hash → { path, at }` (see [Deduplication](#deduplication) and
[Cleanup & retention](#cleanup--retention-ttl-gc--manual-delete)).

## Repository layout

The project follows a **single-source-of-truth core + thin seam** architecture:
all business logic lives in `src/core/*`; the dynamic plugin and the static
bundle are thin adapters over it, so changes are made once and both sides pick
them up.

```
dsh-web-file-uploader/
├── src/core/
│   ├── host-core.js        # canonical host logic (transport-agnostic, DI)
│   └── client-core.js      # canonical client logic (transport-agnostic, DI)
├── src/seams/
│   ├── host-dynamic.template.js     # dynamic host seam (harness + shell/fs)
│   ├── client-dynamic.template.js   # dynamic client seam (host.call + React)
│   └── client-static.template.js    # static client seam (fetch + module react)
├── src/host.js             # GENERATED dynamic host (core inlined) — do not edit
├── src/client.js           # GENERATED dynamic client (core inlined) — do not edit
├── lib/index.js            # static host seam (imports core; node:fs/crypto/webServer)
├── client/src/client.js    # GENERATED static client source — do not edit
├── scripts/
│   ├── build-dynamic.mjs   # inlines cores into seams -> src/*.js + client/src/client.js
│   └── build-client.mjs    # wraps client/src/client.js -> lib/client.js
├── cordis.patch.yml        # dsh.bundle patch (profile layer row)
├── package.json            # publishable manifest (dsh.bundle + dsh.client)
├── PUBLISHING.md           # install & npm publish guide
├── README.md / README_zh_CN.md
└── LICENSE                 # MIT
```

**How to change code**: edit `src/core/*` (or a seam), then run
`pnpm build` — it regenerates the dynamic sources (`src/host.js`,
`src/client.js`) and the static client bundle (`lib/client.js`). For the
running dynamic plugin, redeploy the regenerated `src/host.js` /
`src/client.js` via `cordis_define` + `cordis_run`.

## Development status

- ✅ Dynamic plugin: implemented and verified in live sessions
- ✅ Card-driven injection, model-aware adaptation, dedup, i18n UI
- ⚠️ Static client module: built by `scripts/build-client.mjs`, but the
  `__ModuleLoader__` wrapper must be verified against the real web toolchain
  before distribution

## License

MIT

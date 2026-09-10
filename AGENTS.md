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
  `src/seams/*`, `lib/index.js`, `scripts/*` are English. Comments on the
  "generated" files (`src/host.js`, `src/client.js`,
  `client/src/client.js`, `lib/client.js`) say *do not edit*; edit the core or
  the seam template instead and rebuild.
- **Prompts read by the model** — the injected `[Attached files]` block
  (and any other text the model consumes) is English-only. Models think in
  English; multilingual prompt scaffolding reduces accuracy.
- **Repository docs for maintainers** — `PUBLISHING.md`, this file, and the
  code-level sections of the READMEs.

### I18n content

Everything a **human user sees in the UI** is localized through the app's
`locale` service. The primary languages are **English** and **Chinese
(Simplified)**:

- UI strings live in the `DICT` inside `src/core/client-core.js` with a `zh`
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

- **Single source of truth**: `src/core/host-core.js` and
  `src/core/client-core.js`. Edit these, not the generated files.
- **Seams**: `src/seams/*.template.js` (dynamic) and `lib/index.js` (static)
  wire transport / IO / services into the cores.
- **Regenerate** after core changes: `pnpm build`
  (runs `build-dynamic.mjs` + `build-client.mjs`).
- **Runtime dynamic plugin**: redeploy the regenerated `src/host.js` /
  `src/client.js` via `cordis_define` + `cordis_run`.
- **Installed profile hot-patch**: run `node scripts/sync-profile.mjs` rather
  than copying `lib/` by hand. The static host half is a thin seam that imports
  `../src/core/*`, so a partial copy leaves it calling the core revision it
  replaced — which only surfaces at runtime, as a missing method on `core`.

## Workflow notes

- Never commit runtime artifacts (`.dfu-*`, `uploads/`) — see `.gitignore`.
- Do not add secrets, tokens, or personal absolute paths (e.g.
  `/home/<user>/...`) to committed files.
- Verify SSH signatures on commits when the repository uses commit signing.

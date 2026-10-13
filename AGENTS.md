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
| Model prompt | English | `[Attached files] Some files have uploaded with this message: …` |
| UI button | i18n | `zh: '上传附件'`, `en: 'Attach files'` |

## Architecture cheat-sheet

- **Single source of truth**: `src/core/host.ts` and `src/core/client.ts`.
  Edit these, not the generated files.
- **Seams**: `src/client-static.ts` (client) and `src/index.ts` (host) wire
  transport / IO / services into the cores. The plugin ships as a static
  bundle only — there is no dynamic (session) mode.
- **Toolchain**: TypeScript (`strict`) compiled by `tsc`; `pnpm typecheck`
  checks sources and tests, `pnpm test` runs both `.ts` suites directly (Node
  ≥ 22.6 strips the types), `pnpm build` (scripts/build.mjs) compiles the host
  half into `lib/` and inlines the client core into the web loader factory
  (`lib/client.js`, plus the unwrapped `client/src/client.js` the dsh.client
  scan reads).
- **dsh API types** are a hand-maintained subset in `src/types.ts` — dsh ships
  none and its interfaces carry breaking changes.
- **Installed profile hot-patch**: run `node scripts/sync-profile.mjs` rather
  than copying `lib/` by hand. `lib/` is self-contained (the host half imports
  only `./core/*`), so a full copy of it is enough.

## Workflow notes

- Never commit runtime artifacts (`.dfu-*`, `uploads/`) — see `.gitignore`.
- Do not add secrets, tokens, or personal absolute paths (e.g.
  `/home/<user>/...`) to committed files.
- Verify SSH signatures on commits when the repository uses commit signing.

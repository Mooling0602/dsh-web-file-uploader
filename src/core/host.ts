// dsh-web-file-uploader — canonical HOST core (transport-agnostic)
//
// Single source of truth for the host logic, consumed by the static bundle
// (lib/index.js) via `import`.
//
// All environment interactions are injected through `deps`:
//   uploadsRoot(sessionId) -> Promise<string>          base dir for uploads
//   ensureDir(absDir) -> Promise<void>                  create the upload dir
//   hashFile(absPath) -> Promise<string|null>           SHA-256 of a file on disk
//   moveFile(from, to) -> Promise<{ ok: boolean; error?: string }>  publish a staged file
//   statPath(absPath) -> Promise<{ size?: number } | null>
//   readBytes(absPath, maxBytes?, signal?) -> Promise<Uint8Array | null>
//   readTextFile(absPath) -> Promise<string | null>
//   writeTextFile(absPath, content) -> Promise<void>
//   deleteFile(absPath) -> Promise<{ ok: boolean; error?: string }>   PHYSICAL delete
//   listUploadRoots() -> Promise<string[]>             base dirs whose /uploads to GC
//   readConfig() -> { ttlDays: number }                TTL config (0 => disabled)
//   resolveModelInfo(provider, model, signal?) -> Promise<{ inputModalities?: readonly string[] } | null>
//   attachmentLimits() -> { mediaTypes: string[]; maxImageBytes: number } | null
//   saveImage({ data, mediaType, name }) -> Promise<unknown>  ImageAttachmentRef
//   probe(line) -> void                                  diagnostics (no-op in release)
//   log(...args) -> void
//
// Returns { beginStream, commitStream, abortStream, remove, delete, collect,
//           preStep }:
//   beginStream(args)  -> { ok, id, tempPath }               staged streaming intake
//   commitStream(args) -> { ok, name, path, size, dedup? }    publish the staged file
//   abortStream(args)  -> { ok }                              drop the staged file
//   remove(args)   -> { ok }                                 (un-inject only, keep file)
//   delete(args)   -> { ok, removed:boolean, reason?, path? }(permanent deletion)
//   collect()      -> runs a lazy TTL sweep over every upload root
//   preStep(payload, next) -> the (possibly replaced) pre-step decision
//
// NOTE: transport-agnostic by construction — no I/O of its own; every
// environment interaction arrives through `deps`. The exports are
// `createHostCore` (consumed by the static host seam) and the error
// extractors below.

import type { PreStepDecision, PreStepPayload } from '../types.js'

// Error extractors shared with the static host seam (src/index.ts). They live
// here rather than in a util module because this file must stay free of
// runtime imports: the regression suite (test/host.test.ts) runs these .ts
// sources directly under Node's type stripping, which cannot resolve the .js
// specifiers tsc emits for real module imports.

/** Message of an unknown thrown value, the way this codebase's catch blocks
 *  have always extracted it: prefer `.message`, fall back to the value. */
export const errMsg = (e: unknown): string =>
  String((e as { message?: string } | null | undefined)?.message || e)

/** Same preference, but keeps the original value when there is no message —
 *  the shape the `x && x.message ? x.message : x` log call sites expect. */
export const errText = (e: unknown): unknown =>
  (e as { message?: string } | null | undefined)?.message || e

/** Error code of an unknown thrown value (e.g. `EXDEV` from `rename`). */
export const errCode = (e: unknown): string | undefined =>
  (e as { code?: string } | null | undefined)?.code

/** Environment interactions the host core needs, injected by the seam. */
export interface HostCoreDeps {
  uploadsRoot(sessionId?: string): Promise<string>
  statPath(absPath: string): Promise<{ size?: number } | null>
  readTextFile(absPath: string): Promise<string | null>
  writeTextFile(absPath: string, content: string): Promise<void>
  ensureDir?(absDir: string): Promise<void>
  hashFile?(absPath: string): Promise<string | null>
  moveFile?(from: string, to: string): Promise<{ ok: boolean; error?: string }>
  readBytes?(absPath: string, maxBytes?: number, signal?: AbortSignal): Promise<Uint8Array | null>
  deleteFile?(absPath: string): Promise<{ ok: boolean; error?: string }>
  listUploadRoots?(): Promise<string[]>
  readConfig?(): { ttl?: string; ttlDays?: number } | null
  resolveModelInfo?(
    provider: string | undefined,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ inputModalities?: readonly string[] } | null>
  attachmentLimits?(): { mediaTypes: string[]; maxImageBytes: number } | null
  saveImage?(input: { data: Uint8Array; mediaType: string; name: string }): Promise<unknown>
  probe?(line: string): void
  log?(...args: unknown[]): void
}

/** A session's live reference to an uploaded file (pre-injection bookkeeping). */
export interface PendingEntry {
  id: string
  name: string
  mime: string
  size: number
  abs: string
}

/** `.dfu-index.json` maps content hash -> { path, at } (at = upload epoch ms). */
export interface IndexEntry {
  path: string
  at: number
}

/** One row of the settings-panel inventory. */
export interface UploadRow {
  hash: string
  path: string
  name: string
  size: number
  at: number
  exists: boolean
  inUse: boolean
  sessions: string[]
  overdue: boolean
}

export interface UploadResult {
  ok: boolean
  name?: string
  path?: string
  size?: number
  dedup?: boolean
  error?: string
}

export interface DeleteResult {
  ok: boolean
  removed?: boolean
  reason?: string
  path?: string
  error?: string
}

export interface DeleteManyRow {
  path: string
  ok: boolean
  removed: boolean
  reason?: string
  error?: string
}

export interface DeleteManyResult {
  ok: boolean
  removed: number
  skipped: number
  failed: number
  results: DeleteManyRow[]
}

export interface ListResult {
  ok: boolean
  files: UploadRow[]
  ttl: number
  now: number
}

/** A file being streamed in: staged on disk, published on commit. */
export interface StagedEntry {
  sessionId?: string
  name: string
  mime: string
  size: number
  uploadsBase: string
  uploadsDir: string
  tempPath: string
  at: number
}

export interface BeginStreamArgs {
  sessionId?: string
  name?: string
  mime?: string
  size?: number
}

export interface BeginStreamResult {
  ok: boolean
  id?: string
  tempPath?: string
  error?: string
}

export interface CommitStreamArgs {
  id: string
  sha256?: string
}

export interface PathArgs {
  sessionId?: string
  path?: string
}

export interface DeleteManyArgs {
  sessionId?: string
  paths?: unknown[]
}

export interface HostCore {
  beginStream(args: BeginStreamArgs): Promise<BeginStreamResult>
  commitStream(args: CommitStreamArgs): Promise<UploadResult>
  abortStream(args: { id: string }): Promise<{ ok: boolean }>
  remove(args: PathArgs): Promise<{ ok: boolean; error?: string }>
  delete(args: PathArgs): Promise<DeleteResult>
  list(): Promise<ListResult>
  deleteMany(args: DeleteManyArgs): Promise<DeleteManyResult>
  collect(): Promise<void>
  preStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
}

export function createHostCore(deps: HostCoreDeps): HostCore {
  const pending = new Map<string, PendingEntry[]>()
  const PENDING_CAP = 100
  const MODALITY_TTL = 10 * 60 * 1000
  const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

  // Serialize uploads so the hash check + write + index update never race.
  let uploadQueue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = uploadQueue.then(fn)
    uploadQueue = p.catch(() => {})
    return p
  }

  const log = deps.log || ((...a: unknown[]) => {})
  const probe = deps.probe || (() => {})

  // --- configuration ----------------------------------------------------------

  // Parse a retention duration. Accepts:
  //   "0" / ""           -> disabled (never auto-clean)
  //   "7" (no unit)      -> days (legacy ttlDays semantics)
  //   "30m" "2h" "1d" "45s" -> seconds/minutes/hours/days
  //   any other string   -> 0 (safe: never auto-clean rather than delete early)
  const parseTtl = (raw: unknown): number => {
    if (raw === undefined || raw === null) return 0
    const s = String(raw).trim()
    if (s === '' || s === '0') return 0
    const m = /^(\d+(?:\.\d+)?)\s*([smhd])?$/i.exec(s)
    if (!m) return 0
    const n = parseFloat(m[1])
    const unit = (m[2] || 'd').toLowerCase()
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000
    return n * mult
  }

  const ttlMs = (): number => {
    let raw: string | number = '7d'
    if (typeof deps.readConfig === 'function') {
      try {
        const cfg = deps.readConfig()
        if (cfg && typeof cfg === 'object') {
          const v = cfg.ttl !== undefined ? cfg.ttl : cfg.ttlDays
          if (v !== undefined && v !== null && v !== '') raw = v
        }
      } catch {
        // ignore and keep default
      }
    }
    return parseTtl(raw)
  }

  const sanitizeName = (raw: unknown): string | null => {
    const n = String(raw || '').replace(/[\/\\\0]/g, '_').trim()
    if (!n || n === '.' || n === '..' || n.length > 255) return null
    return n
  }

  const indexPath = (uploadsDir: string): string => uploadsDir + '/.dfu-index.json'

  // .dfu-index.json maps hash -> { path, at } (at = upload epoch ms).
  // Legacy entries (hash -> path string) are migrated in memory to { path, at: 0 };
  // at === 0 means "time unknown" and is never reclaimed by TTL.
  const loadIndex = async (uploadsDir: string): Promise<Record<string, IndexEntry>> => {
    try {
      const text = await deps.readTextFile(indexPath(uploadsDir))
      if (text === null) return {}
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: Record<string, IndexEntry> = {}
      for (const k of Object.keys(parsed)) {
        const v = parsed[k]
        if (typeof v === 'string') {
          out[k] = { path: v, at: 0 }
        } else if (v && typeof v === 'object' && typeof v.path === 'string') {
          out[k] = { path: v.path, at: Number.isFinite(v.at) ? v.at : 0 }
        }
      }
      return out
    } catch {
      return {}
    }
  }

  const saveIndex = async (uploadsDir: string, index: Record<string, IndexEntry>): Promise<void> => {
    try {
      await deps.writeTextFile(indexPath(uploadsDir), JSON.stringify(index))
    } catch (err) {
      log('dfu index save failed:', errText(err))
    }
  }

  // --- pending bookkeeping -----------------------------------------------------

  function registerPending(sessionId: string | undefined, entry: { name: string; mime: string; size: number; abs: string }): void {
    if (!sessionId) return
    let row = pending.get(sessionId)
    if (!row) {
      row = []
      pending.set(sessionId, row)
    }
    if (row.length >= PENDING_CAP) row.shift()
    row.push({
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 9),
      name: entry.name,
      mime: entry.mime,
      size: entry.size,
      abs: entry.abs,
    })
  }

  // Does ANY live session still hold a pending reference to this path?
  // Used to protect dedup-shared copies from permanent deletion / TTL sweep.
  function pendingRefs(absPath: string): boolean {
    if (!absPath) return false
    for (const row of pending.values()) {
      if (row && row.some((e) => e.abs === absPath)) return true
    }
    return false
  }

  // Which live sessions still hold this path? The settings UI shows the count
  // and tells the user to clear it from the conversation's own file card.
  function pendingHolders(absPath: string): string[] {
    const holders: string[] = []
    if (!absPath) return holders
    for (const [sessionId, row] of pending.entries()) {
      if (row && row.some((e) => e.abs === absPath)) holders.push(sessionId)
    }
    return holders
  }

  function dropPendingRef(sessionId: string, absPath: string): void {
    const row = pending.get(sessionId)
    if (row) {
      const i = row.findIndex((e) => e.abs === absPath)
      if (i >= 0) {
        row.splice(i, 1)
        if (row.length === 0) pending.delete(sessionId)
      }
    }
  }

  // --- intake policy shared by both transports -------------------------------

  // Reuse the stored copy of identical content. Returns the shared result, or
  // null when these bytes still have to be written.
  async function reuseExisting(
    sessionId: string | undefined,
    name: string,
    mime: string,
    hash: string | null,
    size: number,
    uploadsDir: string,
  ): Promise<UploadResult | null> {
    if (!hash) return null
    try {
      const index = await loadIndex(uploadsDir)
      const existing = index[hash]
      if (!existing) return null
      const info = await deps.statPath(existing.path)
      if (!info) return null
      const bytes = info.size !== undefined ? info.size : size
      registerPending(sessionId, { name, mime, size: bytes, abs: existing.path })
      probe('DEDUP sid=' + sessionId + ' file=' + name + ' -> ' + existing.path)
      return { ok: true, name, path: existing.path, size: bytes, dedup: true }
    } catch {
      // stale index entry -> fall through and re-store
      return null
    }
  }

  // First free name for this upload: `name`, then `stem-1.ext`, `stem-2.ext`, ...
  async function allocateTarget(uploadsDir: string, name: string): Promise<string | null> {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let i = 0; i < 100; i += 1) {
      const candidate = uploadsDir + '/' + (i === 0 ? name : stem + '-' + i + ext)
      const info = await deps.statPath(candidate)
      if (!info) return candidate
    }
    return null
  }

  // Record hash -> { path, at } (future re-uploads reuse this copy), keep the
  // session's pending reference, and kick the lazy TTL sweep.
  async function publish(
    sessionId: string | undefined,
    name: string,
    mime: string,
    hash: string | null,
    size: number,
    uploadsDir: string,
    uploadsBase: string,
    abs: string,
  ): Promise<UploadResult> {
    if (hash) {
      const index = await loadIndex(uploadsDir)
      if (!index[hash]) {
        index[hash] = { path: abs, at: Date.now() }
        await saveIndex(uploadsDir, index)
      }
    }
    registerPending(sessionId, { name, mime, size, abs })
    probe('UPLOAD sid=' + sessionId + ' file=' + name + ' pendingN=' + (pending.get(sessionId!) || []).length)
    try {
      enqueue(() => gcForRoot(uploadsBase))
    } catch {
      // non-fatal
    }
    return { ok: true, name, path: abs, size, dedup: false }
  }

  // --- streaming intake ------------------------------------------------------
  // The transport moves the bytes — the static bundle streams the HTTP request
  // body into a staged file — while the core owns staging, naming, dedup, the
  // index and pending bookkeeping. Neither path ever holds the whole file in
  // memory, so file size is bounded by disk, not by the transport.

  const staged = new Map<string, StagedEntry>()
  const STAGED_TTL_MS = 6 * 60 * 60 * 1000

  const tempPathFor = (uploadsDir: string, id: string): string => uploadsDir + '/.dfu-tmp-' + id

  // Drop a staged file: best effort, never fatal (abort paths and failed moves).
  async function dropTemp(absPath: string): Promise<void> {
    if (!absPath || typeof deps.deleteFile !== 'function') return
    try {
      await deps.deleteFile(absPath)
    } catch {
      // best effort
    }
    probe('STREAM-DROP path=' + absPath)
  }

  // Forget staged uploads nobody finished (a crashed or closed tab leaves both an
  // entry and a partial file behind; the sweep keeps neither forever).
  function sweepStaged(): void {
    const now = Date.now()
    for (const [id, entry] of staged) {
      if (now - entry.at > STAGED_TTL_MS) {
        staged.delete(id)
        void dropTemp(entry.tempPath)
      }
    }
  }

  async function beginStream(args: BeginStreamArgs): Promise<BeginStreamResult> {
    try {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      const name = sanitizeName(args && args.name)
      const mime = args && typeof args.mime === 'string' ? args.mime : ''
      const declared = Number(args && args.size)
      if (!name) return { ok: false, error: 'invalid file name' }
      sweepStaged()
      const uploadsBase = await deps.uploadsRoot(sessionId)
      const uploadsDir = uploadsBase + '/uploads'
      if (typeof deps.ensureDir === 'function') await deps.ensureDir(uploadsDir)
      const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 9)
      const entry: StagedEntry = {
        sessionId: sessionId,
        name: name,
        mime: mime,
        size: Number.isFinite(declared) && declared > 0 ? declared : 0,
        uploadsBase: uploadsBase,
        uploadsDir: uploadsDir,
        tempPath: tempPathFor(uploadsDir, id),
        at: Date.now(),
      }
      staged.set(id, entry)
      probe('STREAM-BEGIN sid=' + sessionId + ' file=' + name)
      return { ok: true, id: id, tempPath: entry.tempPath }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  // Publish a staged file: hash it (the transport may already know), reuse an
  // identical copy when one exists, otherwise move it onto its final name.
  async function commitStream(args: CommitStreamArgs): Promise<UploadResult> {
    const id = args && typeof args.id === 'string' ? args.id : ''
    const entry = staged.get(id)
    if (!entry) return { ok: false, error: 'unknown upload' }
    try {
      let hash = args && typeof args.sha256 === 'string' && /^[0-9a-f]{64}$/.test(args.sha256) ? args.sha256 : null
      if (!hash && typeof deps.hashFile === 'function') hash = await deps.hashFile(entry.tempPath)

      let size = 0
      try {
        const info = await deps.statPath(entry.tempPath)
        if (info && info.size !== undefined) size = info.size
      } catch {
        // keep size 0 when the staged file cannot be stat'ed
      }

      const reused = await reuseExisting(entry.sessionId, entry.name, entry.mime, hash, size, entry.uploadsDir)
      if (reused) {
        staged.delete(id)
        await dropTemp(entry.tempPath)
        return reused
      }

      const abs = await allocateTarget(entry.uploadsDir, entry.name)
      if (!abs) {
        staged.delete(id)
        await dropTemp(entry.tempPath)
        return { ok: false, error: 'could not allocate a file name' }
      }
      if (typeof deps.moveFile !== 'function') {
        staged.delete(id)
        await dropTemp(entry.tempPath)
        return { ok: false, error: 'move unavailable' }
      }
      const moved = await deps.moveFile(entry.tempPath, abs)
      if (!moved || !moved.ok) {
        staged.delete(id)
        await dropTemp(entry.tempPath)
        return { ok: false, error: (moved && moved.error) || 'finalize failed' }
      }
      staged.delete(id)
      probe('STREAM-COMMIT sid=' + entry.sessionId + ' file=' + entry.name + ' bytes=' + size)
      return await publish(entry.sessionId, entry.name, entry.mime, hash, size, entry.uploadsDir, entry.uploadsBase, abs)
    } catch (err) {
      staged.delete(id)
      await dropTemp(entry.tempPath)
      return { ok: false, error: errMsg(err) }
    }
  }

  async function abortStream(args: { id: string }): Promise<{ ok: boolean }> {
    const id = args && typeof args.id === 'string' ? args.id : ''
    const entry = staged.get(id)
    if (!entry) return { ok: true }
    staged.delete(id)
    await dropTemp(entry.tempPath)
    return { ok: true }
  }

  // --- remove (× close) ---------------------------------------------------------
  // Keep files on disk: the model may still re-read them from the uploads folder.

  async function remove(args: PathArgs): Promise<{ ok: boolean; error?: string }> {
    try {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      const path = args && typeof args.path === 'string' ? args.path : undefined
      if (!sessionId || !path) return { ok: false, error: 'missing sessionId or path' }
      dropPendingRef(sessionId, path)
      const row0 = pending.get(sessionId)
      probe('REMOVE sid=' + sessionId + ' path=' + path + ' pendingN=' + (row0 ? row0.length : 0))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  // --- delete (🗑 permanent) -----------------------------------------------------
  // Drop the pending ref AND physically delete the file, unless another live
  // session still references the same dedup copy.

  const rootsMatchingPath = async (absPath: string): Promise<string[]> => {
    const matches: string[] = []
    try {
      let roots: string[] = []
      if (typeof deps.listUploadRoots === 'function') roots = (await deps.listUploadRoots()) || []
      for (const r of roots) {
        const base = String(r || '')
        if (!base) continue
        if (absPath.indexOf(base + '/uploads/') === 0) matches.push(base)
      }
    } catch {
      // ignore
    }
    return matches
  }

  const scrubIndexForPath = async (absPath: string): Promise<void> => {
    try {
      const bases = await rootsMatchingPath(absPath)
      for (const base of bases) {
        const uploadsDir = base + '/uploads'
        const index = await loadIndex(uploadsDir)
        let changed = false
        for (const k of Object.keys(index)) {
          if (index[k].path === absPath) {
            delete index[k]
            changed = true
          }
        }
        if (changed) await saveIndex(uploadsDir, index)
      }
    } catch (err) {
      log('dfu index scrub failed:', errText(err))
    }
  }

  async function deleteFile(args: PathArgs): Promise<DeleteResult> {
    const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
    const path = args && typeof args.path === 'string' ? args.path : undefined
    if (!sessionId || !path) return { ok: false, error: 'missing sessionId or path' }

    // 1) Drop this session's pending ref (always; the user is done with it).
    dropPendingRef(sessionId, path)
    probe('DELETE-SESSION sid=' + sessionId + ' path=' + path)

    // 2) Cross-session safety: another live session still references it -> keep file.
    if (pendingRefs(path)) {
      return { ok: true, removed: false, reason: 'in-use-by-other-session', path }
    }

    // 3) Physically delete.
    if (typeof deps.deleteFile !== 'function') {
      return { ok: false, removed: false, error: 'deleteFile unavailable', path }
    }
    try {
      const res = await deps.deleteFile(path)
      const resErr = String(res && res.error ? res.error : '')
      if (!res || !res.ok) {
        // A missing file is already deleted: treat ENOENT as success so both
        // seams (shell `rm -f` and node `unlink`) behave idempotently.
        if (/ENOENT|no such file/i.test(resErr)) {
          await scrubIndexForPath(path)
          return { ok: true, removed: true, path }
        }
        return { ok: false, removed: false, error: resErr || 'delete failed', path }
      }
      // 4) Scrub the dedup index.
      await scrubIndexForPath(path)
      probe('DELETE sid=' + sessionId + ' removed=1 path=' + path)
      try {
        enqueue(() => gcForRoots())
      } catch {
        // non-fatal
      }
      return { ok: true, removed: true, path }
    } catch (err) {
      return { ok: false, removed: false, error: errMsg(err), path }
    }
  }

  // --- listing (settings: manage uploaded files) ---------------------------------
  // Every root this host can write to is listed, because the dedup index is
  // per-root, not global: the same basename can exist under two workspaces.

  async function listFiles(): Promise<ListResult> {
    const ttl = ttlMs()
    const now = Date.now()
    const out: UploadRow[] = []
    let roots: string[] = []
    try {
      if (typeof deps.listUploadRoots === 'function') roots = (await deps.listUploadRoots()) || []
    } catch {
      roots = []
    }
    for (const r of roots) {
      const base = String(r || '')
      if (!base) continue
      const uploadsDir = base + '/uploads'
      const index = await loadIndex(uploadsDir)
      for (const hash of Object.keys(index)) {
        const entry = index[hash]
        const path = entry.path
        if (typeof path !== 'string' || path === '') continue
        let size = 0
        let exists = false
        try {
          const info = await deps.statPath(path)
          if (info) {
            exists = true
            size = Number(info.size) || 0
          }
        } catch {
          exists = true // stay conservative on stat errors, like the GC does
        }
        const holders = pendingHolders(path)
        const name = path.slice(path.lastIndexOf('/') + 1)
        out.push({
          hash,
          path,
          name,
          size,
          at: entry.at > 0 ? entry.at : 0,
          exists,
          inUse: holders.length > 0,
          sessions: holders,
          // Past retention but still referenced: the automatic sweep will not
          // touch it, so the UI can point that out instead of looking stuck.
          overdue: !!(ttl > 0 && entry.at > 0 && now - entry.at > ttl),
        })
      }
    }
    // Newest first; unknown timestamps sink to the bottom.
    out.sort((a, b) => b.at - a.at)
    return { ok: true, files: out, ttl: ttl > 0 ? ttl : 0, now }
  }

  // --- permanent delete of a selection (settings) --------------------------------
  // Same safety rules as the single-file delete: a path another live session
  // still references is never physically removed.

  async function deleteMany(args: DeleteManyArgs): Promise<DeleteManyResult> {
    const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
    const rawPaths = args && args.paths
    const paths: unknown[] = Array.isArray(rawPaths) ? rawPaths : []
    const results: DeleteManyRow[] = []
    let removed = 0
    let skipped = 0
    let failed = 0
    for (const raw of paths) {
      const path = typeof raw === 'string' ? raw : ''
      if (!path) continue
      if (pendingRefs(path)) {
        skipped += 1
        results.push({ path, ok: false, removed: false, reason: 'in-use' })
        continue
      }
      try {
        const res = await deps.deleteFile!(path)
        const resErr = String(res && res.error ? res.error : '')
        if (!res || !res.ok) {
          // A missing file is already deleted (both seams behave idempotently).
          if (/ENOENT|no such file/i.test(resErr)) {
            await scrubIndexForPath(path)
            removed += 1
            results.push({ path, ok: true, removed: true })
            continue
          }
          failed += 1
          results.push({ path, ok: false, removed: false, error: resErr || 'delete failed' })
          continue
        }
        await scrubIndexForPath(path)
        removed += 1
        results.push({ path, ok: true, removed: true })
      } catch (err) {
        failed += 1
        results.push({ path, ok: false, removed: false, error: errMsg(err) })
      }
    }
    // The selection may have come from any session; drop this session's refs for
    // whatever actually disappeared, so its own cards do not linger. Paths that
    // were skipped are deliberately left alone: dropping their ref would release
    // the very guard that protected them.
    if (sessionId) {
      for (const row of results) {
        if (row.ok && row.removed) dropPendingRef(sessionId, row.path)
      }
    }
    probe('DELETE-MANY n=' + paths.length + ' removed=' + removed + ' skipped=' + skipped + ' failed=' + failed)
    return { ok: failed === 0, removed, skipped, failed, results }
  }

  // --- garbage collection (lazy TTL sweep) ---------------------------------------

  async function gcForRoot(uploadsBase: string): Promise<void> {
    const ttl = ttlMs()
    if (!(ttl > 0)) return // automatic GC disabled
    const uploadsDir = uploadsBase + '/uploads'
    const index = await loadIndex(uploadsDir)
    const keys = Object.keys(index)
    if (keys.length === 0) return
    let changed = false
    const now = Date.now()
    for (const hash of keys) {
      const entry = index[hash]
      const path = entry.path
      // Stale entry: file no longer on disk -> drop it.
      let exists = false
      try {
        const info = await deps.statPath(path)
        exists = !!info
      } catch {
        exists = true // stay conservative on stat errors
      }
      if (!exists) {
        delete index[hash]
        changed = true
        probe('GC-STALE path=' + path)
        continue
      }
      // Still referenced by a live session -> never reclaim.
      if (pendingRefs(path)) continue
      // Over TTL (only when the timestamp is known) -> delete.
      if (entry.at > 0 && now - entry.at > ttl) {
        try {
          if (typeof deps.deleteFile !== 'function') continue
          const res = await deps.deleteFile(path)
          if (res && res.ok) {
            delete index[hash]
            changed = true
            probe('GC-DEL path=' + path)
          } else {
            log('dfu gc delete failed:', path, res && res.error)
          }
        } catch (err) {
          log('dfu gc delete error:', path, errText(err))
        }
      }
    }
    if (changed) await saveIndex(uploadsDir, index)
  }

  async function gcForRoots(): Promise<void> {
    try {
      let roots: string[] = []
      if (typeof deps.listUploadRoots === 'function') roots = (await deps.listUploadRoots()) || []
      for (const r of roots) {
        try {
          await gcForRoot(r)
        } catch (err) {
          log('dfu gc sweep failed for root', r, errText(err))
        }
      }
    } catch (err) {
      log('dfu gc failed:', errText(err))
    }
  }

  // --- pre-step injection ---------------------------------------------------

  const modalityCache = new Map<string, { at: number; value: boolean }>()

  const supportsImages = async (
    provider: string | undefined,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (!provider || !model) return false
    const key = provider + '\u0000' + model
    const hit = modalityCache.get(key)
    if (hit && Date.now() - hit.at < MODALITY_TTL) return hit.value
    let value = false
    if (deps.resolveModelInfo) {
      try {
        const info = await deps.resolveModelInfo(provider, model, signal)
        const modalities = info?.inputModalities
        value = Array.isArray(modalities) && modalities.includes('image')
      } catch {
        value = false
      }
    }
    modalityCache.set(key, { at: Date.now(), value })
    return value
  }

  async function preStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> {
    const decision = await next()
    try {
      if (!decision || decision.kind !== 'enter') return decision
      const agent = payload && payload.agent
      if (!agent) return decision
      const sid = String(agent.id)
      const row = pending.get(sid)
      const claimed = payload.messages
      if (!row || row.length === 0 || !Array.isArray(claimed) || claimed.length === 0) return decision
      if (!Array.isArray(decision.messages)) return decision

      const target = claimed[claimed.length - 1]
      if (!target || !Array.isArray(target.content)) return decision
      const srcKind = target.source && target.source.kind
      if (srcKind !== 'user') return decision

      const hasMarker = target.content.some(
        (b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.indexOf('[Attached files]') >= 0,
      )
      if (hasMarker) return decision

      const multimodal = await supportsImages(agent.options && agent.options.provider, agent.options && agent.options.model, payload.signal)

      const limits = deps.attachmentLimits ? deps.attachmentLimits() : null
      const blocks: Array<{ type: string; attachment?: unknown; text?: string }> = []
      const paths: string[] = []

      for (const entry of row) {
        const isImage = limits !== null && limits.mediaTypes.includes(entry.mime)
        if (limits !== null && multimodal && isImage && entry.size <= limits.maxImageBytes && deps.saveImage && deps.readBytes) {
          try {
            const bytes = await deps.readBytes(entry.abs, limits.maxImageBytes, payload.signal)
            if (!bytes) throw new Error('read failed')
            const ref = await deps.saveImage({ data: bytes, mediaType: entry.mime, name: entry.name })
            blocks.push({ type: 'image', attachment: ref })
          } catch {
            paths.push(entry.abs)
          }
        } else {
          paths.push(entry.abs)
        }
      }

      if (blocks.length > 0 || paths.length > 0) {
        const push = blocks.slice()
        if (paths.length > 0) {
          const lines = paths.map((p) => '- ' + p).join('\n')
          const text =
            '\n-----\n[Attached files] Some files have uploaded with this message:\n' +
            lines +
            '\nRead the files or use tools to analyse (like vision tools), then answer the user.'
          push.push({ type: 'text', text })
        }
        const enriched = { ...target, content: target.content.concat(push) }
        const newMessages = decision.messages.map((m) => (m === target ? enriched : m))
        probe('INJECT sid=' + sid + ' blocks=' + blocks.length + ' paths=' + paths.length + ' pendingN=' + row.length + ' msgContent=' + enriched.content.length)
        return { ...decision, messages: newMessages }
      }
    } catch (err) {
      log('dfu pre-step injection failed:', errMsg(err))
    }
    return decision
  }

  return {
    // Staging touches only its own temp file; committing goes through the
    // queue because it reads and rewrites the shared index.
    beginStream,
    commitStream: (args) => enqueue(() => commitStream(args)),
    abortStream,
    remove,
    delete: (args) => enqueue(() => deleteFile(args)),
    // Listing only reads; deleting goes through the queue so it cannot race an
    // in-flight upload that is rewriting the shared index.
    list: () => listFiles(),
    deleteMany: (args) => enqueue(() => deleteMany(args)),
    collect: () => enqueue(() => gcForRoots()),
    preStep,
  }
}

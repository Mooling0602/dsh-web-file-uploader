// GENERATED — do not edit. Edit src/core/host-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate src/host.js.
// dsh-web-file-uploader — canonical HOST core (transport-agnostic)
//
// Single source of truth for the host logic, consumed by BOTH:
//   - the static bundle (lib/index.js) via `import`,
//   - the dynamic plugin (src/host.js) via inlining (scripts/build-dynamic.mjs).
//
// All environment interactions are injected through `deps`:
//   uploadsRoot(sessionId) -> Promise<string>          base dir for uploads
//   hashBase64(base64, signal?) -> Promise<string|null> SHA-256 of decoded bytes
//   saveUploadFile(base64, absPath) -> Promise<{ ok: boolean; error?: string }>
//   resolvePath(absPath) -> Promise<unknown>            opaque fs handle
//   processPath(handle) -> string                       absolute path for a handle
//   statPath(absPath) -> Promise<{ size?: number } | null>
//   readBytes(absPath, maxBytes, signal?) -> Promise<Uint8Array | null>
//   readTextFile(absPath) -> Promise<string | null>
//   writeTextFile(absPath, content) -> Promise<void>
//   resolveModelInfo(provider, model, signal?) -> Promise<{ inputModalities?: readonly string[] }>
//   attachmentLimits() -> { mediaTypes: string[]; maxImageBytes: number } | null
//   saveImage({ data, mediaType, name }) -> Promise<unknown>  ImageAttachmentRef
//   probe(line) -> void                                  diagnostics (no-op in release)
//   log(...args) -> void
//
// Returns { upload, remove, preStep }:
//   upload(args)   -> { ok, name, path, size, dedup? } | { ok:false, error }
//   remove(args)   -> { ok }
//   preStep(payload, next) -> the (possibly replaced) pre-step decision
//
// NOTE: this file must stay free of `import`/`require` and of any sandbox-only
// builtin — the dynamic build inlines it verbatim into the sandbox function
// body. Only `export function createHostCore` is used by the static side.

function createHostCore(deps) {
  const pending = new Map()
  const PENDING_CAP = 100
  const MAX_BASE64_LENGTH = 64 * 1024 * 1024
  const MODALITY_TTL = 10 * 60 * 1000

  // Serialize uploads so the hash check + write + index update never race.
  let uploadQueue = Promise.resolve()
  const enqueue = (fn) => {
    const p = uploadQueue.then(fn)
    uploadQueue = p.catch(() => {})
    return p
  }

  const log = deps.log || ((...a) => {})
  const probe = deps.probe || (() => {})

  const sanitizeName = (raw) => {
    const n = String(raw || '').replace(/[\/\\\0]/g, '_').trim()
    if (!n || n === '.' || n === '..' || n.length > 255) return null
    return n
  }

  const base64Size = (b64) => {
    const clean = b64.replace(/\s+/g, '')
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
    return Math.floor((clean.length * 3) / 4) - padding
  }

  const indexPath = (uploadsDir) => uploadsDir + '/.dfu-index.json'

  const loadIndex = async (uploadsDir) => {
    try {
      const text = await deps.readTextFile(indexPath(uploadsDir))
      if (text === null) return {}
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  const saveIndex = async (uploadsDir, index) => {
    try {
      await deps.writeTextFile(indexPath(uploadsDir), JSON.stringify(index))
    } catch (err) {
      log('dfu index save failed:', err && err.message ? err.message : err)
    }
  }

  // --- upload ---------------------------------------------------------------

  async function upload(args) {
    try {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      const name = sanitizeName(args && args.name)
      const mime = args && typeof args.mime === 'string' ? args.mime : ''
      const base64 = args && typeof args.base64 === 'string' ? args.base64 : ''
      if (!name) return { ok: false, error: 'invalid file name' }
      if (!base64) return { ok: false, error: 'empty content' }
      if (base64.length > MAX_BASE64_LENGTH) return { ok: false, error: 'file exceeds the ~48 MiB cap' }
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return { ok: false, error: 'invalid base64 payload' }

      const uploadsDir = await deps.uploadsRoot(sessionId) + '/uploads'

      // 1) Content hash (decoded bytes).
      const hash = await deps.hashBase64(base64)

      // 2) Dedup: same content already stored -> reuse, no new copy.
      if (hash) {
        const index = await loadIndex(uploadsDir)
        const existing = index[hash]
        if (existing) {
          try {
            const info = await deps.statPath(existing)
            if (info) {
              registerPending(sessionId, { name, mime, size: info.size !== undefined ? info.size : base64Size(base64), abs: existing })
              probe('DEDUP sid=' + sessionId + ' file=' + name + ' -> ' + existing)
              return { ok: true, name, path: existing, size: info.size !== undefined ? info.size : base64Size(base64), dedup: true }
            }
          } catch {
            // index entry stale -> fall through and re-store
          }
        }
      }

      // 3) Allocate a non-colliding name.
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot) : ''
      let abs = null
      for (let i = 0; i < 100; i += 1) {
        const candidate = uploadsDir + '/' + (i === 0 ? name : stem + '-' + i + ext)
        const info = await deps.statPath(candidate)
        if (!info) {
          abs = candidate
          break
        }
      }
      if (!abs) return { ok: false, error: 'could not allocate a file name' }

      // 4) Write the new copy.
      const written = await deps.saveUploadFile(base64, abs)
      if (!written.ok) return { ok: false, error: written.error || 'save failed' }

      // 5) Record hash -> path so future re-uploads reuse this copy.
      if (hash) {
        const index = await loadIndex(uploadsDir)
        if (!index[hash]) {
          index[hash] = abs
          await saveIndex(uploadsDir, index)
        }
      }

      registerPending(sessionId, { name, mime, size: base64Size(base64), abs })
      probe('UPLOAD sid=' + sessionId + ' file=' + name + ' pendingN=' + (pending.get(sessionId) || []).length)
      return { ok: true, name, path: abs, size: base64Size(base64), dedup: false }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  }

  function registerPending(sessionId, entry) {
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

  // --- remove ---------------------------------------------------------------

  async function remove(args) {
    try {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : undefined
      const path = args && typeof args.path === 'string' ? args.path : undefined
      if (!sessionId || !path) return { ok: false, error: 'missing sessionId or path' }
      const row = pending.get(sessionId)
      if (row) {
        const i = row.findIndex((e) => e.abs === path)
        if (i >= 0) row.splice(i, 1)
        if (row.length === 0) pending.delete(sessionId)
        probe('REMOVE sid=' + sessionId + ' path=' + path + ' pendingN=' + (row.length > 0 ? row.length : 0))
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  }

  // --- pre-step injection ---------------------------------------------------

  const modalityCache = new Map()

  const supportsImages = async (provider, model, signal) => {
    if (!provider || !model) return false
    const key = provider + '\u0000' + model
    const hit = modalityCache.get(key)
    if (hit && Date.now() - hit.at < MODALITY_TTL) return hit.value
    let value = false
    if (deps.resolveModelInfo) {
      try {
        const info = await deps.resolveModelInfo(provider, model, signal)
        value = Array.isArray(info.inputModalities) && info.inputModalities.includes('image')
      } catch {
        value = false
      }
    }
    modalityCache.set(key, { at: Date.now(), value })
    return value
  }

  async function preStep(payload, next) {
    const decision = await next()
    try {
      if (!decision || decision.kind !== 'enter') return decision
      const agent = payload && payload.agent
      if (!agent) return decision
      const sid = String(agent.id)
      const row = pending.get(sid)
      const claimed = payload.messages
      if (!row || row.length === 0 || !Array.isArray(claimed) || claimed.length === 0) return decision

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
      const blocks = []
      const paths = []

      for (const entry of row) {
        const isImage = limits !== null && limits.mediaTypes.includes(entry.mime)
        if (multimodal && isImage && entry.size <= limits.maxImageBytes && deps.saveImage && deps.readBytes) {
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
      log('dfu pre-step injection failed:', err && err.message ? err.message : err)
    }
    return decision
  }

  return {
    upload: (args) => enqueue(() => upload(args)),
    remove,
    preStep,
  }
}

return {
  apply(ctx) {
    const shell = ctx.get('shell')
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const sessions = ctx.get('sessions')
    const llm = ctx.get('llm')
    const attachments = ctx.get('attachments')
    if (shell === undefined || fs === undefined || sandboxPolicy === undefined) return

    const shellQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'"

    const sessionCwd = (sessionId) => {
      if (sessions === undefined || !sessionId) return undefined
      try {
        const session = sessions.get(String(sessionId))
        const cwd = session && session.header && session.header.cwd
        return typeof cwd === 'string' && cwd ? cwd : undefined
      } catch {
        return undefined
      }
    }

    const core = createHostCore({
      uploadsRoot: async (sessionId) => {
        const policy = sandboxPolicy.resolve()
        return sessionCwd(sessionId) || policy.workspaceRoot
      },
      hashBase64: async (base64) => {
        try {
          const policy = sandboxPolicy.resolve()
          const spec = shell.resolve({
            command: 'base64 -d | sha256sum',
            stdin: base64,
            stdoutMaxBytes: 1024,
            sandboxPolicy: policy,
          })
          const result = await shell.run(spec)
          if (result.exitCode !== 0) return null
          const out = String((result.stdout && result.stdout.text) || '')
          const m = /^[0-9a-f]{64}/.exec(out.trim())
          return m ? m[0] : null
        } catch {
          return null
        }
      },
      saveUploadFile: async (base64, absPath) => {
        try {
          const policy = sandboxPolicy.resolve()
          const dir = absPath.slice(0, absPath.lastIndexOf('/'))
          const spec = shell.resolve({
            command: 'mkdir -p ' + shellQuote(dir) + ' && base64 -d > ' + shellQuote(absPath),
            stdin: base64,
            sandboxPolicy: policy,
          })
          const result = await shell.run(spec)
          return result.exitCode === 0 ? { ok: true } : { ok: false, error: 'save failed (exit ' + result.exitCode + ')' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
      statPath: async (absPath) => {
        try {
          const target = await fs.resolve(absPath)
          const info = await fs.stat(target)
          return info ? { size: info.size } : null
        } catch {
          return null
        }
      },
      readBytes: async (absPath, maxBytes, signal) => {
        try {
          const target = await fs.resolve(absPath)
          return await fs.readBytes(target, signal, maxBytes)
        } catch {
          return null
        }
      },
      readTextFile: async (absPath) => {
        try {
          const target = await fs.resolve(absPath)
          const info = await fs.stat(target)
          if (!info) return null
          return await fs.readText(target)
        } catch {
          return null
        }
      },
      writeTextFile: async (absPath, content) => {
        const policy = sandboxPolicy.resolve()
        const target = await fs.resolve(absPath)
        await fs.writeText(target, content, undefined, undefined, policy)
      },
      resolveModelInfo: (provider, model, signal) => (llm !== undefined ? llm.resolveModelInfo(provider, model, signal) : Promise.reject(new Error('llm unavailable'))),
      attachmentLimits: () => (attachments !== undefined && attachments.imageLimits ? attachments.imageLimits : null),
      saveImage: (input) => attachments.saveImage(input),
      log: (...args) => console.log(...args),
    })

    harness.handle('upload', (args) => core.upload(args))
    harness.handle('remove', (args) => core.remove(args))
    ctx.on('agent/pre-step', (payload, next) => core.preStep(payload, next))
  },
}


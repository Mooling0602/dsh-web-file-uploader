// GENERATED — do not edit. Edit src/core/host-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate src/host.js.
// __CORE__

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

    // Config for the settings UI. Dynamic mode keeps the value in memory for the
    // session (no schema registry), overlaid over env / optional settings.
    let runtimeTtl = '7d'
    const getConfig = () => {
      const settings = ctx.get('settings')
      let ttl
      if (settings !== undefined) {
        try {
          const v = settings.get('dsh-web-file-uploader')
          if (v && typeof v === 'object' && typeof v.ttl === 'string' && v.ttl !== '') ttl = v.ttl
        } catch {
          // fall through
        }
      }
      if ((ttl === undefined || ttl === '') && typeof process !== 'undefined' && process.env && process.env.DSH_UPLOAD_TTL) {
        ttl = process.env.DSH_UPLOAD_TTL
      }
      if (ttl === undefined || ttl === '') ttl = runtimeTtl
      return { ttl }
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
      // Streaming intake inside the sandbox: the dynamic package cannot require
      // node:fs and the fs service writes whole text only, so bytes reach disk
      // through the shell — one decoded chunk appended per RPC call. Memory
      // stays bounded by the chunk size instead of the file size.
      ensureDir: async (absDir) => {
        try {
          const policy = sandboxPolicy.resolve()
          const spec = shell.resolve({
            command: 'mkdir -p ' + shellQuote(absDir),
            sandboxPolicy: policy,
          })
          const result = await shell.run(spec)
          if (result.exitCode !== 0) throw new Error('mkdir failed (exit ' + result.exitCode + ')')
        } catch (err) {
          throw new Error(String((err && err.message) || err))
        }
      },
      appendUploadChunk: async (absPath, base64) => {
        try {
          const policy = sandboxPolicy.resolve()
          const dir = absPath.slice(0, absPath.lastIndexOf('/'))
          const spec = shell.resolve({
            command: 'mkdir -p ' + shellQuote(dir) + ' && base64 -d >> ' + shellQuote(absPath),
            stdin: base64,
            sandboxPolicy: policy,
          })
          const result = await shell.run(spec)
          return result.exitCode === 0 ? { ok: true } : { ok: false, error: 'append failed (exit ' + result.exitCode + ')' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
      hashFile: async (absPath) => {
        try {
          const policy = sandboxPolicy.resolve()
          const spec = shell.resolve({
            command: 'sha256sum ' + shellQuote(absPath),
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
      moveFile: async (from, to) => {
        try {
          const policy = sandboxPolicy.resolve()
          const spec = shell.resolve({
            command: 'mv -f ' + shellQuote(from) + ' ' + shellQuote(to),
            sandboxPolicy: policy,
          })
          const result = await shell.run(spec)
          return result.exitCode === 0 ? { ok: true } : { ok: false, error: 'move failed (exit ' + result.exitCode + ')' }
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
      deleteFile: async (absPath) => {
        try {
          const policy = sandboxPolicy.resolve()
          const spec = shell.resolve({
            command: 'rm -f ' + shellQuote(absPath),
            sandboxPolicy: policy,
          })
          const result = await shell.run(spec)
          return result.exitCode === 0 ? { ok: true } : { ok: false, error: 'delete failed (exit ' + result.exitCode + ')' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
      listUploadRoots: async () => {
        const roots = new Set()
        const ws = sandboxPolicy.workspaceRoot
        if (ws) roots.add(ws)
        if (sessions !== undefined) {
          try {
            for (const s of sessions.list()) {
              const cwd = s && s.header && s.header.cwd
              if (typeof cwd === 'string' && cwd) roots.add(cwd)
            }
          } catch {
            // ignore
          }
        }
        return Array.from(roots)
      },
      readConfig: getConfig,
      resolveModelInfo: (provider, model, signal) => (llm !== undefined ? llm.resolveModelInfo(provider, model, signal) : Promise.reject(new Error('llm unavailable'))),
      attachmentLimits: () => (attachments !== undefined && attachments.imageLimits ? attachments.imageLimits : null),
      saveImage: (input) => attachments.saveImage(input),
      log: (...args) => console.log(...args),
    })

    harness.handle('upload', (args) => core.upload(args))
    // Chunked streaming intake (the dynamic client slices the File and sends
    // one base64 chunk per call; finish hashes and publishes it).
    harness.handle('upload-begin', (args) => core.beginStream(args))
    harness.handle('upload-chunk', (args) => core.appendStream(args))
    harness.handle('upload-finish', (args) => core.commitStream(args))
    harness.handle('upload-abort', (args) => core.abortStream(args))
    harness.handle('remove', (args) => core.remove(args))
    harness.handle('delete', (args) => core.delete(args))
    harness.handle('dfu-config-get', () => getConfig())
    harness.handle('dfu-config-set', (args) => {
      const raw = args && typeof args.ttl === 'string' ? args.ttl : ''
      runtimeTtl = raw.trim()
      return getConfig()
    })
    ctx.on('agent/pre-step', (payload, next) => core.preStep(payload, next))

    // Startup sweep: reclaim anything already past TTL when the plugin mounts.
    try {
      core.collect()
    } catch {
      // non-fatal
    }
  },
}

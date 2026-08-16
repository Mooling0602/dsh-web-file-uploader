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

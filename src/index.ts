// dsh-web-file-uploader — static host half (published dsh bundle)
//
// Thin seam over the canonical host core (src/core/host.ts): wires the
// transport (webServer HTTP routes), the filesystem (node:fs), hashing
// (node:crypto) and the attachment/llm services. All business logic lives in
// the core — edit that, not this file.
//
// Uploads are written directly into the DSH home data dir ($DSH_HOME/uploads,
// default ~/.dsh/uploads) with node:fs — the proper dsh data directory,
// bypassing the sandboxed fs abstraction.

import { createHash } from 'node:crypto'
import {
  copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { createHostCore, errCode, errMsg } from './core/host.js'
import type {
  AttachmentsService, LlmService, PluginContext, PreStepDecision, PreStepPayload, WebServer,
} from './types.js'

export const name = 'dsh-web-file-uploader'

export const inject = ['webServer']

const dshHome = (): string => process.env.DSH_HOME || join(homedir(), '.dsh')

// Retention is persisted in our own JSON file inside the DSH home data dir,
// so the static bundle has NO external dependency on @deepseek-ai/schemastery
// or @deepseek-ai/dsh-settings (which are not resolvable from a local bundle).
const configPath = (): string => join(dshHome(), 'dsh-web-file-uploader.json')

const sanitizeName = (raw: unknown): string | null => {
  const n = String(raw || '').replace(/[\/\\\0]/g, '_').trim()
  if (!n || n === '.' || n === '..' || n.length > 255) return null
  return n
}

const uploadsDir = (): string => {
  const dir = join(dshHome(), 'uploads')
  mkdirSync(dir, { recursive: true })
  return dir
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length })
  res.end(payload)
}

export function apply(ctx: PluginContext): void {
  const webServer = ctx.get<WebServer>('webServer')
  const llm = ctx.get<LlmService>('llm')
  const attachments = ctx.get<AttachmentsService>('attachments')
  if (webServer === undefined) return

  // Resolve the plugin config: persisted file > env > default.
  //   ttl              auto-cleanup retention
  //   replaceOfficial  replace the shell's "Add -> File" menu entry with ours
  //   alwaysShowButton keep the standalone composer button visible at all times
  //                    (see src/core/client.ts)
  let runtimeConfig = { ttl: '7d', replaceOfficial: false, alwaysShowButton: true }
  const readConfigFile = (): Record<string, unknown> | null => {
    try {
      const text = existsSync(configPath()) ? readFileSync(configPath(), 'utf8') : ''
      const parsed = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // ignore malformed file
    }
    return null
  }
  const getConfig = (): { ttl: string; replaceOfficial: boolean; alwaysShowButton: boolean } => {
    const fromFile = readConfigFile()
    let ttl = fromFile && typeof fromFile.ttl === 'string' && fromFile.ttl !== '' ? fromFile.ttl : undefined
    if (ttl === undefined && process.env && process.env.DSH_UPLOAD_TTL) ttl = process.env.DSH_UPLOAD_TTL
    if (ttl === undefined) ttl = runtimeConfig.ttl
    const replaceOfficial = fromFile && typeof fromFile.replaceOfficial === 'boolean'
      ? fromFile.replaceOfficial
      : runtimeConfig.replaceOfficial
    const alwaysShowButton = fromFile && typeof fromFile.alwaysShowButton === 'boolean'
      ? fromFile.alwaysShowButton
      : runtimeConfig.alwaysShowButton
    return { ttl, replaceOfficial, alwaysShowButton }
  }
  // Partial update: a caller that only knows about one field must not clear the
  // other, so the patch is merged over the resolved config.
  const setConfig = (patch: { ttl?: string; replaceOfficial?: boolean; alwaysShowButton?: boolean }): void => {
    const next = getConfig()
    if (patch && patch.ttl != null) next.ttl = String(patch.ttl).trim()
    if (patch && typeof patch.replaceOfficial === 'boolean') next.replaceOfficial = patch.replaceOfficial
    if (patch && typeof patch.alwaysShowButton === 'boolean') next.alwaysShowButton = patch.alwaysShowButton
    runtimeConfig = next
    try {
      // A fresh DSH_HOME may not exist yet; the write is the only thing that
      // needs it, so create it here rather than at module load.
      mkdirSync(dirname(configPath()), { recursive: true })
      writeFileSync(configPath(), JSON.stringify(next, null, 2))
    } catch {
      // non-fatal; in-memory value still applies
    }
  }

  const core = createHostCore({
    uploadsRoot: async () => dshHome(),
    // Streaming intake: the request body is written straight through while the
    // route hashes it, so file size is bounded by disk, not by memory.
    ensureDir: async (absDir) => {
      mkdirSync(absDir, { recursive: true })
    },
    hashFile: async (absPath) => {
      try {
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(absPath)) hash.update(chunk)
        return hash.digest('hex')
      } catch {
        return null
      }
    },
    moveFile: async (from, to) => {
      try {
        renameSync(from, to)
        return { ok: true }
      } catch (err) {
        // rename cannot cross filesystems; fall back to copy + unlink.
        if (errCode(err) === 'EXDEV') {
          try {
            copyFileSync(from, to)
            unlinkSync(from)
            return { ok: true }
          } catch (err2) {
            return { ok: false, error: errMsg(err2) }
          }
        }
        return { ok: false, error: errMsg(err) }
      }
    },
    statPath: async (absPath) => {
      try {
        return existsSync(absPath) ? { size: statSync(absPath).size } : null
      } catch {
        return null
      }
    },
    readBytes: async (absPath) => readFileSync(absPath),
    readTextFile: async (absPath) => {
      try {
        return existsSync(absPath) ? readFileSync(absPath, 'utf8') : null
      } catch {
        return null
      }
    },
    writeTextFile: async (absPath, content) => {
      mkdirSync(absPath.slice(0, absPath.lastIndexOf('/')), { recursive: true })
      writeFileSync(absPath, content)
    },
    deleteFile: async (absPath) => {
      try {
        unlinkSync(absPath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: errMsg(err) }
      }
    },
    listUploadRoots: async () => [dshHome()],
    readConfig: getConfig,
    resolveModelInfo: (provider, model, signal) => (llm !== undefined ? llm.resolveModelInfo(provider, model, signal) : Promise.reject(new Error('llm unavailable'))),
    attachmentLimits: () => (attachments !== undefined && attachments.imageLimits ? attachments.imageLimits : null),
    saveImage: (input) => {
      if (attachments === undefined) return Promise.reject(new Error('attachments unavailable'))
      return attachments.saveImage(input)
    },
    probe: () => {},
    log: (...args) => console.log(...args),
  })

  // --- upload route ---------------------------------------------------------

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/upload',
    handler: async (req, res) => {
      let staging: string | null = null
      try {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const url = new URL(req.url || '/', 'http://localhost')
        const rawName = sanitizeName(url.searchParams.get('name'))
        const sessionId = url.searchParams.get('session') || ''
        const mime = url.searchParams.get('mime') || ''
        const declared = Number(url.searchParams.get('size')) || 0
        if (!rawName) {
          sendJson(res, 400, { ok: false, error: 'invalid file name' })
          return
        }

        // Streaming intake: the body goes to a staging file as it arrives while
        // the same pass hashes it — no base64, no whole-file buffer, so the only
        // bound left is disk space. commitStream publishes it under its final
        // name, or drops the staged copy when identical content is already
        // stored.
        const begun = await core.beginStream({ sessionId, name: rawName, mime, size: declared })
        if (!begun.ok) {
          sendJson(res, 400, begun)
          return
        }
        staging = begun.id!
        const hash = createHash('sha256')
        const out = createWriteStream(begun.tempPath!)
        try {
          for await (const chunk of req) {
            hash.update(chunk)
            if (!out.write(chunk)) await once(out, 'drain')
          }
          await new Promise<void>((resolve, reject) => {
            out.end((err?: Error) => (err ? reject(err) : resolve()))
          })
        } catch (err) {
          out.destroy()
          throw err
        }
        const result = await core.commitStream({ id: staging, sha256: hash.digest('hex') })
        staging = null
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        // A closed tab or a failed write must not leave a partial file behind.
        if (staging) {
          try {
            await core.abortStream({ id: staging })
          } catch {
            // best effort
          }
        }
        try {
          sendJson(res, 500, { ok: false, error: errMsg(err) })
        } catch {
          // the client is gone; the staged file is already dropped
        }
      }
    },
  }), 'dfu: upload route')

  // --- remove route: called when the user closes an attachment card --------

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/remove',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const url = new URL(req.url || '/', 'http://localhost')
        const sessionId = url.searchParams.get('session') || ''
        const path = url.searchParams.get('path') || ''
        if (!sessionId || !path) {
          sendJson(res, 400, { ok: false, error: 'missing session or path' })
          return
        }
        const result = await core.remove({ sessionId, path })
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: errMsg(err) })
      }
    },
  }), 'dfu: remove route (keep file)')

  // --- delete route: trash can button permanently deletes the file --------

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/delete',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const url = new URL(req.url || '/', 'http://localhost')
        const sessionId = url.searchParams.get('session') || ''
        const path = url.searchParams.get('path') || ''
        if (!sessionId || !path) {
          sendJson(res, 400, { ok: false, error: 'missing session or path' })
          return
        }
        const result = await core.delete({ sessionId, path })
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: errMsg(err) })
      }
    },
  }), 'dfu: delete route (permanent)')

  // --- list / delete-many routes: the settings "manage files" panel ---------

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/files',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET') {
          res.writeHead(405)
          res.end()
          return
        }
        const result = await core.list()
        sendJson(res, 200, result)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: errMsg(err) })
      }
    },
  }), 'dfu: list route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/delete-many',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        let body = ''
        for await (const chunk of req) body += chunk
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(body || '{}')
        } catch {
          parsed = {}
        }
        const paths = Array.isArray(parsed.paths) ? parsed.paths.filter((p): p is string => typeof p === 'string' && !!p) : []
        if (paths.length === 0) {
          sendJson(res, 400, { ok: false, error: 'no paths given' })
          return
        }
        const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
        const result = await core.deleteMany({ sessionId, paths })
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: errMsg(err) })
      }
    },
  }), 'dfu: delete-many route')

  // --- config route: settings UI reads / updates retention -----------------

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/config',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const url = new URL(req.url || '/', 'http://localhost')
        const action = url.searchParams.get('action')
        if (action === 'get') {
          sendJson(res, 200, getConfig())
          return
        }
        if (action === 'set' && req.method === 'POST') {
          let body = ''
          for await (const chunk of req) {
            body += chunk
          }
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(body || '{}')
          } catch {
            parsed = {}
          }
          const patch: { ttl?: string; replaceOfficial?: boolean; alwaysShowButton?: boolean } = {}
          if (parsed.ttl != null) patch.ttl = String(parsed.ttl)
          if (typeof parsed.replaceOfficial === 'boolean') patch.replaceOfficial = parsed.replaceOfficial
          if (typeof parsed.alwaysShowButton === 'boolean') patch.alwaysShowButton = parsed.alwaysShowButton
          setConfig(patch)
          sendJson(res, 200, getConfig())
          return
        }
        sendJson(res, 400, { ok: false, error: 'bad action' })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: errMsg(err) })
      }
    },
  }), 'dfu: config route')

  // --- pre-step injection ---------------------------------------------------

  ctx.on('agent/pre-step', (payload, next) =>
    core.preStep(payload as PreStepPayload, next as () => Promise<PreStepDecision>),
  )

  // Startup sweep over $DSH_HOME/uploads.
  try {
    core.collect()
  } catch {
    // non-fatal
  }
}

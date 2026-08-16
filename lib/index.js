// dsh-web-file-uploader — static host half (published dsh bundle)
//
// Thin seam over the canonical host core (src/core/host-core.js): wires the
// transport (webServer HTTP routes), the filesystem (node:fs), hashing
// (node:crypto) and the attachment/llm services. All business logic lives in
// the core — edit that, not this file.
//
// Uploads are written directly into the DSH home data dir ($DSH_HOME/uploads,
// default ~/.dsh/uploads) with node:fs — the proper dsh data directory,
// bypassing the sandboxed fs abstraction.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHostCore } from '../src/core/host-core.js'

export const name = 'dsh-web-file-uploader'

export const inject = ['webServer']

const MAX_BYTES = 48 * 1024 * 1024 // per-file cap

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')

const sanitizeName = (raw) => {
  const n = String(raw || '').replace(/[\/\\\0]/g, '_').trim()
  if (!n || n === '.' || n === '..' || n.length > 255) return null
  return n
}

const uploadsDir = () => {
  const dir = join(dshHome(), 'uploads')
  mkdirSync(dir, { recursive: true })
  return dir
}

const sendJson = (res, status, body) => {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length })
  res.end(payload)
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const llm = ctx.get('llm')
  const attachments = ctx.get('attachments')
  if (webServer === undefined) return

  const core = createHostCore({
    uploadsRoot: async () => dshHome(),
    hashBase64: async (base64) => createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex'),
    saveUploadFile: async (base64, absPath) => {
      try {
        const buf = Buffer.from(base64, 'base64')
        mkdirSync(absPath.slice(0, absPath.lastIndexOf('/')), { recursive: true })
        writeFileSync(absPath, buf)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) }
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
    resolveModelInfo: (provider, model, signal) => (llm !== undefined ? llm.resolveModelInfo(provider, model, signal) : Promise.reject(new Error('llm unavailable'))),
    attachmentLimits: () => (attachments !== undefined && attachments.imageLimits ? attachments.imageLimits : null),
    saveImage: (input) => attachments.saveImage(input),
    probe: () => {},
    log: (...args) => console.log(...args),
  })

  // --- upload route ---------------------------------------------------------

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/dsh-web-file-uploader/upload',
    handler: async (req, res) => {
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
        if (!rawName) {
          sendJson(res, 400, { ok: false, error: 'invalid file name' })
          return
        }

        // Stream the body with a hard cap (binary-safe).
        const chunks = []
        let total = 0
        for await (const chunk of req) {
          total += chunk.length
          if (total > MAX_BYTES) {
            req.destroy()
            sendJson(res, 413, { ok: false, error: 'file exceeds the ~48 MiB cap' })
            return
          }
          chunks.push(chunk)
        }
        const base64 = Buffer.concat(chunks).toString('base64')
        const result = await core.upload({ sessionId, name: rawName, mime, base64 })
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
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
        sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }), 'dfu: remove route')

  // --- pre-step injection ---------------------------------------------------

  ctx.on('agent/pre-step', (payload, next) => core.preStep(payload, next))
}

#!/usr/bin/env node
// test/host.test.ts — regression suite for the host core's dedup index,
// pending-reference guard, and the two settings routes' core functions
// (list / deleteMany).
//
// Runs with no browser and no network: the core takes every environment
// interaction through deps, so this file supplies an in-memory-ish filesystem
// backed by a throwaway temp dir. Run it after touching src/core/host.ts.
//
// Uploads go through the streaming intake (beginStream → write → commitStream)
// — the same path the static bundle's HTTP route takes: the transport owns the
// bytes, the core owns staging, naming, dedup, the index and pending
// bookkeeping.
//
// The safety rule under test: a copy another live session still references is
// never physically removed, and a *skipped* delete must not release the very
// reference that protected it. The unconditional-drop shape was written first
// and caught before the feature landed; this assertion keeps it caught.

import { createHostCore, errMsg } from '../src/core/host.ts'
import type { UploadResult } from '../src/core/host.ts'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(tmpdir(), 'dfu-host-core-test')
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT + '/uploads', { recursive: true })

let cfg = { ttl: '7d' }
const core = createHostCore({
  uploadsRoot: async () => ROOT,
  ensureDir: async (d) => { mkdirSync(d, { recursive: true }) },
  hashFile: async (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch { return null } },
  moveFile: async (from, to) => { try { const fs = await import('node:fs'); fs.renameSync(from, to); return { ok: true } } catch (e) { return { ok: false, error: errMsg(e) } } },
  statPath: async (p) => { try { return existsSync(p) ? { size: statSync(p).size } : null } catch { return null } },
  readBytes: async (p) => readFileSync(p),
  readTextFile: async (p) => { try { return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null } },
  writeTextFile: async (p, c) => { mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true }); writeFileSync(p, c) },
  deleteFile: async (p) => { try { const fs = await import('node:fs'); fs.unlinkSync(p); return { ok: true } } catch (e) { return { ok: false, error: errMsg(e) } } },
  listUploadRoots: async () => [ROOT],
  readConfig: () => cfg,
  probe: () => {},
  log: () => {},
})

let pass = 0, fail = 0
const results: string[] = []
const ok = (name: string, cond: unknown, extra?: unknown) => { if (cond) { pass++; results.push('PASS  ' + name) } else { fail++; results.push('FAIL  ' + name + (extra !== undefined ? '  <- ' + JSON.stringify(extra) : '')) } }
const S1 = 'sess-A', S2 = 'sess-B'

// The static route's intake in miniature: stage, write the bytes, commit with
// the content hash (the route hashes the body while streaming it to disk).
const streamUpload = async (c: typeof core, sessionId: string, name: string, mime: string, content: string): Promise<UploadResult> => {
  const begun = await c.beginStream({ sessionId, name, mime, size: Buffer.byteLength(content) })
  if (!begun.ok || begun.tempPath === undefined || begun.id === undefined) return { ok: false, error: 'begin failed' }
  writeFileSync(begun.tempPath, content)
  return c.commitStream({ id: begun.id, sha256: createHash('sha256').update(content).digest('hex') })
}

const u1 = await streamUpload(core, S1, 'alpha.txt', 'text/plain', 'alpha-content-AAAA')
ok('upload returns ok', u1.ok === true, JSON.stringify(u1))
ok('upload file exists on disk', u1.ok && existsSync(u1.path!))
ok('upload is not dedup', u1.dedup === false)

let l = await core.list()
const row = l.files.find((f) => f.path === u1.path)
ok('list contains uploaded file', !!row)
ok('list marks it in use', row && row.inUse === true)
ok('list reports holder session', row && row.sessions.includes(S1), JSON.stringify(row && row.sessions))
ok('list reports size', row && row.size === Buffer.from('alpha-content-AAAA').length)
ok('list reports exists', row && row.exists === true)
ok('list returns ttl', l.ttl === 7 * 86400000, String(l.ttl))

let d = await core.deleteMany({ sessionId: S1, paths: [u1.path!] })
ok('delete-many skips in-use row', d.removed === 0 && d.skipped === 1, JSON.stringify(d))
ok('delete-many reports reason in-use', d.results[0] && d.results[0].reason === 'in-use')
ok('skipped file still on disk', u1.path !== undefined && existsSync(u1.path))
l = await core.list()
ok('ref survived the skipped delete', l.files.find((f) => f.path === u1.path)!.inUse === true)

// second session dedups onto the same path
const u2 = await streamUpload(core, S1, 'beta.txt', 'text/plain', 'beta-content-BBBB')
await streamUpload(core, S2, 'beta-copy.txt', 'text/plain', 'beta-content-BBBB')
let l2 = await core.list()
const betaRow = l2.files.find((f) => f.path === u2.path)
ok('dedup shares one path across sessions', betaRow && betaRow.sessions.length === 2, JSON.stringify(betaRow && betaRow.sessions))
await core.remove({ sessionId: S1, path: u2.path! })
l2 = await core.list()
ok('after S1 releases, S2 still holds it', l2.files.find((f) => f.path === u2.path)!.inUse === true)
d = await core.deleteMany({ sessionId: S2, paths: [u2.path!] })
ok('still refused while S2 holds it', d.removed === 0 && u2.path !== undefined && existsSync(u2.path))

// now release BOTH sessions, then delete both
await core.remove({ sessionId: S1, path: u1.path! })
await core.remove({ sessionId: S2, path: u2.path! })
l = await core.list()
ok('both rows selectable once released', l.files.filter((f) => f.path === u1.path || f.path === u2.path).every((f) => f.inUse === false))

d = await core.deleteMany({ sessionId: S2, paths: [u1.path!, u2.path!] })
ok('fully released rows are removed', d.removed === 2 && d.failed === 0 && d.skipped === 0, JSON.stringify(d))
ok('files gone from disk', u1.path !== undefined && u2.path !== undefined && !existsSync(u1.path) && !existsSync(u2.path))
const idx = JSON.parse(readFileSync(ROOT + '/uploads/.dfu-index.json', 'utf8'))
ok('index scrubbed of deleted paths', Object.values(idx).every((e) => (e as { path: string }).path !== u1.path && (e as { path: string }).path !== u2.path), JSON.stringify(idx))

d = await core.deleteMany({ sessionId: S2, paths: [u1.path!] })
ok('deleting an already-missing path is idempotent success', d.removed === 1 && d.failed === 0, JSON.stringify(d))

const u3 = await streamUpload(core, S1, 'gamma.txt', 'text/plain', 'gamma-content-CCCC')
const u4 = await streamUpload(core, S1, 'gamma2.txt', 'text/plain', 'gamma-content-CCCC')
ok('same content dedups to one path', u3.path === u4.path, u3.path + ' vs ' + u4.path)
ok('dedup flagged on second upload', u4.dedup === true)

writeFileSync(ROOT + '/uploads/ghost.txt', 'ghost-content')
const ug = await streamUpload(core, S1, 'ghost.txt', 'text/plain', 'ghost-content')
await core.remove({ sessionId: S1, path: ug.path! })
rmSync(ug.path!)
l = await core.list()
const ghost = l.files.find((f) => f.path === ug.path)
ok('deleted-from-disk entry still listed', !!ghost)
ok('and marked exists=false', ghost && ghost.exists === false)
ok('missing row is not selectable-eligible (client rule: !exists)', ghost && ghost.exists === false)

l = await core.list()
const ats = l.files.map((f) => f.at)
ok('list sorted newest-first', ats.every((v, i) => i === 0 || ats[i - 1] >= v), JSON.stringify(ats))

const oldIdx = JSON.parse(readFileSync(ROOT + '/uploads/.dfu-index.json', 'utf8'))
for (const k of Object.keys(oldIdx)) (oldIdx[k] as { at: number }).at = 1
writeFileSync(ROOT + '/uploads/.dfu-index.json', JSON.stringify(oldIdx))
l = await core.list()
const overdueRows = l.files.filter((f) => f.at === 1)
ok('old entries flagged overdue', overdueRows.length > 0 && overdueRows.every((f) => f.overdue === true))

cfg = { ttl: '0' }
l = await core.list()
ok('ttl=0 disables overdue', l.files.every((f) => f.overdue === false) && l.ttl === 0, String(l.ttl))
cfg = { ttl: '7d' }

d = await core.deleteMany({ sessionId: S1, paths: [] })
ok('empty selection is a no-op', d.removed === 0 && d.failed === 0 && d.skipped === 0, JSON.stringify(d))
d = await core.deleteMany({ sessionId: S1, paths: [null, 42, {}, ''] })
ok('non-path junk ignored', d.removed === 0 && d.failed === 0, JSON.stringify(d))

// multi-root: two uploads roots each with an index
const ROOT2 = join(tmpdir(), 'dfu-host-core-test-2')
rmSync(ROOT2, { recursive: true, force: true })
mkdirSync(ROOT2 + '/uploads', { recursive: true })
writeFileSync(ROOT2 + '/uploads/other.txt', 'other-content')
const otherHash = createHash('sha256').update(Buffer.from('other-content')).digest('hex')
writeFileSync(ROOT2 + '/uploads/.dfu-index.json', JSON.stringify({ [otherHash]: { path: ROOT2 + '/uploads/other.txt', at: Date.now() } }))
const core2 = createHostCore({
  uploadsRoot: async () => ROOT2,
  ensureDir: async (d) => { mkdirSync(d, { recursive: true }) },
  hashFile: async () => null,
  moveFile: async () => ({ ok: true }),
  statPath: async (p) => { try { return existsSync(p) ? { size: statSync(p).size } : null } catch { return null } },
  readBytes: async (p) => readFileSync(p),
  readTextFile: async (p) => { try { return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null } },
  writeTextFile: async (p, c) => writeFileSync(p, c),
  deleteFile: async (p) => { try { const fs = await import('node:fs'); fs.unlinkSync(p); return { ok: true } } catch (e) { return { ok: false, error: errMsg(e) } } },
  listUploadRoots: async () => [ROOT, ROOT2],
  readConfig: () => cfg,
  probe: () => {},
  log: () => {},
})
const multi = await core2.list()
ok('list merges multiple upload roots', multi.files.some((f) => f.path.includes(ROOT2)), JSON.stringify(multi.files.map((f) => f.name)))

rmSync(ROOT, { recursive: true, force: true })
rmSync(ROOT2, { recursive: true, force: true })

console.log(results.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

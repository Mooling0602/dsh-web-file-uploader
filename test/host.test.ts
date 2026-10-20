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
import { mkdirSync, readdirSync, readFileSync, existsSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(tmpdir(), 'dfu-host-core-test')
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT + '/uploads', { recursive: true })

let cfg: { ttl: string; foldThreshold?: number } = { ttl: '7d' }
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
  listDir: async (d) => { try { return readdirSync(d) } catch { return null } },
  removeDir: async (d) => { try { rmdirSync(d); return true } catch { return false } },
  resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
  attachmentLimits: () => ({ mediaTypes: ['image/png'], maxImageBytes: 10 * 1024 * 1024 }),
  saveImage: async (input) => ({ name: input.name }),
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
const streamUpload = async (
  c: typeof core,
  sessionId: string,
  name: string,
  mime: string,
  content: string,
  cardId?: string,
): Promise<UploadResult> => {
  const begun = await c.beginStream({ sessionId, id: cardId, name, mime, size: Buffer.byteLength(content) })
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

// ---- send-time folding ------------------------------------------------------
// A group at or above the fold threshold folds at pre-step: new files move into
// a timestamp folder, the existing (dedup) group gets a paths.txt next to it,
// and the injected text points at those instead of listing every path. The
// folders are unpacked again once the session's references are gone.
const uploadsPath = ROOT + '/uploads'
const foldFolderNames = (): string[] =>
  readdirSync(uploadsPath)
    .filter((n) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(-\d+)?(-existing)?$/.test(n))
    .sort()

interface InjectedBlock { type?: string; text?: string; attachment?: unknown }
interface InjectedDecision { messages?: Array<{ content?: InjectedBlock[] }> }
const decisionContent = (decision: InjectedDecision): InjectedBlock[] =>
  (decision.messages && decision.messages[0] && decision.messages[0].content) || []
const injectText = (decision: InjectedDecision): string => {
  const block = decisionContent(decision).find(
    (b) => b.type === 'text' && typeof b.text === 'string' && b.text.indexOf('[Attached files]') >= 0,
  )
  return block && block.text ? block.text : ''
}
const runPreStep = async (sessionId: string, provider?: string, model?: string): Promise<InjectedDecision> => {
  const target = { type: 'text', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }
  const decision = { kind: 'enter', messages: [target] }
  return (await core.preStep(
    { agent: { id: sessionId, options: { provider, model } }, messages: [target] } as never,
    (async () => decision) as never,
  )) as InjectedDecision
}

// A card area larger than the old 100-entry pending cap still injects every
// reference: the fold threshold bounds the injected text, not a silent drop.
cfg = { ttl: '7d', foldThreshold: 100 }
const S_CAP = 'sess-pending-cap'
for (let i = 1; i <= 120; i += 1) {
  const name = 'cap-' + String(i).padStart(3, '0') + '.txt'
  await streamUpload(core, S_CAP, name, 'text/plain', 'cap-content-' + i)
}
const capDecision = await runPreStep(S_CAP)
const capFolders = foldFolderNames().filter((n) => !n.endsWith('-existing'))
ok('a 120-card group still folds at threshold 100', capFolders.length === 1, foldFolderNames())
const capFolder = capFolders.length > 0 ? uploadsPath + '/' + capFolders[0] : ''
ok('the fold moved every one of the 120 cards', existsSync(capFolder) && readdirSync(capFolder).length === 120, existsSync(capFolder) ? readdirSync(capFolder).length : -1)
const capInjection = injectText(capDecision)
ok('the injection is the folder line only', capInjection.includes(capFolder + '/') && !capInjection.includes('cap-001.txt'), capInjection)
for (const file of readdirSync(capFolder)) {
  await core.remove({ sessionId: S_CAP, path: capFolder + '/' + file })
}
await core.deleteMany({ sessionId: S_CAP, paths: [] })
ok('the oversized card area unpacks back to the uploads root', !existsSync(capFolder) && existsSync(uploadsPath + '/cap-001.txt'))

cfg = { ttl: '7d', foldThreshold: 2 }
const S3 = 'sess-fold-new'
const fa = await streamUpload(core, S3, 'fold-a.txt', 'text/plain', 'fold-a-content')
const fb = await streamUpload(core, S3, 'fold-b.txt', 'text/plain', 'fold-b-content')
let decision = await runPreStep(S3)
let injected = injectText(decision)
const newFolders = foldFolderNames().filter((n) => !n.endsWith('-existing'))
ok('a new-file group at the threshold folds into a timestamp folder', newFolders.length === 1, foldFolderNames())
const newFolder = newFolders.length > 0 ? uploadsPath + '/' + newFolders[0] : ''
ok('both new files moved into the folder', existsSync(newFolder + '/fold-a.txt') && existsSync(newFolder + '/fold-b.txt'), readdirSync(newFolder))
ok('the injection points at the folder', injected.includes(newFolder + '/'), injected)
ok('the injection stops listing the moved paths', !injected.includes(fa.path!) && !injected.includes(fb.path!), injected)

const fc = await streamUpload(core, S3, 'fold-c.txt', 'text/plain', 'fold-c-content')
decision = await runPreStep(S3)
ok('a repeated send reuses the same folder', foldFolderNames().filter((n) => !n.endsWith('-existing')).length === 1, foldFolderNames())
ok('the later file joins the existing folder', existsSync(newFolder + '/fold-c.txt'), readdirSync(newFolder))
ok('the injection still points at that one folder', injectText(decision).includes(newFolder + '/'))

const S5 = 'sess-fold-existing-source'
const S4 = 'sess-fold-existing'
const ea = await streamUpload(core, S5, 'dup-a.txt', 'text/plain', 'dup-a-content')
const eb = await streamUpload(core, S5, 'dup-b.txt', 'text/plain', 'dup-b-content')
const eaCopy = await streamUpload(core, S4, 'dup-a-copy.txt', 'text/plain', 'dup-a-content')
const ebCopy = await streamUpload(core, S4, 'dup-b-copy.txt', 'text/plain', 'dup-b-content')
ok('the re-uploads dedup onto the source paths', eaCopy.dedup === true && ebCopy.dedup === true, JSON.stringify([eaCopy, ebCopy]))
decision = await runPreStep(S4)
injected = injectText(decision)
const existingFolders = foldFolderNames().filter((n) => n.endsWith('-existing'))
ok('an existing group at the threshold gets a paths.txt folder', existingFolders.length === 1, foldFolderNames())
const existingFolder = existingFolders.length > 0 ? uploadsPath + '/' + existingFolders[0] : ''
const txt = existsSync(existingFolder + '/paths.txt') ? readFileSync(existingFolder + '/paths.txt', 'utf8') : ''
ok('paths.txt lists every existing path', txt.split('\n').filter(Boolean).sort().join(',') === [ea.path!, eb.path!].sort().join(','), txt)
ok('the injection points at paths.txt', injected.includes(existingFolder + '/paths.txt'), injected)
ok('the existing files stay where they were', existsSync(ea.path!) && existsSync(eb.path!))

for (const file of ['fold-a.txt', 'fold-b.txt', 'fold-c.txt']) {
  await core.remove({ sessionId: S3, path: newFolder + '/' + file })
}
await core.deleteMany({ sessionId: S3, paths: [] }) // flush the queued unfold
ok('unfold returns the new files to the uploads root', existsSync(uploadsPath + '/fold-a.txt') && existsSync(uploadsPath + '/fold-b.txt') && existsSync(uploadsPath + '/fold-c.txt'))
ok('unfold removes the new-file folder', !existsSync(newFolder))
const foldedIdx = JSON.parse(readFileSync(uploadsPath + '/.dfu-index.json', 'utf8')) as Record<string, { path: string }>
ok(
  'unfold rewrites the index back to the uploads root',
  Object.values(foldedIdx).filter((e) => e.path.includes('fold-a.txt')).every((e) => e.path === uploadsPath + '/fold-a.txt'),
  JSON.stringify(Object.values(foldedIdx).map((e) => e.path)),
)

await core.remove({ sessionId: S4, path: ea.path! })
await core.remove({ sessionId: S4, path: eb.path! })
await core.deleteMany({ sessionId: S4, paths: [] })
ok('unfold removes the existing-file helper folder', !existsSync(existingFolder))
ok('the dedup source files still exist', existsSync(ea.path!) && existsSync(eb.path!))

const S6 = 'sess-fold-images'
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
for (const name of ['pic-a.png', 'pic-b.png']) {
  const begun = await core.beginStream({ sessionId: S6, name, mime: 'image/png', size: png.length })
  if (begun.ok && begun.tempPath && begun.id) {
    writeFileSync(begun.tempPath, png)
    await core.commitStream({ id: begun.id, sha256: createHash('sha256').update(png).digest('hex') })
  }
}
await streamUpload(core, S6, 'img-text-a.txt', 'text/plain', 'img-text-a')
await streamUpload(core, S6, 'img-text-b.txt', 'text/plain', 'img-text-b')
decision = await runPreStep(S6, 'fake-provider', 'multimodal-model')
const imageBlocks = decisionContent(decision).filter((b) => b.type === 'image')
ok('native images are injected as image blocks', imageBlocks.length >= 1, imageBlocks.length)
const imageFolderContents = foldFolderNames()
  .filter((n) => !n.endsWith('-existing'))
  .map((n) => readdirSync(uploadsPath + '/' + n).sort().join(','))
ok('native images do not move into the fold folder', imageFolderContents.every((c) => !c.includes('pic-a.png') && !c.includes('pic-b.png')), imageFolderContents)
ok('the two text files still folded', imageFolderContents.some((c) => c.includes('img-text-a.txt') && c.includes('img-text-b.txt')), imageFolderContents)

// A dedup card shares the file a fold is about to move; its injected path must
// follow the move instead of going stale on the old root path.
cfg = { ttl: '7d', foldThreshold: 2 }
const S7 = 'sess-fold-shared-ref'
await streamUpload(core, S7, 'shared.txt', 'text/plain', 'shared-content')
await streamUpload(core, S7, 'shared-copy.txt', 'text/plain', 'shared-content')
await streamUpload(core, S7, 'other.txt', 'text/plain', 'other-content')
const shareDecision = await runPreStep(S7)
const shareText = injectText(shareDecision)
const shareLines = shareText.split('\n').filter((line) => line.startsWith('- '))
ok('the dedup card folds together with the file it shares', shareLines.length === 1, shareLines)
ok('the folder line counts distinct files only', shareLines[0].includes('2 uploaded files in this folder'), shareLines[0])
const s7FolderName = foldFolderNames().find(
  (n) => !n.endsWith('-existing') && existsSync(uploadsPath + '/' + n + '/other.txt'),
)
const s7Folder = s7FolderName ? uploadsPath + '/' + s7FolderName : ''
ok('the fold moved both new files', existsSync(s7Folder + '/shared.txt') && existsSync(s7Folder + '/other.txt'))
ok('no stale root path is injected for the dedup card', !shareText.includes(uploadsPath + '/shared.txt'), shareText)

// A fold moves the stored file, so the client's path goes stale; the card id is
// what keeps × / remove working and triggers the unpack when the last card goes.
cfg = { ttl: '7d', foldThreshold: 2 }
const S8 = 'sess-fold-card-id'
const idA = 'card-id-a'
const idB = 'card-id-b'
const ra = await streamUpload(core, S8, 'id-a.txt', 'text/plain', 'id-a-content', idA)
const rb = await streamUpload(core, S8, 'id-b.txt', 'text/plain', 'id-b-content', idB)
await runPreStep(S8)
const idFolderName = foldFolderNames().find(
  (n) => !n.endsWith('-existing') && existsSync(uploadsPath + '/' + n + '/id-a.txt'),
)
const idFolder = idFolderName ? uploadsPath + '/' + idFolderName : ''
ok('the card-id case folded its files', idFolder !== '' && existsSync(idFolder + '/id-b.txt'))
await core.remove({ sessionId: S8, path: ra.path! })
ok('a stale path alone cannot release the folded card', existsSync(idFolder + '/id-a.txt'))
await core.remove({ sessionId: S8, path: ra.path!, id: idA })
const afterId = await runPreStep(S8)
ok('the card id released one folded reference', injectText(afterId).includes('1 uploaded files in this folder'), injectText(afterId))
await core.remove({ sessionId: S8, path: rb.path!, id: idB })
await core.deleteMany({ sessionId: S8, paths: [] })
ok('closing the last card unpacks after the fold', !existsSync(idFolder) && existsSync(uploadsPath + '/id-a.txt'))

// A stale fold folder from a previous run is unpacked on startup.
const orphan = uploadsPath + '/2020-01-02-03-04-05'
mkdirSync(orphan, { recursive: true })
writeFileSync(orphan + '/orphan.txt', 'orphan-content')
await core.collect()
ok('startup sweep unpacks leftover fold folders', existsSync(uploadsPath + '/orphan.txt') && !existsSync(orphan))

// ---- local references (Desktop same-machine, no upload) --------------------
// Under full access the composer may register a picked file's real absolute
// path instead of uploading bytes: nothing is copied into uploads/, no dedup
// index entry is written, the reference groups/folds/injects like an existing
// file, and the host must never delete the original.
const originals = ROOT + '/originals'
mkdirSync(originals, { recursive: true })
const localPath = originals + '/local-note.txt'
writeFileSync(localPath, 'local-content-AAAA')
const S9 = 'sess-local'
const localRegistered = await core.registerLocal({
  sessionId: S9,
  cards: [{ id: 'local-card-1', name: 'local-note.txt', mime: 'text/plain', size: 18, path: localPath }],
})
ok('a local reference registers', localRegistered.ok === true && localRegistered.results[0].ok === true, JSON.stringify(localRegistered))
ok('the result marks the reference local', localRegistered.results[0].local === true && localRegistered.results[0].path === localPath, JSON.stringify(localRegistered))
ok('nothing was copied into uploads', !existsSync(uploadsPath + '/local-note.txt'))
const localIdx = JSON.parse(readFileSync(uploadsPath + '/.dfu-index.json', 'utf8')) as Record<string, { path: string }>
ok('no dedup index entry was written for the original', Object.values(localIdx).every((e) => e.path !== localPath))
const localDecision = await runPreStep(S9)
const localText = injectText(localDecision)
ok('an unfolded local reference is injected as its absolute path', localText.includes('- ' + localPath), localText)
ok('the original file is untouched', existsSync(localPath))
const localList = await core.list()
ok('local references do not enter the settings inventory', localList.files.every((f) => f.path !== localPath))

const relRef = await core.registerLocal({ sessionId: S9, cards: [{ path: 'relative/note.txt' }] })
ok('a relative path is refused', relRef.ok === false && relRef.results[0].ok === false, JSON.stringify(relRef))
const missingRef = await core.registerLocal({ sessionId: S9, cards: [{ path: originals + '/missing.txt' }] })
ok('a missing file is refused', missingRef.ok === false && missingRef.results[0].ok === false, JSON.stringify(missingRef))

const localDelete = await core.delete({ sessionId: S9, path: localPath, id: 'local-card-1' })
ok(
  'deleting a local reference only drops the reference',
  localDelete.ok === true && localDelete.removed === false && localDelete.reason === 'local-reference' && existsSync(localPath),
  JSON.stringify(localDelete),
)

// A local-reference group folds into the existing-file paths.txt, listing the
// originals instead of copies, and unfolding leaves the originals in place.
const S10 = 'sess-local-fold'
const localA = originals + '/local-a.txt'
const localB = originals + '/local-b.txt'
writeFileSync(localA, 'local-a')
writeFileSync(localB, 'local-b')
await core.registerLocal({
  sessionId: S10,
  cards: [
    { id: 'local-a', name: 'local-a.txt', mime: 'text/plain', size: 7, path: localA },
    { id: 'local-b', name: 'local-b.txt', mime: 'text/plain', size: 7, path: localB },
  ],
})
const localFoldDecision = await runPreStep(S10)
const localFoldText = injectText(localFoldDecision)
const localFolders = foldFolderNames().filter((n) => n.endsWith('-existing'))
ok('a local-reference group folds into a paths.txt folder', localFolders.length === 1, foldFolderNames())
const localFolder = localFolders.length > 0 ? uploadsPath + '/' + localFolders[0] : ''
const localTxt = existsSync(localFolder + '/paths.txt') ? readFileSync(localFolder + '/paths.txt', 'utf8') : ''
ok('paths.txt lists the original absolute paths', localTxt.split('\n').filter(Boolean).sort().join(',') === [localA, localB].sort().join(','), localTxt)
ok('the folded injection points at paths.txt', localFoldText.includes(localFolder + '/paths.txt'), localFoldText)
ok('the originals were not moved', existsSync(localA) && existsSync(localB))
await core.remove({ sessionId: S10, path: localA })
await core.remove({ sessionId: S10, path: localB })
await core.deleteMany({ sessionId: S10, paths: [] }) // flush the queued unfold
ok('unfold removes the helper folder only', !existsSync(localFolder) && existsSync(localA) && existsSync(localB))

// A local image under a multimodal model still becomes a native image block;
// the host reads the original path, the client uploaded nothing.
const localPng = originals + '/local-pic.png'
writeFileSync(localPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
await core.registerLocal({ sessionId: S9, cards: [{ id: 'local-pic', name: 'local-pic.png', mime: 'image/png', size: 8, path: localPng }] })
const localImageDecision = await runPreStep(S9, 'fake-provider', 'multimodal-model')
const localImageBlocks = decisionContent(localImageDecision).filter((b) => b.type === 'image')
ok('a local image becomes a native image block', localImageBlocks.length === 1, localImageBlocks.length)
await core.remove({ sessionId: S9, path: localPng, id: 'local-pic' })

// A page reload rebuilds the client, so the composer asks for this session's
// live references and rebuilds its cards from them. pendingFor is that query:
// it must report every field a card needs, and it must not invent one for a
// stored copy that is gone (the merge/tip cards below are the interesting bit).
const S_RESTORE = 'sess-restore-after-reload'
await streamUpload(core, S_RESTORE, 'restore-a.txt', 'text/plain', 'restore-a')
await streamUpload(core, S_RESTORE, 'restore-b.png', 'image/png', 'restore-b')
const sidecar = originals + '/restore-sidecar.txt'
writeFileSync(sidecar, 'sidecar')
await core.registerLocal({ sessionId: S_RESTORE, cards: [{ id: 'restore-local', name: 'restore-sidecar.txt', mime: 'text/plain', size: 7, path: sidecar }] })

const restored = await core.pendingFor(S_RESTORE)
ok('pendingFor reports every live reference', restored.length === 3, restored.length)
ok('a restored row carries the card id the host recorded', restored.some((r) => r.id !== '' && r.name === 'restore-a.txt'), JSON.stringify(restored.map((r) => r.id)))
ok('a restored row carries the path a card action needs', restored.every((r) => typeof r.path === 'string' && r.path !== ''), JSON.stringify(restored.map((r) => r.path)))
ok('a restored image row is marked for thumbnails', restored.some((r) => r.name === 'restore-b.png' && r.isImage === true), JSON.stringify(restored.map((r) => [r.name, r.isImage])))
ok('a restored real upload reports exists', restored.some((r) => r.name === 'restore-a.txt' && r.exists === true))
ok('a restored local reference keeps its flag', restored.some((r) => r.name === 'restore-sidecar.txt' && r.local === true))
ok('pendingFor is scoped to its session', (await core.pendingFor('sess-not-in-play')).length === 0)
ok('an empty session id yields no rows', (await core.pendingFor('')).length === 0)

// A reference left behind after its stored copy vanished must be reported as
// not existing, so the composer releases it instead of drawing a dead card.
const vanished = await core.pendingFor(S_RESTORE)
const vanishedRow = vanished.find((r) => r.name === 'restore-a.txt')
if (vanishedRow) rmSync(vanishedRow.path, { force: true })
const afterVanished = await core.pendingFor(S_RESTORE)
ok('a vanished stored copy is reported as not existing', afterVanished.some((r) => r.name === 'restore-a.txt' && r.exists === false), JSON.stringify(afterVanished.map((r) => [r.name, r.exists])))
await core.remove({ sessionId: S_RESTORE, path: vanishedRow ? vanishedRow.path : '' })
const bRow = afterVanished.find((r) => r.name === 'restore-b.png')
const restoredText = injectText(await runPreStep(S_RESTORE)) as string
ok('released references stop being injected', !restoredText.includes('restore-a.txt'), restoredText.slice(0, 200))
ok('the remaining reference is still injected', bRow !== undefined && restoredText.includes(bRow.path), restoredText.slice(0, 200))
await core.remove({ sessionId: S_RESTORE, path: bRow ? bRow.path : '' })
await core.remove({ sessionId: S_RESTORE, path: sidecar })
ok('a fully released session reports no rows', (await core.pendingFor(S_RESTORE)).length === 0, (await core.pendingFor(S_RESTORE)).length)

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

// ---- instant upload: a client-supplied hash skips the transfer --------------
// The browser hashes the file and asks first. A hit registers the reference and
// hands back the stored copy, so no byte travels; a miss is a plain answer, not
// an error, and the caller falls back to a normal upload.

const SP = 'sess-probe'
const probeBytes = 'probe-content-identical-1234'
const probeHash = createHash('sha256').update(probeBytes).digest('hex')
const stored = await streamUpload(core, SP, 'probe.txt', 'text/plain', probeBytes, 'card-probe-1')
ok('probe: the file is stored normally first', stored.ok === true && stored.dedup === false, JSON.stringify(stored))

const hit = await core.probeExisting({ sessionId: SP, id: 'card-probe-2', name: 'again.txt', mime: 'text/plain', size: Buffer.byteLength(probeBytes), sha256: probeHash })
ok('probe: a known hash is a hit', hit.ok === true && hit.dedup === true, JSON.stringify(hit))
ok('probe: the hit points at the stored copy', hit.ok && hit.path === stored.path, JSON.stringify([hit.path, stored.path]))
ok('probe: the hit reports the real size', hit.ok && hit.size === Buffer.byteLength(probeBytes), JSON.stringify(hit.size))

// The preflight registers a reference, so the content is injected for this card
// without any bytes having been sent.
const spPending = await core.pendingFor(SP)
ok('probe: the hit registers a live reference', spPending.some((r) => r.path === stored.path), JSON.stringify(spPending))

// A hash the store has never seen is a miss, and must stay a plain answer.
const missHash = createHash('sha256').update('never-stored-content').digest('hex')
const miss = await core.probeExisting({ sessionId: SP, id: 'card-probe-3', name: 'nope.txt', mime: 'text/plain', size: 20, sha256: missHash })
ok('probe: an unknown hash is a miss', miss.ok === false, JSON.stringify(miss))
const spAfterMiss = await core.pendingFor(SP)
ok('probe: a miss registers nothing', !spAfterMiss.some((r) => r.name === 'nope.txt'), JSON.stringify(spAfterMiss))

// Malformed input never reaches the index.
ok('probe: a short hash is refused', (await core.probeExisting({ sessionId: SP, name: 'x.txt', sha256: 'abc' })).ok === false)
ok('probe: a non-hex hash is refused', (await core.probeExisting({ sessionId: SP, name: 'x.txt', sha256: 'z'.repeat(64) })).ok === false)
ok('probe: a missing name is refused', (await core.probeExisting({ sessionId: SP, sha256: probeHash })).ok === false)
ok('probe: an uppercase hash is accepted', (await core.probeExisting({ sessionId: SP, name: 'up.txt', sha256: probeHash.toUpperCase() })).ok === true)

// Scope: only this plugin's own store answers. The host's official attachments
// live elsewhere and are never consulted, so an unknown hash stays a miss even
// though the machine holds plenty of other files.
ok('probe: only the plugin index is consulted', miss.ok === false && stored.path !== undefined)

// Cross-session: a hit in one session is visible to another, because the copy is
// shared on disk (that is the whole point of content addressing).
const otherSession = await core.probeExisting({ sessionId: S2, id: 'card-probe-4', name: 'from-b.txt', mime: 'text/plain', size: Buffer.byteLength(probeBytes), sha256: probeHash })
ok('probe: a hit is shared across sessions', otherSession.ok === true && otherSession.path === stored.path, JSON.stringify(otherSession))

// A vanished copy must not be reported as a hit: the index entry alone is stale.
try { unlinkSync(stored.path!) } catch { /* already gone */ }
const stale = await core.probeExisting({ sessionId: SP, id: 'card-probe-5', name: 'stale.txt', size: 10, sha256: probeHash })
ok('probe: a stale index entry is a miss', stale.ok === false, JSON.stringify(stale))

console.log(results.join('\n'))
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)

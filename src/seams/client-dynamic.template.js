// GENERATED — do not edit. Edit src/core/client-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate src/client.js.
// __CORE__

// One slice as base64: the string is bounded by the chunk size, never by the
// file size, and FileReader keeps the conversion off the main thread's budget.
const readChunkBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = String(reader.result || '')
    const comma = dataUrl.indexOf(',')
    if (comma < 0) reject(new Error('chunk read failed'))
    else resolve(dataUrl.slice(comma + 1))
  }
  reader.onerror = () => reject(new Error('chunk read failed'))
  reader.readAsDataURL(blob)
})

// The dynamic Host half writes through the shell, so a request body cannot
// reach disk as a stream there: the client slices the File and sends one base64
// chunk per call, which keeps memory flat and removes the single-call ceiling.
const CHUNK_BYTES = 4 * 1024 * 1024

return {
  apply(ctx) {
    const core = createClientCore({
      react: React,
      upload: async (args) => {
        const file = args && args.file
        if (!file || typeof file.slice !== 'function') return host.call('upload', args)
        const begun = await host.call('upload-begin', {
          sessionId: args.sessionId,
          name: args.name,
          mime: args.mime || '',
          size: file.size,
        })
        if (!begun || begun.ok === false) return begun || { ok: false, error: 'upload-begin failed' }
        // The card's × can abandon this transfer between chunks: drop the staged
        // slices instead of finishing the file.
        const signal = args.signal
        const aborted = () => signal !== undefined && signal !== null && signal.aborted === true
        let sent = 0
        try {
          while (sent < file.size) {
            if (aborted()) {
              await host.call('upload-abort', { id: begun.id })
              return { ok: false, error: 'upload aborted' }
            }
            const slice = file.slice(sent, Math.min(sent + CHUNK_BYTES, file.size))
            const base64 = await readChunkBase64(slice)
            const res = await host.call('upload-chunk', { id: begun.id, base64: base64 })
            if (!res || res.ok === false) {
              await host.call('upload-abort', { id: begun.id })
              return res || { ok: false, error: 'upload-chunk failed' }
            }
            sent += slice.size
            if (typeof args.onProgress === 'function') {
              try {
                args.onProgress(sent, file.size)
              } catch {
                // progress is advisory
              }
            }
          }
        } catch (err) {
          await host.call('upload-abort', { id: begun.id })
          return { ok: false, error: String((err && err.message) || err) }
        }
        if (aborted()) {
          await host.call('upload-abort', { id: begun.id })
          return { ok: false, error: 'upload aborted' }
        }
        return host.call('upload-finish', { id: begun.id })
      },
      remove: (args) => host.call('remove', args),
      delete: (args) => host.call('delete', args),
      configGet: () => host.call('dfu-config-get'),
      configSet: (cfg) => host.call('dfu-config-set', cfg),
      insertStyles: (css) => styles.insert(css),
    })
    return core.apply(ctx)
  },
}

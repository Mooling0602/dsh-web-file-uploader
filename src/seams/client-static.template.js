// GENERATED — do not edit. Edit src/core/client-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate client/src/client.js.
// __CORE__

// Guarded browser style insertion (the web build may provide a cleaner seam).
const ensureStyles = (() => {
  let done = false
  return (css) => {
    if (done) return
    done = true
    try {
      if (typeof document === 'undefined') return
      const el = document.createElement('style')
      el.setAttribute('data-dfu', 'dsh-web-file-uploader')
      el.textContent = css
      document.head.appendChild(el)
    } catch {
      // non-browser environment — ignore
    }
  }
})()

// The build wrapper (scripts/build-client.mjs) replaces the marked line below
// with `let react = require("react")` (resolved by the web module loader's
// module map). Standalone (unwrapped) consumers keep the null fallback and
// apply() becomes a no-op. The marker is load-bearing: injecting a plain
// `react = require("react")` at the top of the factory cannot work — this
// `let` declaration sits in the same function scope, so the early assignment
// throws "Cannot access 'react' before initialization" (TDZ), and a `var`
// here would instead reset the binding back to null after the injection.
// Keep this source free of ESM imports so the wrapper can inline it verbatim.
let react = null // __REACT__

export const inject = ['slots', 'locale']

export function apply(ctx) {
  if (react === null || react.createElement === undefined) return
  const core = createClientCore({
    react: react,
    // Static transport: the browser posts the File itself to the host route, so
    // the page never holds the bytes (and the route never sees base64). XHR
    // rather than fetch, because only XHR reports progress for a Blob body —
    // the same carrier the official uploader uses.
    upload: (args) => new Promise((resolve, reject) => {
      if (args && args.file) {
        const url = '/dsh-web-file-uploader/upload?name=' + encodeURIComponent(args.name) +
          '&mime=' + encodeURIComponent(args.mime || '') + '&session=' + encodeURIComponent(args.sessionId) +
          '&size=' + encodeURIComponent(String((args.file && args.file.size) || args.size || 0))
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)
        xhr.withCredentials = true
        xhr.setRequestHeader('content-type', 'application/octet-stream')
        if (typeof args.onProgress === 'function') {
          xhr.upload.onprogress = (event) => {
            try {
              args.onProgress(event.loaded, event.lengthComputable ? event.total : (args.file.size || 0))
            } catch {
              // progress is advisory
            }
          }
        }
        xhr.onload = () => {
          try {
            resolve(JSON.parse(xhr.responseText || '{}'))
          } catch {
            resolve({ ok: false, error: 'bad response (HTTP ' + xhr.status + ')' })
          }
        }
        xhr.onerror = () => resolve({ ok: false, error: 'upload transport failed' })
        xhr.onabort = () => resolve({ ok: false, error: 'upload aborted' })
        xhr.send(args.file)
        return
      }
      // Encoded fallback for a caller that hands over bytes directly.
      try {
        const bytes = Uint8Array.from(atob(args.base64), (c) => c.charCodeAt(0))
        const url = '/dsh-web-file-uploader/upload?name=' + encodeURIComponent(args.name) +
          '&mime=' + encodeURIComponent(args.mime || '') + '&session=' + encodeURIComponent(args.sessionId)
        fetch(url, { method: 'POST', body: bytes }).then((res) => res.json()).then(resolve).catch(reject)
      } catch (err) {
        reject(err)
      }
    }),
    remove: async (args) => {
      const url = '/dsh-web-file-uploader/remove?session=' + encodeURIComponent(args.sessionId) + '&path=' + encodeURIComponent(args.path)
      await fetch(url, { method: 'POST' })
    },
    delete: async (args) => {
      const url = '/dsh-web-file-uploader/delete?session=' + encodeURIComponent(args.sessionId) + '&path=' + encodeURIComponent(args.path)
      await fetch(url, { method: 'POST' })
    },
    configGet: async () => {
      const res = await fetch('/dsh-web-file-uploader/config?action=get')
      return res.json()
    },
    configSet: async (cfg) => {
      const res = await fetch('/dsh-web-file-uploader/config?action=set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      return res.json()
    },
    insertStyles: (css) => ensureStyles(css),
  })
  return core.apply(ctx)
}

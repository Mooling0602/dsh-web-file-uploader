// GENERATED — do not edit. Edit src/core/client.ts or this template, then
// run `node scripts/build.mjs` to regenerate client/src/client.js.
// __CORE__

// Guarded browser style insertion (the web build may provide a cleaner seam).
import type {
  ClientCore, ClientCoreDeps, DfuConfig, PathArgs, ReactLike, UploadArgs, UploadResult,
} from './core/client.js'
import type { PluginContext } from './types.js'

// The inlined core is injected at the __CORE__ marker above by the build; the
// declaration below is erased on compile, so the emitted file stays free of
// imports — the web loader factory inlines it verbatim.
declare const createClientCore: (deps: ClientCoreDeps) => ClientCore

const ensureStyles = (() => {
  let done = false
  return (css: string) => {
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

// The build wrapper (scripts/build.mjs) replaces the marked line below with
// `let react = require("react")` (resolved by the web module loader's module
// map). Standalone (unwrapped) consumers keep the null fallback and apply()
// becomes a no-op. The marker is load-bearing: injecting a plain
// `react = require("react")` at the top of the factory cannot work — this
// `let` declaration sits in the same function scope, so the early assignment
// throws "Cannot access 'react' before initialization" (TDZ), and a `var` here
// would instead reset the binding back to null after the injection.
// Keep this source free of value imports so the wrapper can inline it verbatim.
let react: ReactLike | null = null // __REACT__

export const inject = ['slots', 'locale']

export function apply(ctx: PluginContext) {
  if (react === null || typeof react.createElement !== 'function') return
  const core = createClientCore({
    react: react,
    // Static transport: the browser posts the File itself to the host route, so
    // the page never holds the bytes (and the route never sees base64). XHR
    // rather than fetch, because only XHR reports progress for a Blob body —
    // the same carrier the official uploader uses.
    upload: (args: UploadArgs) => new Promise<UploadResult>((resolve, reject) => {
      if (args && args.file) {
        const url = '/dsh-web-file-uploader/upload?name=' + encodeURIComponent(args.name) +
          '&mime=' + encodeURIComponent(args.mime || '') + '&session=' + encodeURIComponent(String(args.sessionId)) +
          '&size=' + encodeURIComponent(String((args.file && args.file.size) || args.size || 0))
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)
        xhr.withCredentials = true
        xhr.setRequestHeader('content-type', 'application/octet-stream')
        if (typeof args.onProgress === 'function') {
          xhr.upload.onprogress = (event) => {
            try {
              args.onProgress!(event.loaded, event.lengthComputable ? event.total : (args.file!.size || 0))
            } catch {
              // progress is advisory
            }
          }
        }
        // The card's × can abandon this transfer: aborting the XHR closes the
        // request, and the host route drops the staged file it was still
        // writing (a closed tab takes the same path).
        const signal = args.signal
        const onAbort = () => {
          try {
            xhr.abort()
          } catch {
            // already settled
          }
        }
        const detach = () => {
          if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
        }
        if (signal) {
          if (signal.aborted === true) {
            resolve({ ok: false, error: 'upload aborted' })
            return
          }
          if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort)
        }
        xhr.onload = () => {
          detach()
          try {
            resolve(JSON.parse(xhr.responseText || '{}'))
          } catch {
            resolve({ ok: false, error: 'bad response (HTTP ' + xhr.status + ')' })
          }
        }
        xhr.onerror = () => {
          detach()
          resolve({ ok: false, error: 'upload transport failed' })
        }
        xhr.onabort = () => {
          detach()
          resolve({ ok: false, error: 'upload aborted' })
        }
        xhr.send(args.file)
        return
      }
      // Encoded fallback for a caller that hands over bytes directly.
      try {
        const bytes = Uint8Array.from(atob(args.base64 as string), (c) => c.charCodeAt(0))
        const url = '/dsh-web-file-uploader/upload?name=' + encodeURIComponent(args.name) +
          '&mime=' + encodeURIComponent(args.mime || '') + '&session=' + encodeURIComponent(String(args.sessionId))
        const init: RequestInit = { method: 'POST', body: bytes }
        if (args.signal) init.signal = args.signal
        fetch(url, init).then((res) => res.json()).then(resolve).catch(reject)
      } catch (err) {
        reject(err)
      }
    }),
    remove: async (args: PathArgs) => {
      const url = '/dsh-web-file-uploader/remove?session=' + encodeURIComponent(String(args.sessionId)) + '&path=' + encodeURIComponent(args.path)
      await fetch(url, { method: 'POST' })
    },
    delete: async (args: PathArgs) => {
      const url = '/dsh-web-file-uploader/delete?session=' + encodeURIComponent(String(args.sessionId)) + '&path=' + encodeURIComponent(args.path)
      await fetch(url, { method: 'POST' })
    },
    configGet: async () => {
      const res = await fetch('/dsh-web-file-uploader/config?action=get')
      return res.json()
    },
    configSet: async (cfg: Partial<DfuConfig>) => {
      const res = await fetch('/dsh-web-file-uploader/config?action=set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      return res.json()
    },
    // Settings panel: read the upload inventory and delete a selection.
    filesList: async () => {
      const res = await fetch('/dsh-web-file-uploader/files')
      return res.json()
    },
    deleteMany: async (args: { sessionId?: string; paths: string[] }) => {
      const res = await fetch('/dsh-web-file-uploader/delete-many', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: args && args.sessionId, paths: (args && args.paths) || [] }),
      })
      return res.json()
    },
    insertStyles: (css: string) => ensureStyles(css),
  })
  return core.apply(ctx)
}

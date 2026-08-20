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

export const inject = []

export function apply(ctx) {
  if (react === null || react.createElement === undefined) return
  const core = createClientCore({
    react: react,
    // Static transport: decode the base64 to raw bytes and POST them to the
    // host webServer routes (binary-safe; the dynamic half uses host.call).
    upload: async (args) => {
      const bytes = Uint8Array.from(atob(args.base64), (c) => c.charCodeAt(0))
      const url = '/dsh-web-file-uploader/upload?name=' + encodeURIComponent(args.name) +
        '&mime=' + encodeURIComponent(args.mime || '') + '&session=' + encodeURIComponent(args.sessionId)
      const res = await fetch(url, { method: 'POST', body: bytes })
      return res.json()
    },
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
    configSet: async (ttl) => {
      const res = await fetch('/dsh-web-file-uploader/config?action=set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ttl }),
      })
      return res.json()
    },
    insertStyles: (css) => ensureStyles(css),
  })
  return core.apply(ctx)
}

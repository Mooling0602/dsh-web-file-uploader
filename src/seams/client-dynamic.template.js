// GENERATED — do not edit. Edit src/core/client-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate src/client.js.
// __CORE__

return {
  apply(ctx) {
    const core = createClientCore({
      react: React,
      upload: (args) => host.call('upload', args),
      remove: (args) => host.call('remove', args),
      insertStyles: (css) => styles.insert(css),
    })
    return core.apply(ctx)
  },
}

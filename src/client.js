// GENERATED — do not edit. Edit src/core/client-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate src/client.js.
// dsh-web-file-uploader — canonical CLIENT core (transport-agnostic)
//
// Single source of truth for the client UI + upload flow, consumed by BOTH:
//   - the dynamic plugin (src/client.js) via inlining,
//   - the static client module (client/src/client.js) via inlining.
//
// All environment interactions are injected through `deps`:
//   react            React namespace (global in dynamic, require in static)
//   upload(args)     Promise<result>   { sessionId, name, mime, base64 }
//   remove(args)     Promise<void>     { sessionId, path }
//   insertStyles(css) -> void
//
// Returns { apply(ctx) }: registers the attach button + upload cards and the
// locale dictionaries, using the caller's transport.
//
// NOTE: this file must stay free of `import`/`require` and of any sandbox-only
// builtin — the dynamic build inlines it verbatim. Only `export function
// createClientCore` is used by the static side.

function createClientCore(deps) {
  const react = deps.react
  const upload = deps.upload
  const remove = deps.remove
  const del = deps.delete
  const configGet = deps.configGet
  const configSet = deps.configSet
  const insertStyles = deps.insertStyles || (() => {})

  // Composer mark: the shell's own 16px paperclip outline
  // (ic_ds_paperclip_outline_16, filled style), rotated 45° so it keeps the
  // diagonal this plugin has always drawn next to the official upright clip.
  //
  // The rotation is lossless: rotating the upright glyph (ink bbox 11.9 x 15.4
  // units) turns its box into 19.304 x 19.305, so instead of scaling the glyph
  // down to fit 16 units — which thins every stroke by 0.83 — the viewBox grows
  // to hold the rotated bbox and the SVG is rendered larger by the same factor.
  // At 19.704 units the official 0.875 px/unit (14px / 16 units) is preserved:
  // same stroke weight, same clip length, only the axis differs.
  const PAPERCLIP_PATH =
    'M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z'
  const PAPERCLIP_TRANSFORM = 'translate(8 8) rotate(45) translate(-8 -8)'
  // Rotated ink bbox (symmetric about the 8,8 centre) plus a 0.2-unit hair of
  // air, rendered at 19.704 x 0.875 = 17.24px so px-per-unit matches the shell.
  const PAPERCLIP_VIEW_BOX = '-1.852 -1.852 19.704 19.704'
  const PAPERCLIP_SIZE = 17.24

  const TRASH_PATH =
    'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z'

  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

  // Settings-nav mark. The shell paints the settings nav from a fixed id→icon
  // map and falls back to the plain gear for every id it does not know, so a
  // plugin cannot declare its own glyph through the slot. This is the shell's
  // own 16px paperclip outline (ic_ds_paperclip_outline_16, filled style on a
  // 16-unit grid) so the mark speaks the same icon language as the rows around
  // it — and the same paperclip the composer button shows.
  const NAV_GLYPH_PATH =
    'M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z'

  const DICT = {
    zh: {
      attachTitle: '上传附件',
      uploading: '上传中…',
      saved: '已保存',
      copyPath: '复制路径',
      remove: '移除',
      delete: '删除文件（不可找回）',
      failed: '失败',
      settingsTitle: '文件上传',
      ttlLabel: '自动清理保留期',
      ttlHint: '支持 1s / 1m / 1h / 1d，输入 0 表示永不清理。超过保留期且未被引用的文件会被自动清除。',
      save: '保存',
      replaceOfficial: '替代官方附件按钮',
      replaceHint: '开启后隐藏官方按钮，本插件按钮移到它的位置上，输入框左侧只保留一个上传入口。',
      replaceScope: '上传、进度与自动清理仍由本插件负责；保存后立即生效，无需刷新。',
      replaceRestore: '关闭开关并保存即可恢复官方按钮；停用或卸载插件时也会自动恢复。',
    },
    en: {
      attachTitle: 'Attach files',
      uploading: 'Uploading…',
      saved: 'Saved',
      copyPath: 'Copy path',
      remove: 'Remove',
      delete: 'Delete file (permanent)',
      failed: 'Failed',
      settingsTitle: 'File uploads',
      ttlLabel: 'Auto-cleanup retention',
      ttlHint: 'Use 1s / 1m / 1h / 1d; enter 0 to never clean. Files past the retention that are no longer referenced are removed automatically.',
      save: 'Save',
      replaceOfficial: 'Replace the official attach button',
      replaceHint: 'Hides the official button and moves this plugin’s button into its place, so the composer keeps a single upload control.',
      replaceScope: 'Uploading, progress and auto-cleanup still come from this plugin; saving applies at once, no refresh needed.',
      replaceRestore: 'Turning the switch off and saving brings the official button back; disabling or removing the plugin restores it too.',
    },
  }

  let tFn = (key) => key
  let localeSvc = null

  // --- per-session upload store ---------------------------------------------

  function createStore() {
    const bySession = new Map()
    const listeners = new Set()
    const emit = () => {
      listeners.forEach((fn) => fn())
    }
    return {
      files(sessionId) {
        let row = bySession.get(sessionId)
        if (!row) {
          row = []
          bySession.set(sessionId, row)
        }
        return row
      },
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      add(sessionId, entry) {
        this.files(sessionId).push(entry)
        emit()
      },
      update(sessionId, id, patch) {
        const f = this.files(sessionId).find((x) => x.id === id)
        if (f) Object.assign(f, patch)
        emit()
      },
      remove(sessionId, id) {
        const row = this.files(sessionId)
        const i = row.findIndex((x) => x.id === id)
        if (i >= 0) {
          const f = row[i]
          if (f.previewUrl && typeof URL !== 'undefined') URL.revokeObjectURL(f.previewUrl)
          row.splice(i, 1)
        }
        emit()
      },
    }
  }
  const store = createStore()

  const formatSize = (bytes) => {
    if (!Number.isFinite(bytes) || bytes < 0) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  }

  // Extract the session id from slot props across dsh generations:
  // - dsh <= 0.1.1-rc.x passed `{ sessionId }` directly to composer-slot occupants;
  // - dsh 0.1.2-alpha passes an InputZone owner share `{ session: SessionSnapshot,
  //   input }` where the id lives at `session.sessionId` (plus standard hooks).
  // Both shapes are accepted so one build runs on either version.
  function sessionIdOf(props) {
    if (props) {
      if (typeof props.sessionId === 'string' && props.sessionId !== '') return props.sessionId
      const session = props.session
      if (session && typeof session === 'object' && typeof session.sessionId === 'string') {
        return session.sessionId
      }
    }
    return undefined
  }

  // Re-render when the shared store OR the active locale changes.
  function useStoreVersion() {
    const [v, setV] = react.useState(0)
    react.useEffect(() => {
      const unsubs = []
      unsubs.push(store.subscribe(() => setV((x) => x + 1)))
      if (localeSvc !== null && typeof localeSvc.subscribe === 'function') {
        unsubs.push(localeSvc.subscribe(() => setV((x) => x + 1)))
      }
      return () => unsubs.forEach((fn) => fn())
    }, [])
    return v
  }

  const copyPath = (path) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(path).catch(() => {})
      }
    } catch {
      // clipboard unavailable — ignore
    }
  }

  // Remove an attachment card: notify the host (stop injecting this file) and
  // drop it from the local store. The path may not be known yet if the upload
  // is still in flight — the upload completion handler covers that case.
  const removeCard = (sessionId, id) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (entry && entry.path) {
      try {
        remove({ sessionId: sessionId, path: entry.path }).catch(() => {})
      } catch {
        // host unavailable — ignore
      }
    }
    store.remove(sessionId, id)
  }

  // Permanently delete an attachment: drop the card AND remove the file from
  // the host (trash can). Falls back to remove (un-inject only) when the host
  // does not expose a `delete` RPC. Cross-session shared copies are protected
  // on the host side (removed:false) — this session's card still goes away.
  const deleteCard = (sessionId, id) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (entry && entry.path) {
      try {
        if (typeof del === 'function') {
          del({ sessionId: sessionId, path: entry.path }).catch(() => {})
        } else if (remove) {
          remove({ sessionId: sessionId, path: entry.path }).catch(() => {})
        }
      } catch {
        // host unavailable — ignore
      }
    }
    store.remove(sessionId, id)
  }

  // --- components -----------------------------------------------------------

  function AttachButton(props) {
    useStoreVersion()
    const sessionId = sessionIdOf(props)
    const onPick = (event) => {
      const files = Array.prototype.slice.call(event.target.files || [])
      event.target.value = ''
      files.forEach((file) => {
        const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 9)
        const isImage = IMAGE_TYPES.includes(file.type)
        let previewUrl = null
        try {
          if (isImage && typeof URL !== 'undefined') previewUrl = URL.createObjectURL(file)
        } catch {
          previewUrl = null
        }
        store.add(sessionId, {
          id: id,
          name: file.name,
          size: file.size,
          mime: file.type || '',
          isImage: isImage,
          previewUrl: previewUrl,
          status: 'uploading',
          error: null,
          path: null,
          loaded: 0,
          total: file.size,
        })
        // The File object itself rides the transport: every seam streams it
        // (request body in the static bundle, chunked RPC in the dynamic
        // sandbox), so nothing here reads the whole file into memory. Progress
        // arrives per chunk and only ever updates the card's status line.
        const onProgress = (loaded, total) => {
          if (store.files(sessionId).some((x) => x.id === id)) {
            store.update(sessionId, id, { loaded: loaded, total: total || file.size })
          }
        }
        upload({
          sessionId: sessionId,
          name: file.name,
          mime: file.type || '',
          size: file.size,
          file: file,
          onProgress: onProgress,
        })
          .then((res) => {
            const stillPresent = store.files(sessionId).some((x) => x.id === id)
            if (res && res.ok) {
              if (stillPresent) store.update(sessionId, id, { status: 'done', path: res.path, savedSize: res.size })
              else {
                try {
                  remove({ sessionId: sessionId, path: res.path }).catch(() => {})
                } catch {
                  // host unavailable — ignore
                }
              }
            } else if (stillPresent) {
              store.update(sessionId, id, { status: 'error', error: (res && res.error) || 'upload failed' })
            }
          })
          .catch((err) => {
            if (store.files(sessionId).some((x) => x.id === id)) {
              store.update(sessionId, id, { status: 'error', error: String((err && err.message) || err) })
            }
          })
      })
    }
    return react.createElement(
      'label',
      { className: 'dfu-attach', title: tFn('attachTitle') },
      react.createElement('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: onPick }),
      react.createElement(
        'svg',
        {
          width: PAPERCLIP_SIZE,
          height: PAPERCLIP_SIZE,
          viewBox: PAPERCLIP_VIEW_BOX,
          fill: 'none',
          'aria-hidden': 'true',
        },
        react.createElement('path', {
          d: PAPERCLIP_PATH,
          fill: 'currentColor',
          transform: PAPERCLIP_TRANSFORM,
        }),
      ),
    )
  }

  function UploadChips(props) {
    useStoreVersion()
    const sessionId = sessionIdOf(props)
    const files = store.files(sessionId)
    if (!files.length) return null
    const chips = []
    files.forEach((f) => {
      let preview = null
      if (f.isImage && f.previewUrl) {
        preview = react.createElement('img', { className: 'dfu-chip-thumb', src: f.previewUrl, alt: '' })
      } else {
        preview = react.createElement(
          'svg',
          {
            className: 'dfu-chip-thumb dfu-chip-thumb-file',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          react.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
          react.createElement('polyline', { points: '14 2 14 8 20 8' }),
        )
      }

      let statusNode = null
      if (f.status === 'uploading') {
        // Percentage once the transport has reported bytes: a streamed file
        // never knows its total up front, so keep the plain label until then.
        const pct = f.total > 0 ? Math.min(100, Math.floor(((f.loaded || 0) / f.total) * 100)) : 0
        statusNode = react.createElement(
          'span',
          { className: 'dfu-chip-status dfu-chip-status-active' },
          pct > 0 ? tFn('uploading') + ' ' + pct + '%' : tFn('uploading'),
        )
      } else if (f.status === 'done') {
        statusNode = react.createElement('span', { className: 'dfu-chip-status dfu-chip-status-ok', title: f.path || '' }, tFn('saved'))
      } else {
        statusNode = react.createElement('span', { className: 'dfu-chip-status dfu-chip-status-error', title: f.error || '' }, f.error || tFn('failed'))
      }
      const actions = []
      if (f.status === 'done' && f.path) {
        actions.push(
          react.createElement(
            'button',
            { key: 'copy', type: 'button', className: 'dfu-chip-copy', title: tFn('copyPath'), onClick: () => copyPath(f.path) },
            tFn('copyPath'),
          ),
        )
        actions.push(
          react.createElement(
            'button',
            {
              key: 'delete',
              type: 'button',
              className: 'dfu-chip-delete',
              title: tFn('delete'),
              onClick: () => deleteCard(sessionId, f.id),
            },
            react.createElement(
              'svg',
              {
                width: 13,
                height: 13,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.8,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                'aria-hidden': 'true',
              },
              react.createElement('path', { d: TRASH_PATH }),
            ),
          ),
        )
      }
      actions.push(
        react.createElement(
          'button',
          { key: 'remove', type: 'button', className: 'dfu-chip-remove', title: tFn('remove'), onClick: () => removeCard(sessionId, f.id) },
          '×',
        ),
      )
      chips.push(
        react.createElement(
          'div',
          { key: f.id, className: 'dfu-chip' },
          preview,
          react.createElement(
            'div',
            { className: 'dfu-chip-body' },
            react.createElement('span', { className: 'dfu-chip-name', title: f.name }, f.name),
            react.createElement('span', { className: 'dfu-chip-meta' }, formatSize(f.size), ' · ', statusNode),
          ),
          react.createElement('span', { className: 'dfu-chip-actions' }, actions),
        ),
      )
    })
    return react.createElement('div', { className: 'dfu-dock' }, chips)
  }

  const CSS = `
/* Composer button chrome: the shell's own .add control (28px circle, solid
   resting fill, label-primary glyph) so the two paperclips read as siblings
   sitting in the same row — the glyph's diagonal is what tells ours apart. */
.dfu-attach {
  display: grid; place-items: center;
  width: 28px; height: 28px; border-radius: 999px; corner-shape: round;
  background: var(--dsw-specific-selector, rgba(127, 127, 127, .12));
  color: var(--dsw-alias-label-primary, #333);
  cursor: pointer; user-select: none; flex: none;
}
.dfu-attach:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127, 127, 127, .18));
}
.dfu-dock {
  box-sizing: border-box;
  width: calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));
  max-width: calc(var(--dsh-composer-card-max-width, 100%) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));
  margin: 0 auto;
  padding: 2px var(--dsh-composer-dock-inset, 0px) 10px;
  flex: none;
  display: flex; flex-wrap: wrap; gap: 8px;
}
.dfu-chip {
  display: inline-flex; align-items: center; gap: 8px;
  max-width: 320px; padding: 6px;
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2));
  border-radius: 12px; font-size: 13px;
  color: var(--dsw-alias-label-primary, #333);
}
.dfu-chip-thumb {
  width: 40px; height: 40px; border-radius: 8px; object-fit: cover;
  flex: none; display: block;
}
.dfu-chip-thumb-file {
  padding: 8px; box-sizing: border-box;
  color: var(--dsw-alias-label-secondary, #8a8f98);
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
}
.dfu-chip-body {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
}
.dfu-chip-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 170px; font-weight: 500;
}
.dfu-chip-meta { color: var(--dsw-alias-label-secondary, #8a8f98); font-size: 12px; }
.dfu-chip-status { font-size: 12px; }
.dfu-chip-status-active { color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dfu-chip-status-ok { color: var(--dsw-alias-state-success-primary, #22c55e); }
.dfu-chip-status-error { color: var(--dsw-alias-state-error-primary, #ef4444); }
.dfu-chip-actions { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.dfu-chip-copy {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.25));
  background: transparent; cursor: pointer; font-size: 12px;
  color: var(--dsw-alias-label-secondary, #8a8f98);
  padding: 1px 8px; border-radius: 999px; line-height: 1.5;
}
.dfu-chip-copy:hover {
  color: var(--dsw-alias-brand-primary, #4d6bfe);
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
}
.dfu-chip-remove {
  border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #8a8f98); font-size: 14px; line-height: 1;
  padding: 2px 4px; border-radius: 6px;
}
.dfu-chip-remove:hover {
  color: var(--dsw-alias-state-error-primary, #ef4444);
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.12));
}
.dfu-chip-delete {
  border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #8a8f98); font-size: 14px; line-height: 1;
  padding: 3px; border-radius: 6px; display: inline-flex; align-items: center;
}
.dfu-chip-delete:hover {
  color: var(--dsw-alias-state-error-primary, #ef4444);
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.12));
}
.dfu-settings { display: flex; flex-direction: column; gap: 10px; max-width: 460px; }
.dfu-settings-row { display: flex; align-items: center; gap: 10px; }
.dfu-settings-label { font-size: 13px; font-weight: 500; white-space: nowrap; }
/* Replace-official row: the shell's settings convention (label left, control
   right) and the shell's own Switch geometry (36x20 capsule, 16px thumb, state
   keyed off aria-checked) so the toggle reads as one of the shell's settings
   rather than as plugin furniture. */
.dfu-settings-toggle {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary, #333);
}
.dfu-settings-toggle-label { flex: 1; min-width: 0; font-weight: 500; }
.dfu-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0;
  border-radius: 10px; corner-shape: round; cursor: pointer;
  background: var(--dsw-alias-border-l3, rgba(127, 127, 127, .35));
}
.dfu-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary, #4d6bfe); }
.dfu-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 2px;
}
.dfu-switch-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  corner-shape: round; background: var(--dsw-alias-label-primary-foreground, #fff);
  transition: transform 120ms ease;
}
.dfu-switch[aria-checked='true'] .dfu-switch-thumb { transform: translateX(16px); }
.dfu-settings-input {
  flex: 1; min-width: 0; padding: 6px 10px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25));
  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, #333);
}
.dfu-settings-hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); line-height: 1.5; }
.dfu-settings-actions { display: flex; align-items: center; gap: 10px; }
.dfu-settings-save {
  align-self: flex-start; padding: 5px 16px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--dsw-alias-brand-primary, #4d6bfe); color: #fff;
  background: var(--dsw-alias-brand-primary, #4d6bfe); border-radius: 8px;
}
/* Dark mode: the brand token resolves to a light surface, so keep the button
   fill as-is (already contrasts with the dark page) and only darken the text so
   "Save" stays readable against it. Light mode keeps the original white text. */
body[data-ds-dark-theme] .dfu-settings-save { color: #000; }
.dfu-settings-save:disabled { opacity: .6; cursor: default; }
.dfu-settings-saved { font-size: 12px; color: var(--dsw-alias-state-success-primary, #22c55e); }
/* Settings-tab mark. At rest the row keeps the theme's monochrome icon
   language (the glyph inherits the cell's label color via currentColor, like
   every shell icon); it takes the theme-independent --dsw-static-deepseek-450
   accent only while this section is the open one. The shell flags the active
   nav cell with aria-current="true", so one selector covers both themes and
   needs no script on tab switches. */
.dfu-nav-mark { flex: none; }
nav button[aria-current='true'] .dfu-nav-mark { color: var(--dsw-static-deepseek-450, #5686fe); }
`

  // --- settings panel ------------------------------------------------------

  function SettingsPanel() {
    useStoreVersion()
    const [ttl, setTtl] = react.useState('')
    const [replaceOn, setReplaceOn] = react.useState(false)
    const [status, setStatus] = react.useState('') // '' | 'saving' | 'saved' | 'error'
    react.useEffect(() => {
      let alive = true
      if (typeof configGet === 'function') {
        configGet()
          .then((r) => {
            if (!alive || !r) return
            if (r.ttl != null) setTtl(String(r.ttl))
            setReplaceOn(r.replaceOfficial === true)
          })
          .catch(() => {})
      }
      return () => { alive = false }
    }, [])
    const save = () => {
      if (typeof configSet !== 'function') return
      setStatus('saving')
      configSet({ ttl: ttl.trim(), replaceOfficial: replaceOn })
        .then((r) => {
          if (r && r.ok === false) {
            setStatus('error')
            return
          }
          if (r && r.ttl != null) setTtl(String(r.ttl))
          if (r && typeof r.replaceOfficial === 'boolean') setReplaceOn(r.replaceOfficial)
          // Settings can be open with the composer unmounted, so the saved value
          // is applied to whatever is on screen now and to the next mount.
          applyReplaceOfficial(r !== null && typeof r === 'object' && r.replaceOfficial === true)
          setStatus('saved')
        })
        .catch(() => setStatus('error'))
    }
    return react.createElement(
      'div',
      { className: 'dfu-settings' },
      react.createElement(
        'div',
        { className: 'dfu-settings-toggle' },
        react.createElement('span', { className: 'dfu-settings-toggle-label' }, tFn('replaceOfficial')),
        react.createElement(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': replaceOn,
            'aria-label': tFn('replaceOfficial'),
            className: 'dfu-switch',
            onClick: () => setReplaceOn(!replaceOn),
          },
          react.createElement('span', { className: 'dfu-switch-thumb' }),
        ),
      ),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('replaceHint')),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('replaceScope')),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('replaceRestore')),
      react.createElement(
        'div',
        { className: 'dfu-settings-row' },
        react.createElement('label', { className: 'dfu-settings-label' }, tFn('ttlLabel')),
        react.createElement('input', {
          className: 'dfu-settings-input',
          value: ttl,
          placeholder: '7d',
          spellCheck: false,
          onChange: (e) => setTtl(e.target.value),
        }),
      ),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('ttlHint')),
      react.createElement(
        'div',
        { className: 'dfu-settings-actions' },
        react.createElement(
          'button',
          { className: 'dfu-settings-save', disabled: status === 'saving', onClick: save },
          tFn('save'),
        ),
        status === 'saved' ? react.createElement('span', { className: 'dfu-settings-saved' }, tFn('saved')) : null,
        status === 'error' ? react.createElement('span', { className: 'dfu-chip-status dfu-chip-status-error' }, tFn('failed')) : null,
      ),
    )
  }

  // --- settings nav mark ----------------------------------------------------

  // Give the plugin's settings tab its own glyph. The shell renders every
  // unknown section id with the fallback gear, so the row is upgraded in place
  // once it exists in the DOM: the fallback svg is hidden (never detached —
  // React owns that node, and removing a node behind React's back makes its
  // unmount pass throw) and the paperclip is inserted ahead of it. A settings
  // tab then reads as this plugin at a glance instead of as a second "General".
  // The glyph is monochrome at rest and only takes the accent while the
  // section is open — a pure CSS state, driven by the cell's aria-current.
  function installSettingsNavMark() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const NS = 'http://www.w3.org/2000/svg'
    const build = () => {
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('data-dfu-mark', 'settings-nav')
      svg.setAttribute('class', 'dfu-nav-mark')
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', NAV_GLYPH_PATH)
      path.setAttribute('fill', 'currentColor')
      svg.appendChild(path)
      return svg
    }
    const patch = () => {
      const label = tFn('settingsTitle')
      const cells = document.querySelectorAll('nav button')
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i]
        const text = cell.textContent
        if (typeof text !== 'string' || text.trim() !== label) continue
        const fallback = cell.querySelector('svg')
        // No icon (unexpected shell shape), already ours, or already patched.
        if (fallback === null || fallback.getAttribute('data-dfu-mark') !== null) continue
        if (cell.querySelector('[data-dfu-mark]') !== null) continue
        fallback.style.display = 'none'
        cell.insertBefore(build(), fallback)
      }
    }
    let scheduled = false
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      const run = () => {
        scheduled = false
        patch()
      }
      // Coalesce a mutation burst into one scan; the settings panel is closed
      // most of the time, so the scan is a no-op then.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }
    patch()
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  // --- composer placement ---------------------------------------------------

  // The shell draws the composer tools as one flex row:
  //
  //   [+ menu] [official attach] [file input] [access/plan chips] [slot: left]
  //
  // and this plugin's button arrives through that last slot — to the right of
  // the mode chips, a few pixels away from the official paperclip it so closely
  // resembles. Two placements are handled here, neither of which touches a node
  // React owns:
  //
  //   - our button moves next to the official one (flex `order`; valid because
  //     the shell's slot wrapper is `display: contents`, which makes our label a
  //     flex item of the row itself);
  //   - when the user asks for it, the official button is hidden so the row
  //     keeps exactly one upload control and ours stands in its place.
  //
  // Every write records the value it replaced in a marker attribute, so a
  // switch-off, a plugin unload, or the next mount can put the shell back
  // exactly as it was drawn. On a shell that does not match, all of it is a
  // no-op: our button simply stays in its slot.
  const ATTACH_GLYPH_PREFIX = 'M5.5498' // shell paperclip (ic_ds_paperclip_outline_16)
  const SLOT_ANCHOR = '[data-slot="conversation.input.left"]'
  const ORDER_ATTR = 'data-dfu-order'
  const HIDDEN_ATTR = 'data-dfu-hidden'
  const OUR_ORDER = '1'
  const AFTER_ORDER = '2'

  let replaceOfficial = false
  let warnedMissingAttach = false

  /** Set (null clears) our flex order, remembering the inline value replaced. */
  function applyOrder(el, order) {
    if (order === null) {
      const previous = el.getAttribute(ORDER_ATTR)
      if (previous === null) return
      el.style.order = previous
      el.removeAttribute(ORDER_ATTR)
      return
    }
    if (el.getAttribute(ORDER_ATTR) === order) return
    if (!el.hasAttribute(ORDER_ATTR)) el.setAttribute(ORDER_ATTR, el.style.order || '')
    el.style.order = order
  }

  /** Hide or restore the shell's attach button, remembering its inline display. */
  function applyHidden(el, hidden) {
    if (hidden) {
      if (el.hasAttribute(HIDDEN_ATTR)) return
      el.setAttribute(HIDDEN_ATTR, el.style.display || '')
      el.style.display = 'none'
      return
    }
    const previous = el.getAttribute(HIDDEN_ATTR)
    if (previous === null) return
    el.style.display = previous
    el.removeAttribute(HIDDEN_ATTR)
  }

  /**
   * The shell's attach button inside one tools row: the paperclip glyph, never
   * the settings-nav mark (which reuses the same glyph).
   * @returns the button, or null when this row is not the shell's composer.
   */
  function findAttachButton(row) {
    const buttons = row.querySelectorAll('button')
    for (let i = 0; i < buttons.length; i += 1) {
      const button = buttons[i]
      if (button.querySelector('[data-dfu-mark]') !== null) continue
      const path = button.querySelector('svg path')
      if (path === null) continue
      const d = path.getAttribute('d')
      if (typeof d === 'string' && d.indexOf(ATTACH_GLYPH_PREFIX) === 0) return button
    }
    return null
  }

  /**
   * Place one composer around the shell's attach button.
   * @returns the attach button this row was placed against, or null.
   */
  function layoutComposer(anchor) {
    const row = anchor.parentElement
    if (row === null) return null
    const attach = findAttachButton(row)
    if (attach === null) return null
    // The flex item is the button itself, unless the shell wraps it.
    let attachItem = attach
    while (attachItem !== null && attachItem.parentElement !== row) attachItem = attachItem.parentElement
    if (attachItem === null) return null
    applyOrder(anchor, OUR_ORDER)
    const label = anchor.querySelector('.dfu-attach')
    if (label !== null) applyOrder(label, OUR_ORDER)
    // Everything the shell draws after its attach button follows ours.
    let passed = false
    const children = row.children
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      if (!passed) {
        if (child === attachItem) passed = true
        continue
      }
      if (child !== anchor) applyOrder(child, AFTER_ORDER)
    }
    applyHidden(attach, replaceOfficial)
    return attach
  }

  // The row already laid out, so the steady state costs a few property reads
  // instead of a document-wide scan per mutation — the shell mutates the DOM
  // continuously while a reply streams. Any node of it being replaced drops the
  // cache and forces a rescan.
  let laidOut = null

  function applyComposerLayout() {
    if (typeof document === 'undefined') return
    if (laidOut !== null && laidOut.row.isConnected && laidOut.anchor.isConnected && laidOut.attach.isConnected) {
      layoutComposer(laidOut.anchor)
      return
    }
    laidOut = null
    const anchors = document.querySelectorAll(SLOT_ANCHOR)
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i]
      const attach = layoutComposer(anchor)
      if (attach !== null) laidOut = { row: anchor.parentElement, anchor: anchor, attach: attach }
    }
    if (laidOut === null && anchors.length > 0 && replaceOfficial && !warnedMissingAttach) {
      // A composer without a recognizable attach button (a shell whose glyph or
      // structure changed): the official button stays visible and ours keeps its
      // slot, which is the pre-replacement behaviour rather than a broken row.
      warnedMissingAttach = true
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[dsh-web-file-uploader] official attach button not found; keeping the plugin button in its slot')
      }
    }
  }

  /** Give the shell its composer back: clear every marker we wrote. */
  function restoreComposerLayout() {
    if (typeof document === 'undefined') return
    laidOut = null
    const marked = document.querySelectorAll('[' + ORDER_ATTR + '], [' + HIDDEN_ATTR + ']')
    for (let i = 0; i < marked.length; i += 1) {
      applyOrder(marked[i], null)
      applyHidden(marked[i], false)
    }
  }

  function applyReplaceOfficial(next) {
    const value = next === true
    if (value === replaceOfficial) return
    replaceOfficial = value
    applyComposerLayout()
  }

  function installComposerLayout() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    // An instance disabled while it was replacing the official button leaves its
    // markers behind; undo them before deciding anything.
    restoreComposerLayout()
    applyComposerLayout()
    let scheduled = false
    const run = () => {
      scheduled = false
      applyComposerLayout()
    }
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      // Coalesce a mutation burst (streaming tokens, a session switch) into one
      // pass; the cached row makes the common pass almost free.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }
    // Child lists only: the composer is re-created on session switches, while
    // our own writes are attributes — so this observer never feeds itself.
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  // --- plugin entry ---------------------------------------------------------

  function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const locale = ctx.get('locale')
    if (locale !== undefined) {
      try {
        locale.register('dfu', 'zh', DICT.zh)
        locale.register('dfu', 'en', DICT.en)
        tFn = locale.bind('dfu')
        localeSvc = locale
      } catch (err) {
        tFn = (key) => key
      }
    }
    insertStyles(CSS)
    installSettingsNavMark()
    installComposerLayout()
    if (typeof ctx.effect === 'function') {
      // Disabling or unloading the plugin hands the official button back.
      ctx.effect(() => restoreComposerLayout, 'dfu: composer attach placement')
    }
    if (typeof configGet === 'function') {
      configGet()
        .then((cfg) => {
          if (cfg) applyReplaceOfficial(cfg.replaceOfficial === true)
        })
        .catch(() => {})
    }
    slots.inject('settings.section', () =>
      slots.register(
        { name: 'settings.section', id: 'dfu-settings', order: 40, label: () => tFn('settingsTitle'), inject: () => ({}) },
        () => react.createElement(SettingsPanel, {}),
      ),
    )
    slots.inject('conversation.input.left', () =>
      slots.register(
        { name: 'conversation.input.left', id: 'dfu-attach', order: 0 },
        (props) => react.createElement(AttachButton, props),
      ),
    )
    slots.inject('conversation.input.dock', () =>
      slots.register(
        { name: 'conversation.input.dock', id: 'dfu-uploads', order: 5 },
        (props) => react.createElement(UploadChips, props),
      ),
    )
  }

  return { apply }
}

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
        let sent = 0
        try {
          while (sent < file.size) {
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


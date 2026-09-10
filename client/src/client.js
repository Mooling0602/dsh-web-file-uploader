// GENERATED — do not edit. Edit src/core/client-core.js or this template, then
// run `node scripts/build-dynamic.mjs` to regenerate client/src/client.js.
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
      cancelling: '正在取消…',
      cancelTitle: '取消上传？',
      cancelBody: '这个文件还在上传中。取消会立刻中断传输，并丢弃已经发送的部分；返回则继续上传，文件照常保存。',
      cancelConfirm: '确认取消上传',
      cancelKeep: '返回继续上传',
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
      cancelling: 'Cancelling…',
      cancelTitle: 'Cancel this upload?',
      cancelBody: 'This file is still uploading. Cancelling stops the transfer now and throws away what has been sent; going back keeps uploading and saves the file as usual.',
      cancelConfirm: 'Cancel upload',
      cancelKeep: 'Keep uploading',
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

  // Fire-and-forget un-reference: the host keeps the file on disk, this session
  // just stops injecting it.
  const unref = (sessionId, path) => {
    if (!path) return
    try {
      remove({ sessionId: sessionId, path: path }).catch(() => {})
    } catch {
      // host unavailable — ignore
    }
  }

  // Close an attachment card. Once the file is on the host this only
  // un-references it (the model may still read it from the uploads folder).
  //
  // A card whose upload is still moving is a different story: the bytes are in
  // flight, and stopping them means throwing away what has already been sent.
  // Rather than deciding that silently — which would either waste the transfer
  // or discard a file the user wanted — the card asks first. "Keep uploading"
  // leaves the card (and its reference) alone, so no orphan copy is left behind
  // either way.
  const removeCard = (sessionId, id) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (!entry) return
    if (entry.status === 'uploading' && entry.controller) {
      store.update(sessionId, id, { confirmCancel: true })
      return
    }
    if (entry.path) unref(sessionId, entry.path)
    store.remove(sessionId, id)
  }

  // "Cancel upload": stop the transport now and drop the staged bytes. The card
  // stays in a cancelling state until the transport settles, because losing the
  // race (the host had already published the file) still owes the host an
  // un-reference — see the completion handler in AttachButton.
  const cancelUpload = (sessionId, id) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (!entry) return
    store.update(sessionId, id, { confirmCancel: false, status: 'cancelling' })
    try {
      entry.controller.abort()
    } catch {
      // already settled — the completion handler closes the card
    }
  }

  // "Keep uploading": dismiss the question and let the transfer run on.
  const keepUploading = (sessionId, id) => {
    store.update(sessionId, id, { confirmCancel: false })
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
        // One controller per file: the card's × can stop this transfer without
        // touching any other one in the same batch.
        const controller = typeof AbortController === 'function' ? new AbortController() : null
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
          controller: controller,
          confirmCancel: false,
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
          signal: controller === null ? undefined : controller.signal,
          onProgress: onProgress,
        })
          .then((res) => {
            const entry = store.files(sessionId).find((x) => x.id === id)
            const cancelled = entry !== undefined && entry.status === 'cancelling'
            if (res && res.ok) {
              if (cancelled) {
                // Lost the race by a hair: the host had already published the
                // file. Take the reference straight back out so it is never
                // injected and the TTL sweep can reclaim it.
                store.remove(sessionId, id)
                unref(sessionId, res.path)
              } else if (entry !== undefined) {
                store.update(sessionId, id, { status: 'done', path: res.path, savedSize: res.size })
              } else {
                unref(sessionId, res.path)
              }
            } else if (cancelled) {
              store.remove(sessionId, id)
            } else if (entry !== undefined) {
              store.update(sessionId, id, { status: 'error', error: (res && res.error) || 'upload failed' })
            }
          })
          .catch((err) => {
            const entry = store.files(sessionId).find((x) => x.id === id)
            if (entry === undefined) return
            if (entry.status === 'cancelling') {
              store.remove(sessionId, id)
              return
            }
            store.update(sessionId, id, { status: 'error', error: String((err && err.message) || err) })
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
      } else if (f.status === 'cancelling') {
        statusNode = react.createElement('span', { className: 'dfu-chip-status' }, tFn('cancelling'))
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
      // While a cancel is in flight the card has nothing left to decide.
      if (f.status !== 'cancelling') {
        actions.push(
          react.createElement(
            'button',
            { key: 'remove', type: 'button', className: 'dfu-chip-remove', title: tFn('remove'), onClick: () => removeCard(sessionId, f.id) },
            '×',
          ),
        )
      }
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
    // Confirmation surface for × on a card whose upload is still moving: both
    // answers are real, and both avoid leaving an orphan copy behind — cancel
    // drops the staged bytes, keep leaves the card (and its reference) alone.
    // Escape and a backdrop click take the safe branch.
    const asking = files.find((f) => f.confirmCancel === true)
    if (asking !== undefined) {
      chips.push(
        react.createElement(
          'div',
          {
            key: 'dfu-cancel-confirm',
            className: 'dfu-modal-backdrop',
            onClick: () => keepUploading(sessionId, asking.id),
          },
          react.createElement(
            'div',
            {
              className: 'dfu-modal',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': tFn('cancelTitle'),
              onClick: (event) => event.stopPropagation(),
              onKeyDown: (event) => {
                if (event.key === 'Escape') keepUploading(sessionId, asking.id)
              },
            },
            react.createElement('div', { className: 'dfu-modal-title' }, tFn('cancelTitle')),
            react.createElement('div', { className: 'dfu-modal-body' }, tFn('cancelBody')),
            react.createElement('div', { className: 'dfu-modal-file', title: asking.name }, asking.name),
            react.createElement(
              'div',
              { className: 'dfu-modal-actions' },
              react.createElement(
                'button',
                { type: 'button', className: 'dfu-modal-cancel', onClick: () => cancelUpload(sessionId, asking.id) },
                tFn('cancelConfirm'),
              ),
              react.createElement(
                'button',
                { type: 'button', className: 'dfu-modal-keep', autoFocus: true, onClick: () => keepUploading(sessionId, asking.id) },
                tFn('cancelKeep'),
              ),
            ),
          ),
        ),
      )
    }
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
/* Cancel-upload confirmation. The transfer is still running while this is open,
   so the dialog stays small and the safe answer ("keep uploading") is the
   focused default — Escape and a backdrop click take it too. */
.dfu-modal-backdrop {
  position: fixed; inset: 0; z-index: 40;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .35);
}
.dfu-modal {
  box-sizing: border-box; width: min(360px, calc(100vw - 32px));
  display: grid; gap: 10px; padding: 16px; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #1b1c1e);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .25));
  box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
}
.dfu-modal-title { font-size: 14px; font-weight: 600; }
.dfu-modal-body { font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #6b7280); }
.dfu-modal-file {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  color: var(--dsw-alias-label-secondary, #6b7280);
}
.dfu-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dfu-modal-actions button { padding: 5px 14px; font-size: 13px; border-radius: 8px; cursor: pointer; }
.dfu-modal-cancel {
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .3));
  background: transparent; color: var(--dsw-alias-state-error-primary, #ef4444);
}
.dfu-modal-cancel:hover { border-color: var(--dsw-alias-state-error-primary, #ef4444); }
.dfu-modal-keep {
  border: 1px solid var(--dsw-alias-brand-primary, #4d6bfe);
  background: var(--dsw-alias-brand-primary, #4d6bfe); color: #fff;
}
body[data-ds-dark-theme] .dfu-modal-keep { color: #000; }
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
        const bytes = Uint8Array.from(atob(args.base64), (c) => c.charCodeAt(0))
        const url = '/dsh-web-file-uploader/upload?name=' + encodeURIComponent(args.name) +
          '&mime=' + encodeURIComponent(args.mime || '') + '&session=' + encodeURIComponent(args.sessionId)
        const init = { method: 'POST', body: bytes }
        if (args.signal) init.signal = args.signal
        fetch(url, init).then((res) => res.json()).then(resolve).catch(reject)
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


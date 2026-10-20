// dsh-web-file-uploader — canonical CLIENT core (transport-agnostic)
//
// Single source of truth for the client UI + upload flow, inlined into the
// static client module (client/src/client.js) by scripts/build.ts.
//
// All environment interactions are injected through `deps`:
//   react              React namespace (injected by the build wrapper)
//   upload(args)       Promise<result>   { sessionId, name, mime, file }
//   remove(args)       Promise<void>     { sessionId, path }
//   delete(args)       Promise<void>     { sessionId, path }
//   configGet()        Promise<config>   { ttl, replaceOfficial, alwaysShowButton }
//   configSet(cfg)     Promise<config>
//   filesList()        Promise<{ files }>          settings-panel inventory
//   deleteMany(args)   Promise<result>   { sessionId, paths }
//   insertStyles(css)  -> void
//
// Returns { apply(ctx) }: registers the attach button + upload cards and the
// locale dictionaries, using the caller's transport.
//
// NOTE: this file must stay free of `import`/`require` — the build inlines it
// verbatim into the loader factory. Only `export function createClientCore` is
// used.

import type { CommandMenuCandidate, CommandUiService, PluginContext } from '../types.js'

/** The React surface this core uses — a structural subset. The build wrapper
 *  injects the real namespace through `require("react")`; the standalone
 *  (unwrapped) build leaves it null and apply() no-ops. */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<S>(initial: S): [S, (value: S | ((prev: S) => S)) => void]
  useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void
}

/** One upload card in the per-session store. */
export interface FileCard {
  id: string
  name: string
  size: number
  mime: string
  isImage: boolean
  previewUrl: string | null
  status: 'uploading' | 'done' | 'error' | 'cancelling'
  error: string | null
  path: string | null
  loaded: number
  total: number
  controller: AbortController | null
  confirmCancel: boolean
  savedSize?: number
  /** The host reused an already stored copy instead of writing these bytes. */
  dedup?: boolean
  /** The card references the file's own absolute path; nothing was uploaded. */
  local?: boolean
}

/** Environment interactions the client core needs, injected by the seam. */
export interface ClientCoreDeps {
  react: ReactLike
  upload(args: UploadArgs): Promise<UploadResult>
  remove(args: PathArgs): Promise<unknown>
  delete?(args: PathArgs): Promise<unknown>
  /** Reference original absolute paths instead of uploading bytes. */
  localRef?(args: LocalRefArgs): Promise<LocalRefResult>
  /** The shell's real host path for a picked file, or null when unavailable. */
  hostPathFor?(file: File): string | null
  configGet?(): Promise<DfuConfig | null>
  configSet?(cfg: Partial<DfuConfig>): Promise<(DfuConfig & { ok?: boolean }) | null>
  filesList?(): Promise<FilesListResult | null>
  /** This session's live references, so a reload can rebuild its cards. */
  pendingList?(sessionId: string): Promise<PendingRow[] | null>
  /** URL of a stored image's bytes, for a restored card's thumbnail. */
  thumbUrl?(sessionId: string, path: string): string
  deleteMany?(args: { sessionId?: string; paths: string[] }): Promise<DeleteManyResult | null>
  insertStyles?(css: string): void
}

export interface LocalRefCard {
  id: string
  name: string
  mime: string
  size: number
  path: string
}

export interface LocalRefArgs {
  sessionId?: string
  cards: LocalRefCard[]
}

export interface LocalRefRow {
  ok: boolean
  name?: string
  path?: string
  size?: number
  local?: boolean
  error?: string
}

export interface LocalRefResult {
  ok: boolean
  results?: LocalRefRow[]
  error?: string
}

export interface UploadArgs {
  sessionId?: string
  /** Composer card id; the host records it on the pending entry, so removal
   *  keeps working after a send-time fold moves the file. */
  id?: string
  name: string
  mime?: string
  size?: number
  file?: File
  base64?: string
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
}

export interface UploadResult {
  ok: boolean
  name?: string
  path?: string
  size?: number
  dedup?: boolean
  error?: string
}

export interface PathArgs {
  sessionId?: string
  /** Composer card id (stable across folds); `path` is the fallback. */
  id?: string
  path: string
}

export interface DfuConfig {
  ttl?: string
  replaceOfficial?: boolean
  alwaysShowButton?: boolean
  /** Max files one picker selection may upload; 0 means unlimited. */
  maxFiles?: number
  /** Send-time fold threshold (2..100): a group at or above it folds. */
  foldThreshold?: number
  /** Reference local files instead of uploading them (default on; Desktop). */
  skipLocalUpload?: boolean
}

/** One row of the settings "manage files" inventory (mirrors the host core). */
export interface ClientFileRow {
  hash: string
  path: string
  name: string
  size: number
  at: number
  exists: boolean
  inUse: boolean
  sessions: string[]
  overdue: boolean
}

export interface FilesListResult {
  ok: boolean
  files?: ClientFileRow[]
  ttl?: number
  now?: number
  error?: string
}

export interface DeleteManyResult {
  ok: boolean
  removed?: number
  skipped?: number
  failed?: number
  results?: unknown[]
  error?: string
}

/**
 * One live host reference, as the composer needs it to rebuild a card after a
 * page reload. The host keeps these in process memory; the composer keeps its
 * cards in component state, so without this the two drift apart on every
 * reload: no card on screen, but the reference keeps injecting into messages.
 */
export interface PendingRow {
  id: string
  name: string
  mime: string
  size: number
  path: string
  dedup: boolean
  local: boolean
  exists: boolean
  isImage: boolean
}

export interface ClientCore {
  apply(ctx: PluginContext): void
}

export function createClientCore(deps: ClientCoreDeps): ClientCore {
  const react = deps.react
  const upload = deps.upload
  const remove = deps.remove
  const del = deps.delete
  const localRef = deps.localRef
  const hostPathFor = deps.hostPathFor
  const configGet = deps.configGet
  const configSet = deps.configSet
  const filesList = deps.filesList
  const deleteMany = deps.deleteMany
  const pendingList = deps.pendingList
  const thumbUrl = deps.thumbUrl
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
  // plugin cannot declare its own glyph through the slot. The nav row
  // therefore gets the same paperclip the composer button shows — same path,
  // same transform, same viewBox and same rendered size, so the two are one
  // drawing in two places (see installSettingsNavMark).
  //
  // Artwork revision of that mark. A live page that hot-swaps this bundle
  // keeps the mark the previous revision inserted (React does not own the
  // node), so the stamp is how the next pass tells "already current" apart
  // from "stale, redraw".
  const NAV_MARK_REV = '2'

  const DICT = {
    zh: {
      attachTitle: '上传附件',
      uploading: '上传中…',
      saved: '已保存',
      copyPath: '复制路径',
      copyAllPaths: '复制全部路径',
      copiedAllPaths: '已复制 {n} 条路径',
      dockCount: '{n} 个文件',
      clearAllCards: '全部移除',
      clearAllHint: '从本会话移除全部已保存的文件卡片；文件仍保留在磁盘上，可在插件设置中管理。',
      clearAllQuestion: '移除 {n} 个卡片？',
      clearAllConfirm: '确认移除',
      clearAllCancel: '取消',
      deleteAllCards: '全部删除',
      deleteAllHint: '永久删除上传目录中的文件（不可找回）',
      deleteAllQuestion: '永久删除 {n} 个文件？',
      deleteAllConfirm: '确认删除',
      remove: '移除',
      delete: '删除文件（不可找回）',
      dedupCardHint: '相同内容已存在，本卡片复用上传目录中的副本；为避免误删共享文件，这里不提供永久删除，请到插件设置中管理。',
      localBadge: '本地',
      localCardHint: '直接引用本机原始文件，未上传副本；解除卡片只会移除引用，不会删除原文件。',
      failed: '失败',
      settingsTitle: '文件上传',
      ttlLabel: '自动清理保留期',
      ttlHint: '支持 1s / 1m / 1h / 1d，输入 0 表示永不清理。超过保留期且未被引用的文件会被自动清除。',
      maxFilesLabel: '单次上传最大文件数量',
      maxFilesHint: '0 表示不限制，默认 100；超过上限的整次选择会被拒绝。只统计本插件入口的一次选择。',
      maxFilesWarning: '已设为 0（不限制）：一次选择过多文件可能拖慢浏览器和宿主。',
      foldThresholdLabel: '单次上传文件折叠阈值',
      foldThresholdHint: '发送时，新增文件组或已有文件组各自达到该数量（2–100，默认 100）就折叠到时间戳目录；图片走原生注入时不计数。',
      increase: '增加',
      decrease: '减少',
      tooManyFilesTitle: '无法上传或引用更多文件',
      tooManyFilesBody: '单次上传最多 {n} 个文件。',
      ok: '知道了',
      save: '保存',
      replaceOfficial: '替代官方添加文件入口',
      replaceHint: '开启后隐藏官方「添加 → 文件」入口，在原位置换成插件自己的入口：斜向回形针图标，文字仍是「文件」，命令名改为 attach-file。',
      replaceScope: '该入口与本插件共用同一套上传流程；上传、进度与自动清理仍由本插件负责。保存后立即生效，无需刷新。',
      replaceRestore: '关闭开关并保存即可恢复官方入口；停用或卸载插件时也会自动恢复。',
      alwaysShowButton: '始终显示单独的附件上传按钮',
      alwaysShowHint: '开启时输入框旁始终显示本插件按钮。关闭后，若同时开启「替代官方添加文件入口」，输入框旁不再显示按钮，上传入口只保留在菜单里；未开启替代时按钮仍会显示，避免无处上传。',
      skipLocalUpload: '本地文件跳过上传',
      skipLocalUploadHint: '默认开启，仅桌面版支持：桌面版能提供宿主路径的文件直接本地引用、零上传。浏览器版始终上传，不受此开关影响；关闭后即使可本地引用也按普通文件上传。',
      menuFileLabel: '文件',
      cancelling: '正在取消…',
      cancelTitle: '取消上传？',
      cancelBody: '这个文件还在上传中。取消会立刻中断传输，并丢弃已经发送的部分；返回则继续上传，文件照常保存。',
      cancelConfirm: '确认取消上传',
      cancelKeep: '返回继续上传',
      manageTitle: '管理已上传的文件',
      manageHint: '这里列出本插件登记过的文件，可多选后永久删除。删除后模型将无法再读取这些路径。',
      manageEmpty: '还没有已上传的文件。',
      manageLoading: '正在读取…',
      manageFailed: '读取失败',
      manageUnreachable: '无法连接到宿主，请刷新页面后重试。',
      manageSelectAll: '全选',
      manageSelected: '已选 {n} 项',
      manageTotal: '{n} 个文件 · {size}',
      manageInUse: '使用中',
      manageInUseHint: '正在被会话引用，请在对话页面的文件卡片上点 × 或垃圾桶解除；重启 dsh web 也会清空全部引用记录。',
      manageInUseNotice: '带「使用中」标记的文件由会话引用，暂时无法在这里删除。请在对话页面的文件卡片上点 × 或垃圾桶解除引用，或重启 dsh web 清空全部引用记录后回来刷新。',
      manageOverdue: '已过期待清理',
      manageMissing: '文件已丢失',
      manageDelete: '删除所选',
      manageConfirmTitle: '删除所选文件？',
      manageConfirmBody: '将永久删除以下 {n} 个文件，无法找回；对话中引用过它们的路径也会失效。',
      manageConfirmOk: '确认删除',
      manageConfirmCancel: '取消',
      manageDone: '已删除 {n} 个文件',
      managePartial: '已删除 {n} 个，跳过 {m} 个被引用的',
      manageDeleteFailed: '删除失败',
      refresh: '刷新',
    },
    en: {
      attachTitle: 'Attach files',
      uploading: 'Uploading…',
      saved: 'Saved',
      copyPath: 'Copy path',
      copyAllPaths: 'Copy all paths',
      copiedAllPaths: 'Copied {n} paths',
      dockCount: '{n} files',
      clearAllCards: 'Remove all',
      clearAllHint: 'Removes every saved file card from this session; the files stay on disk and remain manageable in the plugin settings.',
      clearAllQuestion: 'Remove {n} cards?',
      clearAllConfirm: 'Remove',
      clearAllCancel: 'Cancel',
      deleteAllCards: 'Delete all',
      deleteAllHint: 'Permanently delete the uploaded files (cannot be undone)',
      deleteAllQuestion: 'Permanently delete {n} files?',
      deleteAllConfirm: 'Delete',
      remove: 'Remove',
      delete: 'Delete file (permanent)',
      dedupCardHint: 'Identical content is already stored, so this card reuses that copy. Permanent delete is hidden here to protect the shared file — manage uploaded files in the plugin settings.',
      localBadge: 'Local',
      localCardHint: 'References the original file on this machine; nothing was uploaded. Removing the card only drops the reference — the original file is never deleted.',
      failed: 'Failed',
      settingsTitle: 'File uploads',
      ttlLabel: 'Auto-cleanup retention',
      ttlHint: 'Use 1s / 1m / 1h / 1d; enter 0 to never clean. Files past the retention that are no longer referenced are removed automatically.',
      maxFilesLabel: 'Max files per upload',
      maxFilesHint: '0 means unlimited; default 100. A pick over the limit is refused as a whole. Counts one picker selection through this plugin.',
      maxFilesWarning: 'Set to 0 (unlimited): picking many files at once can slow the browser and the host.',
      foldThresholdLabel: 'Send-time fold threshold',
      foldThresholdHint: 'At send time, a new-file or existing-file group reaching this count (2–100, default 100) folds into a timestamped folder; natively injected images do not count.',
      increase: 'Increase',
      decrease: 'Decrease',
      tooManyFilesTitle: 'Cannot upload or reference more files',
      tooManyFilesBody: 'A single upload accepts at most {n} files.',
      ok: 'OK',
      save: 'Save',
      replaceOfficial: 'Replace the official add-file entry',
      replaceHint: 'Hides the official Add → File entry and puts this plugin’s own entry in its place: the angled paperclip icon, the same “File” text, and the command name attach-file.',
      replaceScope: 'That entry feeds this plugin’s upload flow; uploading, progress and auto-cleanup still come from this plugin. Saving applies at once, no refresh needed.',
      replaceRestore: 'Turning the switch off and saving brings the official entry back; disabling or removing the plugin restores it too.',
      alwaysShowButton: 'Always show the standalone attach button',
      alwaysShowHint: 'On shows this plugin’s button beside the input box at all times. Off hides it whenever “Replace the official add-file entry” is on, leaving the menu as the only upload entry; with replacement off the button still shows so an entry always exists.',
      skipLocalUpload: 'Skip upload for local files',
      skipLocalUploadHint: 'On by default and Desktop only: the Desktop shell reports real host paths, so those files are referenced in place with no upload. The browser web UI always uploads and ignores this switch; off uploads every file, even when a host path is available.',
      menuFileLabel: 'File',
      cancelling: 'Cancelling…',
      cancelTitle: 'Cancel this upload?',
      cancelBody: 'This file is still uploading. Cancelling stops the transfer now and throws away what has been sent; going back keeps uploading and saves the file as usual.',
      cancelConfirm: 'Cancel upload',
      cancelKeep: 'Keep uploading',
      manageTitle: 'Manage uploaded files',
      manageHint: 'Files this plugin has recorded. Select any number and delete them permanently; the model can no longer read those paths afterwards.',
      manageEmpty: 'No uploaded files yet.',
      manageLoading: 'Loading…',
      manageFailed: 'Could not load',
      manageUnreachable: 'Cannot reach the host. Refresh the page and try again.',
      manageSelectAll: 'Select all',
      manageSelected: '{n} selected',
      manageTotal: '{n} files · {size}',
      manageInUse: 'In use',
      manageInUseHint: 'Referenced by a session. Clear it with the × or the trash on the file card in the conversation, or restart dsh web to drop every reference.',
      manageInUseNotice: 'The files marked "In use" are referenced by a session and cannot be deleted here yet. Clear a reference with the × or the trash on the conversation\u2019s file card, or restart dsh web to drop every reference, then refresh.',
      manageOverdue: 'Past retention',
      manageMissing: 'Missing on disk',
      manageDelete: 'Delete selected',
      manageConfirmTitle: 'Delete the selected files?',
      manageConfirmBody: 'This permanently deletes {n} files and cannot be undone; paths referenced in the conversation stop resolving.',
      manageConfirmOk: 'Delete',
      manageConfirmCancel: 'Cancel',
      manageDone: 'Deleted {n} files',
      managePartial: 'Deleted {n}, skipped {m} still referenced',
      manageDeleteFailed: 'Delete failed',
      refresh: 'Refresh',
    },
  }

  let tFn: (key: string) => string = (key) => key
  let localeSvc: import('../types.js').LocaleService | null = null

  // Interpolate {name} placeholders in a localized string. The locale service's
  // bind() is only a key lookup, so substitution is ours; a missing argument
  // leaves the placeholder alone rather than printing "undefined".
  function tf(key: string, vars?: Record<string, unknown>): string {
    let out = tFn(key)
    if (typeof out !== 'string' || !vars) return out
    Object.keys(vars).forEach((k) => {
      out = out.split('{' + k + '}').join(String(vars[k]))
    })
    return out
  }

  // --- per-session upload store ---------------------------------------------

  interface UploadStore {
    files(sessionId: string | undefined): FileCard[]
    subscribe(fn: () => void): () => boolean
    add(sessionId: string | undefined, entry: FileCard): void
    update(sessionId: string | undefined, id: string, patch: Partial<FileCard>): void
    remove(sessionId: string | undefined, id: string): void
    /** One-shot composer notice (e.g. the over-limit popup), per session. */
    notice(sessionId: string | undefined): string | null
    setNotice(sessionId: string | undefined, text: string | null): void
  }

  function createStore(): UploadStore {
    const bySession = new Map<string | undefined, FileCard[]>()
    const noticeBySession = new Map<string | undefined, string>()
    const listeners = new Set<() => void>()
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
      notice(sessionId) {
        return noticeBySession.get(sessionId) ?? null
      },
      setNotice(sessionId, text) {
        if (text === null || text === '') noticeBySession.delete(sessionId)
        else noticeBySession.set(sessionId, text)
        emit()
      },
    }
  }
  const store = createStore()

  // --- card restore after a page reload -------------------------------------
  // A reload rebuilds this module, so every card is gone while the host still
  // holds the session's references — and keeps injecting them into later
  // messages with nothing on screen to release them. On mount the composer
  // pulls those rows once per session and rebuilds a "done" card for each.
  // Restored cards behave like any other finished card: × un-references, the
  // trash button deletes, and a send folds or injects them as usual.
  const restoredSessions = new Set<string>()

  const restoreCards = (sessionId: string | undefined) => {
    if (!sessionId || typeof pendingList !== 'function') return
    if (restoredSessions.has(sessionId)) return
    restoredSessions.add(sessionId)
    pendingList(sessionId)
      .then((rows) => {
        if (!Array.isArray(rows) || rows.length === 0) return
        const live = store.files(sessionId)
        for (const row of rows) {
          if (!row || typeof row.path !== 'string' || row.path === '') continue
          // A row whose stored copy vanished cannot be read by the model, so
          // release it instead of drawing a card that would never work.
          if (row.exists === false) {
            unref(sessionId, row.path, row.id)
            continue
          }
          // An upload that finished while this fetch was in flight already
          // produced the card; never show the same reference twice.
          if (live.some((c) => c.id === row.id || c.path === row.path)) continue
          const preview = row.isImage && typeof thumbUrl === 'function'
            ? thumbUrl(sessionId, row.path)
            : null
          store.add(sessionId, {
            id: row.id || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 9),
            name: row.name || row.path.slice(row.path.lastIndexOf('/') + 1),
            size: Number(row.size) || 0,
            mime: row.mime || '',
            isImage: row.isImage === true,
            previewUrl: preview,
            status: 'done',
            error: null,
            path: row.path,
            loaded: 0,
            total: 0,
            controller: null,
            confirmCancel: false,
            savedSize: Number(row.size) || 0,
            dedup: row.dedup === true,
            local: row.local === true,
          })
        }
      })
      .catch(() => {
        // Host older than this feature, or unreachable: cards stay empty, which
        // is exactly the pre-restore behaviour.
        restoredSessions.delete(sessionId)
      })
  }

  const formatSize = (bytes: number): string => {
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
  function sessionIdOf(props: unknown): string | undefined {
    const p = props as { sessionId?: unknown; session?: unknown } | null | undefined
    if (p) {
      if (typeof p.sessionId === 'string' && p.sessionId !== '') return p.sessionId
      const session = p.session as { sessionId?: unknown } | null | undefined
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
      const unsubs: Array<(() => void) | undefined> = []
      unsubs.push(store.subscribe(() => setV((x) => x + 1)))
      if (localeSvc !== null && typeof localeSvc.subscribe === 'function') {
        unsubs.push(localeSvc.subscribe(() => setV((x) => x + 1)))
      }
      return () => unsubs.forEach((fn) => { if (fn) fn() })
    }, [])
    return v
  }

  const copyText = (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {})
      }
    } catch {
      // clipboard unavailable — ignore
    }
  }

  // Fire-and-forget un-reference: the host keeps the file on disk, this session
  // just stops injecting it.
  const unref = (sessionId: string | undefined, path: string | null | undefined, id?: string) => {
    if (!path && !id) return
    try {
      remove({ sessionId: sessionId, id: id, path: path || '' }).catch(() => {})
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
  const removeCard = (sessionId: string | undefined, id: string) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (!entry) return
    if (entry.status === 'uploading' && entry.controller) {
      store.update(sessionId, id, { confirmCancel: true })
      return
    }
    if (entry.path) unref(sessionId, entry.path, id)
    store.remove(sessionId, id)
  }

  // "Cancel upload": stop the transport now and drop the staged bytes. The card
  // stays in a cancelling state until the transport settles, because losing the
  // race (the host had already published the file) still owes the host an
  // un-reference — see the completion handler in AttachButton.
  const cancelUpload = (sessionId: string | undefined, id: string) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (!entry) return
    store.update(sessionId, id, { confirmCancel: false, status: 'cancelling' })
    try {
      if (entry.controller !== null) entry.controller.abort()
    } catch {
      // already settled — the completion handler closes the card
    }
  }

  // "Keep uploading": dismiss the question and let the transfer run on.
  const keepUploading = (sessionId: string | undefined, id: string) => {
    store.update(sessionId, id, { confirmCancel: false })
  }

  // Permanently delete an attachment: drop the card AND remove the file from
  // the host (trash can). Falls back to remove (un-inject only) when the host
  // does not expose a `delete` RPC. Cross-session shared copies are protected
  // on the host side (removed:false) — this session's card still goes away.
  const deleteCard = (sessionId: string | undefined, id: string) => {
    const entry = store.files(sessionId).find((x) => x.id === id)
    if (entry && entry.path) {
      try {
        if (typeof del === 'function') {
          del({ sessionId: sessionId, id: id, path: entry.path }).catch(() => {})
        } else if (remove) {
          remove({ sessionId: sessionId, id: id, path: entry.path }).catch(() => {})
        }
      } catch {
        // host unavailable — ignore
      }
    }
    store.remove(sessionId, id)
  }

  // --- add-menu entry -------------------------------------------------------

  // The shell's add (+) button and its '/' command menu are one popup: both
  // open the same `command` trigger source, whose empty-query "Add" section
  // carries the built-in `file` row (client contribution registered by
  // ui-conversation, action `inputHub.pickFiles`). Replacing that entry means
  // swapping the command candidate itself, because the menu is React-rendered
  // from the candidate list — hiding a row in the DOM would leave keyboard
  // navigation and the pick dispatch pointing at the official action.
  const ATTACH_FILE_COMMAND = 'attach-file'

  // File inputs of the mounted composer buttons, keyed by session. The menu
  // action has to open the very picker the button opens, and the button is
  // detached (not unmounted) when the standalone entry is switched off, so the
  // input keeps living here.
  const pickerInputs = new Map<string, HTMLInputElement>()

  /** The menu row glyph: the same angled paperclip the composer button draws. */
  function AttachMenuIcon(props: { size?: number }) {
    const size = typeof props?.size === 'number' ? props.size : 14
    return react.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: PAPERCLIP_VIEW_BOX,
        fill: 'none',
        'aria-hidden': 'true',
      },
      react.createElement('path', {
        d: PAPERCLIP_PATH,
        fill: 'currentColor',
        transform: PAPERCLIP_TRANSFORM,
      }),
    )
  }

  /**
   * Open this plugin's file picker for one session: the menu row and the
   * composer button end in the same input, so both go through one upload path.
   * @param session - session context passed to the command action.
   */
  function openPluginPicker(session: unknown) {
    const sessionId = sessionIdOf(session)
    let input: HTMLInputElement | null | undefined = sessionId === undefined ? undefined : pickerInputs.get(sessionId)
    if (input === undefined) {
      pickerInputs.forEach((candidate) => {
        if (input === undefined) input = candidate
      })
    }
    if (input === undefined && typeof document !== 'undefined') {
      input = document.querySelector('.dfu-attach input[type="file"]') as HTMLInputElement | null
    }
    if (input !== undefined && input !== null && typeof input.click === 'function') input.click()
  }

  // --- components -----------------------------------------------------------

  function AttachButton(props: unknown) {
    useStoreVersion()
    const sessionId = sessionIdOf(props)
    const pickerKey = sessionId ?? ''
    const registerPicker = (el: HTMLInputElement | null) => {
      if (el === null) {
        pickerInputs.delete(pickerKey)
        return
      }
      pickerInputs.set(pickerKey, el)
    }
    const onPick = (event: Event) => {
      const input = event.target as HTMLInputElement
      const picked = Array.from(input.files || [])
      input.value = ''
      void startUpload(picked)
    }
    // One picker selection is one batch: the configured max-files limit applies
    // to it. A pick over the limit is refused as a whole — nothing is discarded,
    // because the notice already tells the user no further files can be added.
    // A failed config read falls back to the default so a broken settings route
    // cannot silently drop the guard.
    const startUpload = async (picked: File[]) => {
      if (picked.length === 0) return
      const files = picked
      let maxFiles = 100
      // The "skip upload for local files" switch (default on) decides whether a
      // picked file with a real host path is referenced in place or uploaded.
      let skipLocalUpload = true
      try {
        const cfg = typeof configGet === 'function' ? await configGet() : null
        const raw = cfg && typeof cfg.maxFiles === 'number' ? cfg.maxFiles : maxFiles
        if (Number.isFinite(raw)) maxFiles = Math.max(0, Math.min(10000, Math.floor(raw)))
        skipLocalUpload = !(cfg && cfg.skipLocalUpload === false)
      } catch {
        // keep the defaults
      }
      if (maxFiles > 0 && files.length > maxFiles) {
        store.setNotice(sessionId, tf('tooManyFilesBody', { n: maxFiles }))
        return
      }
      // Local references (no upload): the Desktop shell reports a picked file's
      // real absolute path, so the file joins the existing-file group by
      // reference instead of copying its bytes. Permission mode is deliberately
      // not consulted: the DSH sandbox confines writes only, reads are
      // unrestricted in every mode, so a local reference stays readable under
      // workspace-write / read-only / custom too. A served web page has no host
      // paths (and pasted bytes have none either), so those files still upload.
      // The default-on skipLocalUpload setting is the only switch: off uploads
      // every file, even when a host path is available.
      files.forEach((file: File) => {
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
        // The File object itself rides the transport: the static bundle posts
        // it as the request body, so nothing here reads the whole file into
        // memory. Progress arrives from the transport and only ever updates
        // the card's status line.
        const onProgress = (loaded: number, total: number) => {
          if (store.files(sessionId).some((x) => x.id === id)) {
            store.update(sessionId, id, { loaded: loaded, total: total || file.size })
          }
        }
        const settleUpload = (res: UploadResult) => {
          const entry = store.files(sessionId).find((x) => x.id === id)
          const cancelled = entry !== undefined && entry.status === 'cancelling'
          if (res && res.ok) {
            // Another card already owns this stored path (a repeat upload
            // dedups onto the same copy): merge into that card instead of
            // showing a duplicate, and release this upload's reference so the
            // host's pending count stays in step with the visible cards.
            const merged = res.path !== undefined &&
              store.files(sessionId).some((x) => x.id !== id && x.path === res.path)
            if (cancelled) {
              // Lost the race by a hair: the host had already published the
              // file. Take the reference straight back out so it is never
              // injected and the TTL sweep can reclaim it.
              store.remove(sessionId, id)
              unref(sessionId, res.path, id)
            } else if (merged) {
              store.remove(sessionId, id)
              unref(sessionId, res.path, id)
            } else if (entry !== undefined) {
              store.update(sessionId, id, {
                status: 'done',
                path: res.path,
                savedSize: res.size,
                dedup: res.dedup === true,
              })
            } else {
              unref(sessionId, res.path, id)
            }
          } else if (cancelled) {
            store.remove(sessionId, id)
          } else if (entry !== undefined) {
            store.update(sessionId, id, { status: 'error', error: (res && res.error) || 'upload failed' })
          }
        }
        const uploadNow = () => {
          upload({
            sessionId: sessionId,
            id: id,
            name: file.name,
            mime: file.type || '',
            size: file.size,
            file: file,
            signal: controller === null ? undefined : controller.signal,
            onProgress: onProgress,
          })
            .then(settleUpload)
            .catch((err) => {
              const entry = store.files(sessionId).find((x) => x.id === id)
              if (entry === undefined) return
              if (entry.status === 'cancelling') {
                store.remove(sessionId, id)
                return
              }
              store.update(sessionId, id, { status: 'error', error: String((err && err.message) || err) })
            })
        }
        let originalPath: string | null = null
        if (skipLocalUpload && typeof hostPathFor === 'function') {
          try {
            const p = hostPathFor(file)
            if (typeof p === 'string' && p !== '') originalPath = p
          } catch {
            originalPath = null
          }
        }
        if (originalPath === null || typeof localRef !== 'function') {
          uploadNow()
          return
        }
        // Register the absolute path; on refusal (moved, not a file, route
        // unreachable) fall back to uploading these bytes so the pick is never
        // silently lost.
        localRef({
          sessionId: sessionId,
          cards: [{ id: id, name: file.name, mime: file.type || '', size: file.size, path: originalPath }],
        })
          .then((res) => {
            const row = res && Array.isArray(res.results) ? res.results[0] : undefined
            if (!res || !res.ok || !row || row.ok !== true) {
              uploadNow()
              return
            }
            const entry = store.files(sessionId).find((x) => x.id === id)
            const cancelled = entry !== undefined && entry.status === 'cancelling'
            if (cancelled) {
              store.remove(sessionId, id)
              unref(sessionId, row.path, id)
              return
            }
            const merged = row.path !== undefined &&
              store.files(sessionId).some((x) => x.id !== id && x.path === row.path)
            if (merged) {
              store.remove(sessionId, id)
              unref(sessionId, row.path, id)
              return
            }
            if (entry !== undefined) {
              store.update(sessionId, id, { status: 'done', path: row.path, savedSize: row.size, local: true })
            }
          })
          .catch(() => uploadNow())
      })
    }
    return react.createElement(
      'label',
      { className: 'dfu-attach', title: tFn('attachTitle') },
      react.createElement('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: onPick, ref: registerPicker }),
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

  function UploadChips(props: unknown) {
    useStoreVersion()
    // Batch-state hooks must run before the empty-list early return so the hook
    // order stays stable when the last card closes.
    const [copiedAll, setCopiedAll] = react.useState(false)
    const [armed, setArmed] = react.useState<'clear' | 'delete' | null>(null)
    const sessionId = sessionIdOf(props)
    const files = store.files(sessionId)
    const notice = store.notice(sessionId)
    react.useEffect(() => {
      // Drop an armed batch confirmation once individual cards thin the list out.
      if (files.length <= 1) setArmed(null)
    }, [files.length])
    react.useEffect(() => {
      // Pull this session's live references once. This is the only moment the
      // client learns what the host still holds; without it a reload leaves the
      // references live but invisible, and they keep injecting into messages.
      restoreCards(sessionId)
    }, [sessionId])
    if (!files.length && notice === null) return null
    const chips: unknown[] = []
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
      const actions: unknown[] = []
      if (f.status === 'done' && f.path) {
        actions.push(
          react.createElement(
            'button',
            { key: 'copy', type: 'button', className: 'dfu-chip-copy', title: tFn('copyPath'), onClick: () => copyText(f.path || '') },
            tFn('copyPath'),
          ),
        )
        // Permanently delete only from the card that created the stored copy.
        // A re-upload is deduplicated onto the same path, so a trash button on
        // such a card would delete one shared file that other cards (and other
        // sessions, including earlier messages) still reference. Those cards
        // only un-reference (×); file-level deletion stays in the settings
        // panel, where the in-use rule still protects live references. A local
        // reference points at the user's own file, which the host must never
        // delete either.
        if (f.dedup !== true && f.local !== true) {
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
          {
            key: f.id,
            className: 'dfu-chip',
            title: f.local === true ? tFn('localCardHint') : f.dedup === true ? tFn('dedupCardHint') : undefined,
          },
          preview,
          react.createElement(
            'div',
            { className: 'dfu-chip-body' },
            react.createElement('span', { className: 'dfu-chip-name', title: f.name }, f.name),
            react.createElement(
              'span',
              { className: 'dfu-chip-meta' },
              f.local === true
                ? react.createElement('span', { className: 'dfu-chip-local', title: tFn('localCardHint') }, tFn('localBadge'))
                : null,
              // The separator stays outside the badge, or the badge's border
              // would close around it (one dangling dot inside the pill).
              f.local === true ? ' · ' : null,
              formatSize(f.size),
              ' · ',
              statusNode,
            ),
          ),
          react.createElement('span', { className: 'dfu-chip-actions' }, actions),
        ),
      )
    })
    // Confirmation surface for × on a card whose upload is still moving: both
    // answers are real, and both avoid leaving an orphan copy behind — cancel
    // drops the staged bytes, keep leaves the card (and its reference) alone.
    // Escape and a backdrop click take the safe branch. It is a sibling of the
    // card list, not a child, so the list's scroll overflow cannot clip it.
    const asking = files.find((f) => f.confirmCancel === true)
    let modal: unknown = null
    if (asking !== undefined) {
      modal = react.createElement(
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
            onClick: (event: Event) => event.stopPropagation(),
            onKeyDown: (event: KeyboardEvent) => {
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
      )
    }
    // Batch controls, shown once the dock holds more than one card: copy every
    // settled path at once, remove the cards (files stay on disk), or delete
    // the files permanently where that is safe. Cards still uploading are left
    // alone so a batch never silently discards bytes; their per-card × keeps
    // asking first.
    const settledPaths = files.filter((f) => f.status === 'done' && f.path).map((f) => f.path as string)
    const removable = files.filter((f) => f.status !== 'uploading' && f.status !== 'cancelling')
    // A card whose upload reused an existing copy must not take that shared
    // file down with it; a local reference points at the user's own file. A
    // batch only un-references those cards.
    const deletable = removable.filter((f) => f.status === 'done' && f.path && f.dedup !== true && f.local !== true)
    const copyAll = () => {
      if (!settledPaths.length) return
      copyText(settledPaths.join('\n'))
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1600)
    }
    const clearSettled = () => {
      removable.forEach((f) => removeCard(sessionId, f.id))
      setArmed(null)
    }
    const deleteSettled = () => {
      removable.forEach((f) => {
        if (f.status === 'done' && f.path && f.dedup !== true && f.local !== true) deleteCard(sessionId, f.id)
        else removeCard(sessionId, f.id)
      })
      setArmed(null)
    }
    const cancelArmed = () => setArmed(null)
    let batchBar: unknown = null
    if (files.length > 1) {
      const batchChildren: unknown[] = [
        react.createElement('span', { key: 'count', className: 'dfu-dock-count' }, tf('dockCount', { n: files.length })),
      ]
      if (armed === 'clear') {
        batchChildren.push(
          react.createElement('span', { key: 'question', className: 'dfu-dock-question' }, tf('clearAllQuestion', { n: removable.length })),
          react.createElement(
            'button',
            { key: 'confirm', type: 'button', className: 'dfu-dock-action dfu-dock-action-danger', onClick: clearSettled },
            tFn('clearAllConfirm'),
          ),
          react.createElement('button', { key: 'cancel', type: 'button', className: 'dfu-dock-action', onClick: cancelArmed }, tFn('clearAllCancel')),
        )
      } else if (armed === 'delete') {
        batchChildren.push(
          react.createElement('span', { key: 'question', className: 'dfu-dock-question' }, tf('deleteAllQuestion', { n: deletable.length })),
          react.createElement(
            'button',
            { key: 'confirm', type: 'button', className: 'dfu-dock-action dfu-dock-action-danger', onClick: deleteSettled },
            tFn('deleteAllConfirm'),
          ),
          react.createElement('button', { key: 'cancel', type: 'button', className: 'dfu-dock-action', onClick: cancelArmed }, tFn('clearAllCancel')),
        )
      } else {
        if (settledPaths.length > 0) {
          batchChildren.push(
            react.createElement(
              'button',
              { key: 'copy', type: 'button', className: 'dfu-dock-action', onClick: copyAll },
              copiedAll ? tf('copiedAllPaths', { n: settledPaths.length }) : tFn('copyAllPaths'),
            ),
          )
        }
        if (removable.length > 0) {
          batchChildren.push(
            react.createElement(
              'button',
              {
                key: 'clear',
                type: 'button',
                className: 'dfu-dock-action dfu-dock-action-danger',
                title: tFn('clearAllHint'),
                onClick: () => setArmed('clear'),
              },
              tFn('clearAllCards'),
            ),
          )
        }
        if (deletable.length > 0) {
          batchChildren.push(
            react.createElement(
              'button',
              {
                key: 'delete',
                type: 'button',
                className: 'dfu-dock-action dfu-dock-action-danger',
                title: tFn('deleteAllHint'),
                onClick: () => setArmed('delete'),
              },
              tFn('deleteAllCards'),
            ),
          )
        }
      }
      batchBar = react.createElement('div', { className: 'dfu-dock-bar' }, batchChildren)
    }
    // Over-limit picker notice: a fixed dialog (like the cancel confirmation)
    // so it stays visible regardless of where the dock sits in the composer.
    const noticeModal = notice === null
      ? null
      : react.createElement(
          'div',
          {
            key: 'dfu-notice',
            className: 'dfu-modal-backdrop',
            onClick: () => store.setNotice(sessionId, null),
          },
          react.createElement(
            'div',
            {
              className: 'dfu-modal',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': tFn('tooManyFilesTitle'),
              onClick: (event: Event) => event.stopPropagation(),
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key === 'Escape') store.setNotice(sessionId, null)
              },
            },
            react.createElement('div', { className: 'dfu-modal-title' }, tFn('tooManyFilesTitle')),
            react.createElement('div', { className: 'dfu-modal-body' }, notice),
            react.createElement(
              'div',
              { className: 'dfu-modal-actions' },
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dfu-modal-keep',
                  autoFocus: true,
                  onClick: () => store.setNotice(sessionId, null),
                },
                tFn('ok'),
              ),
            ),
          ),
        )
    return react.createElement(
      'div',
      { className: 'dfu-dock' },
      batchBar,
      react.createElement('div', { className: 'dfu-dock-list' }, chips),
      modal,
      noticeModal,
    )
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
/* Standalone button detached: the add-menu entry is the upload entry, so the
   composer button keeps its input mounted (the menu action clicks it) but
   takes no space in the tool row. Absolute, not display:none — the programmatic
   picker click must stay possible on a control that left the flow. */
.dfu-attach[data-dfu-detached] {
  position: absolute;
  width: 0; height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.dfu-dock {
  box-sizing: border-box;
  width: calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));
  max-width: calc(var(--dsh-composer-card-max-width, 100%) - var(--dsh-composer-dock-inset, 0px) - var(--dsh-composer-dock-inset, 0px));
  margin: 0 auto;
  padding: 2px var(--dsh-composer-dock-inset, 0px) 10px;
  flex: none;
  display: flex; flex-direction: column;
}
/* Batch controls above the card list: a muted file count on the left, small
   text actions on the right. The two-step "remove all" swaps the actions for
   a question + confirm/cancel so a batch never removes every card on one
   stray click. */
.dfu-dock-bar {
  display: flex; align-items: center; gap: 4px;
  padding: 0 2px 6px;
  font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98);
}
.dfu-dock-count { margin-right: auto; }
.dfu-dock-question { white-space: nowrap; }
.dfu-dock-action {
  border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #8a8f98);
  font-size: 12px; line-height: 1.5; padding: 2px 6px; border-radius: 6px;
  white-space: nowrap;
}
.dfu-dock-action:hover {
  color: var(--dsw-alias-brand-primary, #4d6bfe);
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.12));
}
.dfu-dock-action-danger:hover { color: var(--dsw-alias-state-error-primary, #ef4444); }
/* The card list scrolls instead of growing without bound and pushing the
   composer (and the conversation) up: two rows of cards fit, and any extra
   files scroll here. The cancel-confirmation dialog is a sibling, so this
   overflow never clips it (a scroll container would otherwise clip a
   non-fixed child, though a fixed backdrop would still escape). */
.dfu-dock-list {
  display: flex; flex-wrap: wrap; gap: 8px;
  max-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.4)) transparent;
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
/* Local reference badge: no bytes were uploaded, the model reads the original. */
.dfu-chip-local {
  color: var(--dsw-alias-brand-primary, #4d6bfe);
  border: 1px solid currentColor; border-radius: 999px;
  padding: 0 5px; font-size: 11px; line-height: 1.5;
}
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
/* Settings page: one column that fills the section's content area (the shell's
   options column already supplies 24px of side padding). The page's own 8/16px
   inset matches the built-in settings cards' inner padding, so the plugin's
   copy and controls sit on the same grid as the shell's own pages instead of
   hugging the column edge; 720px is the shell's readable-width cap. */
.dfu-settings {
  display: flex; flex-direction: column; gap: 14px;
  width: 100%; max-width: 720px; box-sizing: border-box;
  padding: 8px 16px;
}
/* The uploaded-file block inside the page column. */
.dfu-manage { display: flex; flex-direction: column; gap: 10px; }
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
/* Max-files stepper: a compact − [n] + cluster after the label. */
.dfu-settings-stepper { gap: 6px; }
.dfu-settings-stepper .dfu-settings-label { flex: 1; }
.dfu-stepper-btn {
  width: 26px; height: 26px; flex: none; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 15px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .25));
  border-radius: 7px; background: transparent;
  color: var(--dsw-alias-label-secondary, #8a8f98);
}
.dfu-stepper-btn:hover {
  color: var(--dsw-alias-label-primary, #333);
  background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, .08));
}
.dfu-stepper-input { flex: 0 0 72px; text-align: center; padding: 4px 6px; }
.dfu-settings-warning { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary, #ef4444); }
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
/* The mark's own box is the composer button's 17.24px, so the two clips are
   pixel-identical rather than merely similar. Half the difference to the nav's
   16px icon column (0.62px) is taken back on each side, which keeps the ink
   centred on the column and leaves every sibling row's label offset unchanged. */
.dfu-nav-mark { flex: none; margin: calc((16px - 17.24px) / 2); }
nav button[aria-current='true'] .dfu-nav-mark { color: var(--dsw-static-deepseek-450, #5686fe); }

/* Manage-files panel. Rows are labels so the whole row toggles the checkbox;
   the list scrolls on its own because the settings column already scrolls. */
.dfu-manage-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.dfu-manage-empty { font-size: 13px; color: var(--dsw-alias-label-secondary, #8a8f98); padding: 8px 0; }
.dfu-manage-error { color: var(--dsw-alias-state-error-primary, #ef4444); }
.dfu-manage-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 6px; }
.dfu-manage-all { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.dfu-manage-count { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
.dfu-manage-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, .22));
  border-radius: var(--dsw-radius-md, 8px);
}
.dfu-manage-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, .14));
}
.dfu-manage-row:last-child { border-bottom: none; }
.dfu-manage-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .08)); }
.dfu-manage-row-locked { cursor: default; opacity: .72; }
.dfu-manage-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dfu-manage-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dfu-manage-meta { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
.dfu-manage-badges { display: inline-flex; gap: 6px; flex: none; }
.dfu-manage-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, .16));
  color: var(--dsw-alias-label-secondary, #8a8f98);
}
.dfu-manage-badge-use { color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dfu-manage-notice {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #8a8f98);
  background: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, .1));
  border-radius: var(--dsw-radius-md, 8px);
  padding: 8px 10px;
  margin-bottom: 8px;
}
.dfu-manage-delete { margin-left: auto; }
.dfu-manage-refresh {
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, .28));
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  cursor: pointer;
}
.dfu-manage-refresh:disabled { opacity: .6; cursor: default; }
.dfu-manage-status { font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); margin-top: 6px; }
.dfu-settings-divider { height: 1px; background: var(--dsw-alias-border-secondary, rgba(128, 128, 128, .2)); margin: 4px 0; }
`

  // --- settings panel ------------------------------------------------------

  function SettingsPanel() {
    useStoreVersion()
    const [ttl, setTtl] = react.useState('')
    const [replaceOn, setReplaceOn] = react.useState(false)
    const [alwaysShowOn, setAlwaysShowOn] = react.useState(true)
    const [skipLocalOn, setSkipLocalOn] = react.useState(true)
    const [maxFiles, setMaxFiles] = react.useState('100')
    const [foldThreshold, setFoldThreshold] = react.useState('100')
    const [status, setStatus] = react.useState('') // '' | 'saving' | 'saved' | 'error'
    react.useEffect(() => {
      let alive = true
      if (typeof configGet === 'function') {
        configGet()
          .then((r) => {
            if (!alive || !r) return
            if (r.ttl != null) setTtl(String(r.ttl))
            setReplaceOn(r.replaceOfficial === true)
            setAlwaysShowOn(r.alwaysShowButton !== false)
            setSkipLocalOn(r.skipLocalUpload !== false)
            if (r.maxFiles != null) setMaxFiles(String(r.maxFiles))
            if (r.foldThreshold != null) setFoldThreshold(String(r.foldThreshold))
          })
          .catch(() => {})
      }
      return () => { alive = false }
    }, [])
    // The max-files control is a stepper: the buttons move by ten, typing wins
    // for exact values, and the save path clamps whatever ended up in the box.
    const clampMaxFiles = (raw: string): number => {
      const n = Number(raw)
      if (!Number.isFinite(n)) return 100
      return Math.max(0, Math.min(10000, Math.floor(n)))
    }
    const stepMaxFiles = (delta: number) => {
      const base = Number(maxFiles)
      const from = Number.isFinite(base) ? Math.floor(base) : 100
      setMaxFiles(String(Math.max(0, Math.min(10000, from + delta))))
    }
    const maxFilesNum = Number(maxFiles)
    const maxFilesIsZero = maxFiles.trim() !== '' && maxFilesNum === 0
    // Fold threshold: 2..100, one step per click (the range is small).
    const clampFoldThreshold = (raw: string): number => {
      const n = Number(raw)
      if (!Number.isFinite(n)) return 100
      return Math.max(2, Math.min(100, Math.floor(n)))
    }
    const stepFoldThreshold = (delta: number) => {
      const base = Number(foldThreshold)
      const from = Number.isFinite(base) ? Math.floor(base) : 100
      setFoldThreshold(String(Math.max(2, Math.min(100, from + delta))))
    }
    const save = () => {
      if (typeof configSet !== 'function') return
      setStatus('saving')
      configSet({
        ttl: ttl.trim(),
        replaceOfficial: replaceOn,
        alwaysShowButton: alwaysShowOn,
        skipLocalUpload: skipLocalOn,
        maxFiles: clampMaxFiles(maxFiles),
        foldThreshold: clampFoldThreshold(foldThreshold),
      })
        .then((r) => {
          if (r && r.ok === false) {
            setStatus('error')
            return
          }
          if (r && r.ttl != null) setTtl(String(r.ttl))
          if (r && r.maxFiles != null) setMaxFiles(String(r.maxFiles))
          if (r && r.foldThreshold != null) setFoldThreshold(String(r.foldThreshold))
          // Echo wins when the host knows the field; an older host that does not
          // still keeps the requested values, so saving never flips the switch
          // back on screen.
          const nextReplace = r && typeof r.replaceOfficial === 'boolean' ? r.replaceOfficial : replaceOn
          const nextAlwaysShow = r && typeof r.alwaysShowButton === 'boolean' ? r.alwaysShowButton : alwaysShowOn
          const nextSkipLocal = r && typeof r.skipLocalUpload === 'boolean' ? r.skipLocalUpload : skipLocalOn
          setReplaceOn(nextReplace)
          setAlwaysShowOn(nextAlwaysShow)
          setSkipLocalOn(nextSkipLocal)
          // Settings can be open with the composer unmounted, so the saved values
          // are applied to whatever is on screen now and to the next mount.
          applyUploadEntrySettings(nextReplace, nextAlwaysShow)
          setStatus('saved')
        })
        .catch(() => setStatus('error'))
    }
    return react.createElement(
      'div',
      { className: 'dfu-settings' },
      react.createElement(ManagePanel, {}),
      react.createElement('div', { className: 'dfu-settings-divider' }),
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
        { className: 'dfu-settings-toggle' },
        react.createElement('span', { className: 'dfu-settings-toggle-label' }, tFn('alwaysShowButton')),
        react.createElement(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': alwaysShowOn,
            'aria-label': tFn('alwaysShowButton'),
            className: 'dfu-switch',
            onClick: () => setAlwaysShowOn(!alwaysShowOn),
          },
          react.createElement('span', { className: 'dfu-switch-thumb' }),
        ),
      ),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('alwaysShowHint')),
      react.createElement(
        'div',
        { className: 'dfu-settings-toggle' },
        react.createElement('span', { className: 'dfu-settings-toggle-label' }, tFn('skipLocalUpload')),
        react.createElement(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': skipLocalOn,
            'aria-label': tFn('skipLocalUpload'),
            className: 'dfu-switch',
            onClick: () => setSkipLocalOn(!skipLocalOn),
          },
          react.createElement('span', { className: 'dfu-switch-thumb' }),
        ),
      ),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('skipLocalUploadHint')),
      react.createElement(
        'div',
        { className: 'dfu-settings-row dfu-settings-stepper' },
        react.createElement('label', { className: 'dfu-settings-label' }, tFn('maxFilesLabel')),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dfu-stepper-btn dfu-maxfiles-step',
            title: tFn('decrease'),
            'aria-label': tFn('decrease'),
            onClick: () => stepMaxFiles(-10),
          },
          '\u2212',
        ),
        react.createElement('input', {
          className: 'dfu-settings-input dfu-stepper-input dfu-maxfiles-input',
          value: maxFiles,
          inputMode: 'numeric',
          spellCheck: false,
          onChange: (e: Event) => {
            const next = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 5)
            setMaxFiles(next)
          },
        }),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dfu-stepper-btn dfu-maxfiles-step',
            title: tFn('increase'),
            'aria-label': tFn('increase'),
            onClick: () => stepMaxFiles(10),
          },
          '+',
        ),
      ),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('maxFilesHint')),
      maxFilesIsZero
        ? react.createElement('div', { className: 'dfu-settings-warning' }, tFn('maxFilesWarning'))
        : null,
      react.createElement(
        'div',
        { className: 'dfu-settings-row dfu-settings-stepper' },
        react.createElement('label', { className: 'dfu-settings-label' }, tFn('foldThresholdLabel')),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dfu-stepper-btn dfu-fold-step',
            title: tFn('decrease'),
            'aria-label': tFn('decrease'),
            onClick: () => stepFoldThreshold(-1),
          },
          '\u2212',
        ),
        react.createElement('input', {
          className: 'dfu-settings-input dfu-stepper-input dfu-fold-input',
          value: foldThreshold,
          inputMode: 'numeric',
          spellCheck: false,
          onChange: (e: Event) => {
            const next = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 3)
            setFoldThreshold(next)
          },
        }),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dfu-stepper-btn dfu-fold-step',
            title: tFn('increase'),
            'aria-label': tFn('increase'),
            onClick: () => stepFoldThreshold(1),
          },
          '+',
        ),
      ),
      react.createElement('div', { className: 'dfu-settings-hint' }, tFn('foldThresholdHint')),
      react.createElement(
        'div',
        { className: 'dfu-settings-row' },
        react.createElement('label', { className: 'dfu-settings-label' }, tFn('ttlLabel')),
        react.createElement('input', {
          className: 'dfu-settings-input',
          value: ttl,
          placeholder: '7d',
          spellCheck: false,
          onChange: (e: Event) => setTtl((e.target as HTMLInputElement).value),
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

  // --- settings: manage uploaded files -------------------------------------

  // Lists every file the plugin recorded in the per-root dedup index and lets
  // the user delete a selection permanently. Two safety rules are mirrored
  // straight from the host core rather than re-implemented here:
  //   - a file still referenced by a live session is listed but not selectable,
  //     and the row says to clear it from the conversation's own file card;
  //   - a file that has vanished from disk is reported, never silently dropped.
  // The list is read on mount, after each delete, and on demand; nothing polls,
  // because the panel is only open while the user is looking at it.
  function ManagePanel() {
    const [rows, setRows] = react.useState<ClientFileRow[] | null>(null) // null = not loaded yet
    const [error, setError] = react.useState('')
    const [checked, setChecked] = react.useState<Record<string, boolean>>({})
    const [busy, setBusy] = react.useState(false)
    const [asking, setAsking] = react.useState(false)
    const [status, setStatus] = react.useState('')

    const load = () => {
      if (typeof filesList !== 'function') {
        setError(tFn('manageUnreachable'))
        setRows([])
        return
      }
      setError('')
      filesList()
        .then((r) => {
          if (!r || r.ok === false) {
            setError((r && r.error) || tFn('manageFailed'))
            setRows([])
            return
          }
          const next = Array.isArray(r.files) ? r.files : []
          setRows(next)
          // Drop selections that are gone (a file may have been deleted from the
          // conversation while this panel stayed open).
          const live: Record<string, boolean> = {}
          next.forEach((f) => { live[f.path] = true })
          setChecked((prev) => {
            const kept: Record<string, boolean> = {}
            Object.keys(prev).forEach((k) => { if (prev[k] && live[k]) kept[k] = true })
            return kept
          })
        })
        .catch(() => {
          setError(tFn('manageUnreachable'))
          setRows([])
        })
    }
    react.useEffect(() => {
      load()
    }, [])

    const items = rows || []
    const inUseCount = items.filter((f) => f.inUse).length
    const selectable = items.filter((f) => !f.inUse && f.exists)
    const selectedPaths = Object.keys(checked).filter((k) => checked[k])
    const selectedSet: Record<string, boolean> = {}
    selectedPaths.forEach((p) => { selectedSet[p] = true })
    const selectedRows = items.filter((f) => selectedSet[f.path])
    const selectedBytes = selectedRows.reduce((sum, f) => sum + (Number(f.size) || 0), 0)
    const allSelected = selectable.length > 0 && selectable.every((f) => selectedSet[f.path])
    const totalBytes = items.reduce((sum, f) => sum + (Number(f.size) || 0), 0)

    const toggle = (path: string) => {
      setStatus('')
      setChecked((prev) => {
        const next = Object.assign({}, prev)
        if (next[path]) delete next[path]
        else next[path] = true
        return next
      })
    }
    const toggleAll = () => {
      if (allSelected) {
        setChecked({})
        return
      }
      const next: Record<string, boolean> = {}
      selectable.forEach((f) => { next[f.path] = true })
      setChecked(next)
    }
    const runDelete = () => {
      if (typeof deleteMany !== 'function' || selectedPaths.length === 0) return
      setBusy(true)
      setAsking(false)
      setStatus('')
      deleteMany({ paths: selectedPaths })
        .then((r) => {
          const n = r && typeof r.removed === 'number' ? r.removed : 0
          const skipped = r && typeof r.skipped === 'number' ? r.skipped : 0
          const failed = r && typeof r.failed === 'number' ? r.failed : 0
          if (failed > 0 && r && r.error) setStatus(String(r.error))
          else if (skipped > 0) setStatus(tf('managePartial', { n, m: skipped }))
          else setStatus(tf('manageDone', { n }))
          setChecked({})
          setBusy(false)
          load()
        })
        .catch(() => {
          setStatus(tFn('manageDeleteFailed'))
          setBusy(false)
        })
    }

    const children = []
    children.push(react.createElement('div', { className: 'dfu-manage-title' }, tFn('manageTitle')))
    children.push(react.createElement('div', { className: 'dfu-settings-hint' }, tFn('manageHint')))

    if (rows === null) {
      children.push(react.createElement('div', { className: 'dfu-manage-empty' }, tFn('manageLoading')))
    } else if (error) {
      children.push(react.createElement('div', { className: 'dfu-manage-empty dfu-manage-error' }, error))
    } else if (items.length === 0) {
      children.push(react.createElement('div', { className: 'dfu-manage-empty' }, tFn('manageEmpty')))
    } else {
      children.push(
        react.createElement(
          'div',
          { className: 'dfu-manage-bar' },
          react.createElement(
            'label',
            { className: 'dfu-manage-all' },
            react.createElement('input', {
              type: 'checkbox',
              checked: allSelected,
              disabled: selectable.length === 0,
              onChange: toggleAll,
            }),
            react.createElement('span', null, tFn('manageSelectAll')),
          ),
          react.createElement('span', { className: 'dfu-manage-count' }, tf('manageTotal', { n: items.length, size: formatSize(totalBytes) })),
        ),
      )

      // Say it once above the list rather than only in a per-row tooltip: a
      // locked row is the one thing here the user cannot resolve in this panel.
      if (inUseCount > 0) {
        children.push(react.createElement('div', { className: 'dfu-manage-notice' }, tFn('manageInUseNotice')))
      }

      const list = items.map((f) => {
        // A referenced file, or one whose bytes are already gone, is shown but
        // never selectable: the first is the host's cross-session guard, the
        // second has nothing left to delete.
        const locked = f.inUse || !f.exists
        const badges: unknown[] = []
        if (f.inUse) {
          badges.push(react.createElement('span', { key: 'use', className: 'dfu-manage-badge dfu-manage-badge-use', title: tFn('manageInUseHint') }, tFn('manageInUse')))
        }
        if (!f.exists) {
          badges.push(react.createElement('span', { key: 'gone', className: 'dfu-manage-badge' }, tFn('manageMissing')))
        } else if (f.overdue) {
          badges.push(react.createElement('span', { key: 'over', className: 'dfu-manage-badge' }, tFn('manageOverdue')))
        }
        const meta: string[] = [formatSize(f.size)]
        if (f.at > 0) meta.push(new Date(f.at).toLocaleString())
        return react.createElement(
          'label',
          { key: f.path, className: 'dfu-manage-row' + (locked ? ' dfu-manage-row-locked' : '') },
          react.createElement('input', {
            type: 'checkbox',
            checked: selectedSet[f.path] === true,
            disabled: locked || busy,
            title: locked ? tFn('manageInUseHint') : f.path,
            onChange: () => toggle(f.path),
          }),
          react.createElement(
            'span',
            { className: 'dfu-manage-body' },
            react.createElement('span', { className: 'dfu-manage-name', title: f.path }, f.name),
            react.createElement('span', { className: 'dfu-manage-meta' }, meta.join(' · ')),
          ),
          badges.length ? react.createElement('span', { className: 'dfu-manage-badges' }, badges) : null,
        )
      })
      children.push(react.createElement('div', { className: 'dfu-manage-list' }, list))

      const actions: unknown[] = []
      if (selectedPaths.length > 0) {
        actions.push(react.createElement('span', { key: 'n', className: 'dfu-manage-count' }, tf('manageSelected', { n: selectedPaths.length })))
      }
      actions.push(
        react.createElement(
          'button',
          {
            key: 'del',
            type: 'button',
            className: 'dfu-settings-save dfu-manage-delete',
            disabled: busy || selectedPaths.length === 0,
            onClick: () => setAsking(true),
          },
          tFn('manageDelete'),
        ),
      )
      actions.push(
        react.createElement(
          'button',
          { key: 'r', type: 'button', className: 'dfu-manage-refresh', disabled: busy, onClick: load },
          tFn('refresh'),
        ),
      )
      children.push(react.createElement('div', { className: 'dfu-settings-actions' }, actions))
      if (status) children.push(react.createElement('div', { className: 'dfu-manage-status' }, status))
    }

    // Confirmation dialog: a permanent multi-file delete deserves an explicit
    // stop, so the count and the total size are spelled out first.
    if (asking) {
      children.push(
        react.createElement(
          'div',
          { className: 'dfu-modal-backdrop', onClick: () => setAsking(false) },
          react.createElement(
            'div',
            { className: 'dfu-modal', onClick: (e: Event) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation() } },
            react.createElement('div', { className: 'dfu-modal-title' }, tFn('manageConfirmTitle')),
            react.createElement('div', { className: 'dfu-modal-body' }, tf('manageConfirmBody', { n: selectedPaths.length })),
            react.createElement('div', { className: 'dfu-modal-file' }, selectedPaths.length + ' · ' + formatSize(selectedBytes)),
            react.createElement(
              'div',
              { className: 'dfu-modal-actions' },
              react.createElement('button', { type: 'button', className: 'dfu-modal-cancel', onClick: () => setAsking(false) }, tFn('manageConfirmCancel')),
              react.createElement('button', { type: 'button', className: 'dfu-modal-keep', autoFocus: true, onClick: runDelete }, tFn('manageConfirmOk')),
            ),
          ),
        ),
      )
    }

    // The file manager keeps its page inset from the outer `.dfu-settings`; it
    // must not re-apply that page padding by sharing the class.
    return react.createElement('div', { className: 'dfu-manage' }, children)
  }

  // --- settings nav mark ----------------------------------------------------

  // Give the plugin's settings tab its own glyph: the composer's diagonal
  // paperclip (identical path, transform and viewBox, so the two marks are the
  // same drawing at two render scales). The shell renders every unknown
  // section id with the fallback gear, so the row is upgraded in place once it
  // exists in the DOM: the fallback svg is hidden (never detached — React owns
  // that node, and removing a node behind React's back makes its unmount pass
  // throw) and the paperclip is inserted ahead of it. A settings tab then
  // reads as this plugin at a glance instead of as a second "General". The
  // glyph is monochrome at rest and only takes the accent while the section is
  // open — a pure CSS state, driven by the cell's aria-current.
  function installSettingsNavMark() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return null
    const NS = 'http://www.w3.org/2000/svg'
    // The shell icons this instance hid, so a teardown can hand them back.
    const hidden = new Set<HTMLElement>()
    const build = () => {
      const svg = document.createElementNS(NS, 'svg')
      // The composer's own numbers, so the mark is literally the same drawing:
      // the enlarged viewBox holds the rotated ink (19.304 units across) and the
      // rendered box is the composer button's 17.24px. The nav column is 16px,
      // and .dfu-nav-mark's negative margin takes back the 0.62px of overhang
      // per side — the ink stays on the column and the label offset is intact.
      svg.setAttribute('viewBox', PAPERCLIP_VIEW_BOX)
      svg.setAttribute('width', String(PAPERCLIP_SIZE))
      svg.setAttribute('height', String(PAPERCLIP_SIZE))
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('data-dfu-mark', 'settings-nav')
      svg.setAttribute('data-dfu-rev', NAV_MARK_REV)
      svg.setAttribute('class', 'dfu-nav-mark')
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', PAPERCLIP_PATH)
      path.setAttribute('fill', 'currentColor')
      path.setAttribute('transform', PAPERCLIP_TRANSFORM)
      svg.appendChild(path)
      return svg
    }
    const patch = () => {
      const label = tFn('settingsTitle')
      const cells = document.querySelectorAll<HTMLElement>('nav button')
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i]
        const text = cell.textContent
        if (typeof text !== 'string' || text.trim() !== label) continue
        // Ours, but drawn by an older bundle: drop it so it is redrawn below.
        let mark = cell.querySelector('[data-dfu-mark]')
        if (mark !== null && mark.getAttribute('data-dfu-rev') !== NAV_MARK_REV) {
          mark.remove()
          mark = null
        }
        // Walk direct children only: the shell's icon is a sibling of the label,
        // so this never reaches into an svg the label itself might carry.
        let fallback: HTMLElement | null = null
        for (let j = 0; j < cell.children.length; j += 1) {
          const child = cell.children[j]
          if (child.tagName === 'svg' && child.getAttribute('data-dfu-mark') === null) {
            fallback = child as HTMLElement
            break
          }
        }
        // No shell icon (unexpected shape) or nothing left to upgrade.
        if (fallback === null) continue
        // Re-hide on every pass, not only the first: a shell re-render can put a
        // fresh, visible copy of the gear back beside ours.
        fallback.style.display = 'none'
        hidden.add(fallback)
        if (mark === null) cell.insertBefore(build(), fallback)
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
    // Unload path: stop watching, take our glyph out, and unhide the shell's own
    // icon. Without this a disabled plugin would leave its paperclip in the row
    // with the gear underneath still suppressed.
    return () => {
      observer.disconnect()
      const marks = document.querySelectorAll('[data-dfu-mark="settings-nav"]')
      for (let i = 0; i < marks.length; i += 1) marks[i].remove()
      hidden.forEach((icon) => {
        icon.style.display = ''
      })
      hidden.clear()
    }
  }

  // --- composer placement ---------------------------------------------------

  // The shell draws the composer tools as one flex row and renders this
  // plugin's slot last:
  //
  //   [+ add menu] [file input] [permission/plan chips] [slot: left]
  //
  // so the button is re-ordered to sit directly right of the add button, in
  // front of the mode chips. It is flex `order` on the row's items — no node
  // React owns is moved:
  //
  //   - our button orders itself right after the first tool control (the add
  //     button); the shell's slot wrapper is `display: contents`, so the label
  //     is itself a flex item of the row;
  //   - everything the shell draws after that control follows ours with a
  //     higher `order`, keeping its own sequence;
  //   - when the standalone button is switched off while the add-menu entry is
  //     replaced, the label is detached: out of the flex flow, still mounted so
  //     the menu action can click its file input.
  //
  // Every write records the value it replaced in a marker attribute, so a
  // switch-off or a plugin unload can put the shell back exactly as it was
  // drawn.
  const SLOT_ANCHOR = '[data-slot="conversation.input.left"]'
  const ORDER_ATTR = 'data-dfu-order'
  const DETACHED_ATTR = 'data-dfu-detached'
  const OUR_ORDER = '1'
  const AFTER_ORDER = '2'

  let replaceOfficial = false
  let alwaysShowButton = true

  /** Set (null clears) our flex order, remembering the inline value replaced. */
  function applyOrder(el: HTMLElement, order: string | null) {
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

  /** Detach or re-attach the standalone button; the CSS keys off the marker. */
  function applyDetached(el: HTMLElement, detached: boolean) {
    if (detached) {
      if (!el.hasAttribute(DETACHED_ATTR)) el.setAttribute(DETACHED_ATTR, '')
      return
    }
    if (el.hasAttribute(DETACHED_ATTR)) el.removeAttribute(DETACHED_ATTR)
  }

  /**
   * Place this plugin's button in one composer row, directly after the add
   * button.
   * @param anchor - this plugin's slot outlet inside the row.
   * @returns the row the button was placed in, or null when it has none.
   */
  function layoutComposer(anchor: HTMLElement): HTMLElement | null {
    const row = anchor.parentElement
    if (row === null) return null
    const behind = row.firstElementChild
    if (behind === null) return null
    const label = anchor.querySelector('.dfu-attach') as HTMLElement | null
    const item = label === null ? anchor : label
    applyOrder(anchor, OUR_ORDER)
    applyOrder(item, OUR_ORDER)
    // The detached button leaves the flow, so its order stops mattering: the
    // add-menu entry is the upload entry while `alwaysShowButton` is off and the
    // official entry is replaced.
    applyDetached(item, label !== null && !alwaysShowButton && replaceOfficial)
    // Everything the shell draws after the add button follows ours; the controls
    // before it keep the default order, so the row's sequence is preserved.
    let passed = false
    const children = row.children
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i] as HTMLElement
      if (!passed) {
        if (child === behind) passed = true
        continue
      }
      if (child !== anchor) applyOrder(child, AFTER_ORDER)
    }
    return row
  }

  // The row already laid out, so the steady state costs a few property reads
  // instead of a document-wide scan per mutation — the shell mutates the DOM
  // continuously while a reply streams. Any node of it being replaced drops the
  // cache and forces a rescan.
  let laidOut: { row: HTMLElement; anchor: HTMLElement } | null = null

  function applyComposerLayout() {
    if (typeof document === 'undefined') return
    if (laidOut !== null && laidOut.row.isConnected && laidOut.anchor.isConnected) {
      layoutComposer(laidOut.anchor)
      return
    }
    laidOut = null
    const anchors = document.querySelectorAll<HTMLElement>(SLOT_ANCHOR)
    for (let i = 0; i < anchors.length; i += 1) {
      const row = layoutComposer(anchors[i])
      if (row !== null) laidOut = { row, anchor: anchors[i] }
    }
  }

  /** Give the shell its composer back: clear every marker we wrote. */
  function restoreComposerLayout() {
    if (typeof document === 'undefined') return
    laidOut = null
    const marked = document.querySelectorAll<HTMLElement>('[' + ORDER_ATTR + '], [' + DETACHED_ATTR + ']')
    for (let i = 0; i < marked.length; i += 1) {
      applyOrder(marked[i], null)
      applyDetached(marked[i], false)
    }
  }

  // --- add-menu entry replacement -------------------------------------------

  /**
   * Swap the shell's `file` candidate for this plugin's row. Both the add (+)
   * button and the slash menu render the same command source, so the swap
   * covers both entries; the plugin row keeps the official row's section (the
   * "Add" heading) and therefore its place in the list.
   * @param rows - candidates the shell's command source produced.
   * @returns the rows with the plugin row standing where `file` was.
   */
  function replaceFileCandidate(rows: readonly CommandMenuCandidate[]): readonly CommandMenuCandidate[] {
    if (!replaceOfficial) return rows
    let ours: CommandMenuCandidate | undefined
    for (const row of rows) {
      if (row.name === ATTACH_FILE_COMMAND) ours = row
    }
    if (ours === undefined) return rows
    let swapped = false
    const out: CommandMenuCandidate[] = []
    for (const row of rows) {
      if (row.name === 'file') {
        swapped = true
        out.push({ ...ours, ...(row.section === undefined ? {} : { section: row.section }) })
        continue
      }
      if (row.name === ATTACH_FILE_COMMAND) continue
      out.push(row)
    }
    // No official row means the shell offers no file entry right now (a locked
    // or attachment-less session), so leaving ours behind would be wrong.
    return swapped ? out : rows.filter(row => row.name !== ATTACH_FILE_COMMAND)
  }

  /**
   * Patch the shell's command source so the official `file` row becomes this
   * plugin's `attach-file` row. The row action opens the very picker the
   * composer button opens, so both entries share one upload path.
   */
  function installCommandEntry(ctx: PluginContext) {
    if (typeof ctx.inject !== 'function') return
    ctx.inject(['commandUi'], (scope) => {
      const commandUi = scope.get<CommandUiService>('commandUi')
      if (commandUi === undefined || typeof commandUi.register !== 'function') return
      const original = commandUi.candidates
      if (typeof original !== 'function') return
      const patched = (session: unknown, req: unknown) =>
        original.call(commandUi, session, req).then(replaceFileCandidate)
      commandUi.candidates = patched
      scope.effect(() => {
        const dispose = commandUi.register({
          name: ATTACH_FILE_COMMAND,
          label: () => tFn('menuFileLabel'),
          icon: AttachMenuIcon,
          available: () => replaceOfficial,
          ui: { kind: 'action', run: session => openPluginPicker(session) },
        })
        return () => {
          dispose()
          if (commandUi.candidates === patched) commandUi.candidates = original
        }
      }, 'dfu: add-menu file entry')
    })
  }

  /** Apply the settings that decide where the upload entry lives. */
  function applyUploadEntrySettings(nextReplace: boolean, nextAlwaysShow: boolean) {
    replaceOfficial = nextReplace === true
    alwaysShowButton = nextAlwaysShow !== false
    applyComposerLayout()
  }

  function installComposerLayout() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    // An instance disabled while it had rewritten the row leaves its markers
    // behind; undo them before deciding anything.
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

  function apply(ctx: PluginContext) {
    const slots = ctx.get<import('../types.js').SlotsService>('slots')
    if (slots === undefined) return
    const locale = ctx.get<import('../types.js').LocaleService>('locale')
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
    const teardownNavMark = installSettingsNavMark()
    installComposerLayout()
    installCommandEntry(ctx)
    if (typeof ctx.effect === 'function') {
      // Disabling or unloading the plugin hands the shell its composer back.
      ctx.effect(() => restoreComposerLayout, 'dfu: composer attach placement')
      // ...and the settings row its own gear.
      if (typeof teardownNavMark === 'function') {
        ctx.effect(() => teardownNavMark, 'dfu: settings nav mark')
      }
    }
    if (typeof configGet === 'function') {
      configGet()
        .then((cfg) => {
          if (cfg) applyUploadEntrySettings(cfg.replaceOfficial === true, cfg.alwaysShowButton !== false)
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
        (props) => react.createElement(AttachButton, props as Record<string, unknown> | undefined),
      ),
    )
    slots.inject('conversation.input.dock', () =>
      slots.register(
        { name: 'conversation.input.dock', id: 'dfu-uploads', order: 5 },
        (props) => react.createElement(UploadChips, props as Record<string, unknown> | undefined),
      ),
    )
  }

  return { apply }
}

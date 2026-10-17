// Hand-maintained subset of the DeepSeek Harness plugin API this plugin uses.
//
// dsh ships no type declarations for these services, and its interfaces carry
// breaking changes between versions (this plugin tracks only the latest dsh),
// so this file declares the minimum surface the seams and the cores touch —
// no more. Update it when a dsh update moves one of these shapes.

import type { IncomingMessage, ServerResponse } from 'node:http'

/** A cordis-style plugin context: service lookup, disposal effects, events. */
export interface PluginContext {
  get<T>(name: string): T | undefined
  effect(fn: () => unknown, key?: string): void
  on(event: string, handler: (payload: unknown, next: () => unknown) => unknown): void
  /**
   * Run a callback once the named services are available, disposing it — and
   * whatever it returned — when they go away. Optional: a stub context used by
   * the browser-free suites may omit it.
   */
  inject?(deps: readonly string[], callback: (scope: PluginContext) => unknown): unknown
}

/** One row the shell's slash/add command menu renders for a candidate. */
export interface CommandMenuCandidate {
  name: string
  label?: string
  description?: string
  icon?: unknown
  /** Section heading the row falls under; absent for a typed (ranked) query. */
  section?: string
}

/** One client command contribution registered with the shell's command UI. */
export interface CommandContribution {
  /** Command name without the leading slash (the row's display alias). */
  name: string
  label?(): string
  description?(): string
  icon?: unknown
  available(session: unknown): boolean
  ui: { kind: 'action'; run(session: unknown): void }
}

/** The client command registry (`ctx.commandUi`) surface this plugin uses. */
export interface CommandUiService {
  register(contribution: CommandContribution): () => void
  /** Candidate synthesis of the '/' source; patched to re-place the file row. */
  candidates?(session: unknown, req: unknown): Promise<readonly CommandMenuCandidate[]>
}

/** The webServer service: register HTTP routes on the dsh web app. */
export interface WebServerRoute {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

export interface WebServer {
  register(route: WebServerRoute): unknown
}

/** The llm service: model capability lookup behind the image-block decision. */
export interface ModelInfo {
  inputModalities?: readonly string[]
}

export interface LlmService {
  resolveModelInfo(
    provider: string | undefined,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<ModelInfo | null>
}

/** The attachments service: image limits and native image attachment refs. */
export interface AttachmentLimits {
  mediaTypes: string[]
  maxImageBytes: number
}

export interface AttachmentsService {
  imageLimits?: AttachmentLimits
  saveImage(input: { data: Uint8Array; mediaType: string; name: string }): Promise<unknown>
}

/** The `agent/pre-step` event: the last chance to enrich the outgoing turn. */
export interface PreStepAgent {
  id: string
  options?: { provider?: string; model?: string }
}
/** One content block of a pre-step message; the shape we inject into. */
export interface PreStepContentBlock {
  type?: string
  text?: string
  attachment?: unknown
  [key: string]: unknown
}

export interface PreStepMessage {
  source?: { kind?: string }
  content?: PreStepContentBlock[]
}

export interface PreStepPayload {
  agent?: PreStepAgent
  messages?: PreStepMessage[]
  signal?: AbortSignal
}

export interface PreStepDecision {
  kind?: string
  messages?: PreStepMessage[]
}

/** The slots service: mount components into the shell's named extension
 *  points (composer, settings section, …). */
export interface SlotMeta {
  name: string
  id: string
  order?: number
  label?: () => string
  inject?: () => Record<string, unknown>
}

export interface SlotsService {
  inject(name: string, factory: () => void): void
  register(meta: SlotMeta, factory: (props: unknown) => unknown): unknown
}

/** The locale service: per-namespace dictionaries and key lookup. */
export interface LocaleService {
  register(namespace: string, lang: string, dict: Record<string, string>): void
  bind(namespace: string): (key: string) => string
  subscribe?(fn: () => void): (() => void) | undefined
}

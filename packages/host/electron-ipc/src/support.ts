/** Local Gateway operation coordinating fixed-field diagnostics, scanner admission and native saving. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-link-controller'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { ApprovedSupportDocument, SupportExportError } from './support-export.ts'
import type { DesktopSupportCounts, DesktopSupportPolicy, DesktopSupportResult } from './types.ts'
import type { DesktopSupportHost } from './native.ts'

/** Desktop support-export resource limits, resolved before the plugin registers its service. */
export const Config = z.object({
  /** Maximum complete UTF-8 document size, including scanner identity and formatting. */
  maximumBytes: z.number().int().positive().max(16 * 1024 * 1024).default(1024 * 1024),
  /** Maximum retained scanner stdout per invocation; truncated reports refuse delivery. */
  maximumReportBytes: z.number().int().positive().max(16 * 1024 * 1024).default(1024 * 1024),
  /** Deadline in milliseconds for each version, canary or document scan, including cleanup. */
  scanMilliseconds: z.number().int().positive().max(MAX_TIMER_DELAY_MS).default(10_000),
  /** Managed scanner process termination grace period in milliseconds. */
  shutdownMilliseconds: z.number().int().positive().max(MAX_TIMER_DELAY_MS).default(2_000),
}).prefault({})

/** Validated configuration consumed by one desktop export service. */
export type Config = z.infer<typeof Config>

const productSchema = z.object({
  version: z.string().min(1).max(128),
  dshProduct: z.strictObject({
    buildNumber: z.number().int().min(1).max(65_535),
    channel: z.enum(['dev', 'canary', 'beta', 'stable']),
  }),
})
const NUMBER = '(0|[1-9][0-9]*)'
const PRERELEASE = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${PRERELEASE}(?:\\.${PRERELEASE})*))?$`)
const COUNTER_EVENT: Readonly<Record<string, keyof DesktopSupportCounts | undefined>> = {
  'turn/start': 'turnsStarted',
  'turn/end': 'turnsEnded',
  'tool/call': 'toolCalls',
  'tool/result': 'toolResults',
}

function productIdentity(value: unknown): { readonly version: string; readonly buildNumber: number; readonly channel: string } {
  const parsed = productSchema.safeParse(value)
  if (!parsed.success) throw new SupportExportError('invalid-identity')
  const { version, dshProduct: { buildNumber, channel } } = parsed.data
  const match = VERSION.exec(version)
  if (match === null || match[0] !== version || [match[1], match[2], match[3]].some(part => Number(part) > 65_535)
    || (channel === 'stable' && match[4] !== undefined)
    || (channel === 'canary' && match[4] === undefined)
    || (channel === 'beta' && !/^(beta|rc)(\.|$)/.test(match[4] ?? ''))) {
    throw new SupportExportError('invalid-identity')
  }
  return { version, buildNumber, channel }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop-local support export; the native application registers its save callback. */
    desktopSupport: DesktopSupport
  }
}

/** One local export at a time; unloading revokes native callbacks, aborts and joins the active operation. */
export class DesktopSupport extends TypertRemoteService {
  static inject = ['subprocess']
  private host: DesktopSupportHost | undefined
  private active: { controller: AbortController; result: Promise<DesktopSupportResult> } | undefined
  private readonly counts = { turnsStarted: 0, turnsEnded: 0, toolCalls: 0, toolResults: 0 }

  /**
   * Register the desktop-local Remote namespace and process-local diagnostic counters.
   * @param ctx - context owning subprocess trees and optional Link diagnostics.
   * @param policy - fully resolved export limits.
   */
  constructor(ctx: Context, private readonly policy: DesktopSupportPolicy) {
    super(ctx, 'desktopSupport')
    const observed = new WeakMap<Session, number>()
    ctx.on('session/event', (session, event) => {
      if (event.seq <= (observed.get(session) ?? -1)) return
      observed.set(session, event.seq)
      const key = COUNTER_EVENT[event.type]
      if (key === undefined) return
      this.counts[key] = Math.min(this.counts[key] + 1, 0xffff_ffff)
    })
  }

  /**
   * Read process-local counters without exposing retained Session objects or sequence cursors.
   * @returns a value copy of the diagnostic counters since this plugin started.
   */
  diagnosticCounts(): DesktopSupportCounts { return { ...this.counts } }

  /**
   * Register the application's sole native exporter with the service's lifecycle.
   * @param host - native callbacks; a second live registration is rejected.
   * @returns disposer that revokes new requests, aborts and joins any active export.
   */
  registerHost(host: DesktopSupportHost): () => Promise<void> {
    const dispose = this.ctx.effect(() => {
      if (this.host !== undefined) throw new Error('desktop support already has a native host')
      this.host = host
      return async () => {
        this.host = undefined
        const active = this.active
        active?.controller.abort()
        await active?.result
      }
    }, 'desktop support native host')
    return async () => { await dispose() }
  }

  /**
   * Export the application's current safe projection to a user-selected local file.
   * @returns saved-byte identity, cancellation, busy state, or a fixed refusal without paths or raw errors.
   */
  @Remote('export')
  exportSupport(): Promise<DesktopSupportResult> {
    const host = this.host
    if (host === undefined) return Promise.resolve({ status: 'failed', reason: 'unavailable' })
    if (this.active !== undefined) return Promise.resolve({ status: 'busy' })
    const controller = new AbortController()
    // Start in a microtask so native callbacks cannot re-enter before the operation owns admission.
    const result = Promise.resolve().then(() => this.exportToHost(host, controller.signal)).finally(() => {
      this.active = undefined
    })
    this.active = { controller, result }
    return result
  }

  private async exportToHost(host: DesktopSupportHost, signal: AbortSignal): Promise<DesktopSupportResult> {
    try {
      signal.throwIfAborted()
      const product = productIdentity(await host.readProductManifest())
      const link = this.ctx.get('linkController')
      let linkObservation: Readonly<Record<string, unknown>> = { producer: 'link-access', freshness: 'unavailable' }
      if (link !== undefined) {
        try {
          const { listenerState, protocol } = await link.diagnostics()
          linkObservation = {
            producer: 'link-access', freshness: 'current',
            value: {
              listenerState,
              linkProtocolVersion: protocol.linkProtocolVersion,
              contractVersion: protocol.contractVersion,
              sessionFormatVersion: protocol.sessionFormatVersion,
              runtimeClass: protocol.runtimeClass,
              allowRemoteApproval: protocol.allowRemoteApproval,
              capabilities: {
                session: {
                  list: protocol.capabilities.session.list, history: protocol.capabilities.session.history,
                  follow: protocol.capabilities.session.follow, prompt: protocol.capabilities.session.prompt,
                  cancel: protocol.capabilities.session.cancel,
                },
                workspace: { follow: protocol.capabilities.workspace.follow },
                interaction: {
                  approval: protocol.capabilities.interaction.approval, question: protocol.capabilities.interaction.question,
                },
              },
            },
          }
        } catch {
          // The Link owner could not collect its snapshot; no exception text enters the document.
          linkObservation = { producer: 'link-access', freshness: 'failed' }
        }
      }
      const snapshot = {
        schemaVersion: 1,
        platform: 'windows',
        runtimeClass: 'full',
        complete: false,
        product: { producer: 'application-package', freshness: 'current', value: product },
        diagnostics: {
          producer: 'desktop-support', freshness: 'current', scope: 'since-plugin-start',
          counts: this.diagnosticCounts(), saturated: Object.values(this.counts).some(count => count === 0xffff_ffff),
        },
        link: linkObservation,
        uncollected: ['runtime-health', 'connection', 'effective-role', 'updates', 'native-crashes'],
      }
      const document = await ApprovedSupportDocument.prepare(this.ctx.subprocess, host.scannerDirectory, snapshot, this.policy, signal)
      signal.throwIfAborted()
      const saved = await host.save(document, signal)
      return saved === 'saved'
        ? { status: 'saved', bytes: document.bytes, sha256: document.sha256, complete: false }
        : { status: 'cancelled' }
    } catch (error) {
      if (error instanceof SupportExportError && error.reason === 'cleanup-failed') {
        return { status: 'failed', reason: 'cleanup-failed' }
      }
      if (signal.aborted) return { status: 'cancelled' }
      return { status: 'failed', reason: error instanceof SupportExportError ? error.reason : 'scan-failed' }
    }
  }
}

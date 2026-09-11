/** Desktop support-export results and native application callbacks. */

/** Fixed refusals; native messages, paths and scanner output never cross the Gateway. */
export type DesktopSupportFailure =
  | 'invalid-identity' | 'invalid-scanner' | 'invalid-diagnostics' | 'unavailable' | 'oversized'
  | 'scan-failed' | 'secrets-detected' | 'timed-out' | 'cleanup-failed' | 'save-failed'

/** Result of one user-requested local export; a cancelled operation has no saved file. */
export type DesktopSupportResult =
  | { readonly status: 'saved'; readonly bytes: number; readonly sha256: string; readonly complete: false }
  | { readonly status: 'cancelled' }
  | { readonly status: 'busy' }
  | { readonly status: 'failed'; readonly reason: DesktopSupportFailure }

/** Explicit resource and execution limits resolved by the desktop plugin's Config. */
export interface DesktopSupportPolicy {
  readonly maximumBytes: number
  readonly maximumReportBytes: number
  readonly scanMilliseconds: number
  readonly shutdownMilliseconds: number
}

/** Fixed process-local counters; they contain no Session ids or event payloads. */
export interface DesktopSupportCounts {
  readonly turnsStarted: number
  readonly turnsEnded: number
  readonly toolCalls: number
  readonly toolResults: number
}

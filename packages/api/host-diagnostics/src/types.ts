/** §41 health vocabulary and the §42 cross-platform diagnostics payload. */
import type { HostId } from '@deepseek-ai/dsh-api-host-description/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** One §41 health component's evaluated state; `degraded` is reserved for probe seams that can see partial failure. */
export type ComponentHealth = 'up' | 'degraded' | 'down'

/** One §41 health component: its state plus the non-secret fact naming the probed source. */
export interface HealthComponent {
  readonly state: ComponentHealth
  /** Names the probed service or proof; never carries configuration values. */
  readonly detail: string
}

/** §41 liveness snapshot: the six health components and the derived readiness verdict. */
export interface HealthSnapshot {
  readonly process: HealthComponent
  readonly runtime: HealthComponent
  readonly sessionStore: HealthComponent
  readonly pluginState: HealthComponent
  readonly connection: HealthComponent
  readonly modelProvider: HealthComponent
  /**
   * Whether the Host can accept Agent requests: process, runtime,
   * sessionStore, pluginState, and modelProvider are up. The connection
   * component is deliberately excluded — a profile without a network
   * carrier (CLI, desktop pipe) is still ready.
   */
  readonly ready: boolean
}

/** One §42 migration step this Host build knows, by name and version pair. */
export interface DiagnosticsMigration {
  readonly name: string
  readonly fromVersion: number
  readonly toVersion: number
}

/** One §42 plugin row: inventory facts only, never configuration values. */
export interface DiagnosticsPlugin {
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string
}

/** One detected unclean shutdown: the run holding `pid` started at `runStartedAt` and never reached clean disposal; pid 0 means unknown. */
export interface DiagnosticsCrashFact {
  readonly pid: number
  readonly runStartedAt: number
}

/** One normalized agent error recorded for diagnostics: identity and text only, no payload or stack. */
export interface DiagnosticsErrorFact {
  readonly time: number
  readonly name: string
  readonly message: string
  readonly agentId: string
  readonly turn: number
  readonly step: number
}

/**
 * §42 cross-platform diagnostics payload. Sanitized by construction: the
 * field set is this enumeration of non-secret facts — no API keys, bearers,
 * pairing secrets, or raw credentials exist anywhere in the payload.
 */
export interface DiagnosticsSnapshot {
  readonly productVersion: string
  readonly apiProtocolVersion: number
  readonly sessionFormatVersion: number
  readonly hostId: HostId
  readonly platform: string
  readonly arch: string
  readonly runtimeMode: string
  readonly nodeVersion: string
  readonly transports: readonly string[]
  readonly capabilities: readonly string[]
  readonly plugins: readonly DiagnosticsPlugin[]
  readonly migrations: readonly DiagnosticsMigration[]
  /** Detected unclean shutdowns, oldest first within the durable log's cap. */
  readonly crash: readonly DiagnosticsCrashFact[]
  /** The newest agent errors, oldest first within the process-local cap. */
  readonly lastErrors: readonly DiagnosticsErrorFact[]
  readonly health: HealthSnapshot
}

/** One §43 bundle entry kind; the closed set is the sanitizer's allowlist. */
export type SupportBundleEntryKind = 'diagnostics' | 'session-headers'

/** One sanitized bundle entry: JSON-safe content plus its stable bundle path. */
export interface SupportBundleEntry {
  readonly kind: SupportBundleEntryKind
  readonly path: string
  readonly content: JsonValue
}

/** One manifest row: the entry's bundle path and the SHA-256 of its serialized bytes. */
export interface SupportBundleManifestEntry {
  readonly path: string
  readonly sha256: string
}

/** The §43 support bundle: sanitized entries, their manifest, and the chained checksum. */
export interface SupportBundle {
  readonly manifest: readonly SupportBundleManifestEntry[]
  /** SHA-256 over the ordered manifest rows' `path:sha256` lines. */
  readonly checksum: string
  readonly entries: readonly SupportBundleEntry[]
}

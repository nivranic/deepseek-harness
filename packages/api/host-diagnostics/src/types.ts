/** §41 health vocabulary and the §42 cross-platform diagnostics payload. */
import type { HostId } from '@deepseek-ai/dsh-api-host-description/types'

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
  /** Crash and last-error recording has no seam yet; the arrays stay empty until it lands. */
  readonly crash: readonly string[]
  readonly lastErrors: readonly string[]
  readonly health: HealthSnapshot
}

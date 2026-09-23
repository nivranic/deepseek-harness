/**
 * Host-diagnostics seam: the §41 health/readiness snapshot and the §42
 * cross-platform diagnostics payload over one Typert Remote owner. Health is
 * presence-based in this first cut — every component names the service it
 * probed, so a `down` is a missing owner, not a guessed failure — and the
 * payload is sanitized by construction: it enumerates non-secret facts only,
 * so no API key, bearer, pairing secret, or raw credential can reach it.
 * @module @deepseek-ai/dsh-api-host-diagnostics
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import { sessionFormatV0ToV1 } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { sessionFormatV1ToV2 } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { HOST_DIAGNOSTICS_REMOTE_CAPABILITIES } from './capabilities.ts'
import { DiagnosticsRecorder } from './recorder.ts'
import { buildSupportBundle, diagnosticsBundleEntry, sessionHeadersBundleEntry, settingsExportBundleEntry, validateSupportBundle } from './support-bundle.ts'
import type { SupportBundle } from './types.ts'
import type {
  DiagnosticsMigration,
  DiagnosticsPlugin,
  DiagnosticsSnapshot,
  HealthComponent,
  HealthSnapshot,
} from './types.ts'

export type * from './types.ts'
export { HOST_DIAGNOSTICS_REMOTE_CAPABILITIES } from './capabilities.ts'
export { buildSupportBundle, diagnosticsBundleEntry, sanitizeSupportBundleEntry, sessionHeadersBundleEntry, settingsExportBundleEntry, validateSupportBundle } from './support-bundle.ts'
export type { SessionHeaderRow, SettingsExportRow } from './support-bundle.ts'

/** The released session-format migration chain this build knows, by name and version pair. */
const MIGRATIONS: readonly DiagnosticsMigration[] = Object.freeze([
  { name: sessionFormatV0ToV1.name, fromVersion: sessionFormatV0ToV1.fromVersion, toVersion: sessionFormatV0ToV1.toVersion },
  { name: sessionFormatV1ToV2.name, fromVersion: sessionFormatV1ToV2.fromVersion, toVersion: sessionFormatV1ToV2.toVersion },
  { name: sessionFormatV2ToV3.name, fromVersion: sessionFormatV2ToV3.fromVersion, toVersion: sessionFormatV2ToV3.toVersion },
])

/** Optional plugin-inventory owner shape the diagnostics service probes. */
interface InventoryOwner {
  list(signal?: AbortSignal): Promise<{ readonly entries: readonly {
    readonly moduleName: string
    readonly enabled: boolean
    readonly fiberPhase: string | null
  }[] }>
}

/** Optional LLM owner shape the diagnostics service probes for provider readiness. */
interface ModelProviderOwner {
  listProviders(): readonly unknown[]
}

/** Optional settings-seam owner shape the diagnostics service reads for bundle rows. */
interface SettingsOwner {
  describe(options?: { readonly redactSecrets?: boolean }): readonly {
    readonly ns: string
    readonly revision: number
    readonly applies: 'live' | 'restart'
    readonly value: unknown
    readonly secrets?: readonly string[]
  }[]
}

/** Optional session-store owner shape the diagnostics service reads for bundle rows. */
interface SessionStoreOwner {
  list(signal?: AbortSignal): Promise<readonly {
    readonly header: {
      readonly id: string
      readonly createdAt: number
      readonly cwd?: string
      readonly parentSession?: string
      readonly isSeeded: boolean
    }
    readonly revision: string
    readonly eventCount?: number
    readonly sizeBytes?: number
  }[]>
}

/** One presence probe result for an optionally composed Host service. */
function presence(owner: unknown, serviceName: string): HealthComponent {
  return owner === undefined
    ? { state: 'down', detail: `${serviceName} is not composed` }
    : { state: 'up', detail: `${serviceName} is composed` }
}

/** Host-diagnostics service (`ctx.hostDiagnostics`) composing §41/§42 facts. */
export class HostDiagnosticsService extends TypertRemoteService {
  private readonly recorder: DiagnosticsRecorder

  constructor(ctx: Context) {
    super(ctx, 'hostDiagnostics', { namespace: 'hostDiagnostics', capabilities: HOST_DIAGNOSTICS_REMOTE_CAPABILITIES })
    this.recorder = new DiagnosticsRecorder(ctx)
  }

  /**
   * Evaluate the six §41 health components. Answering IS the process and
   * runtime proof; the remaining components probe their owning services, so a
   * `down` names the missing owner instead of guessing a cause. Composed
   * owners are probed deeper: a loader with failed plugin fibers reports
   * `degraded` without dropping readiness, an LLM owner with no registered
   * provider reports `degraded` and drops readiness (no Agent request can
   * run), and an inventory read that itself throws reports `degraded` naming
   * the error class.
   * @param signal - optional request cancellation for the inventory probe.
   * @returns the health snapshot with the derived readiness verdict.
   */
  @Remote('health')
  async health(signal?: AbortSignal): Promise<HealthSnapshot> {
    const sessionStore = presence(this.ctx.get('sessionPersistence'), 'sessionPersistence')
    const pluginState = await this.pluginHealth(signal)
    const modelProvider = this.modelProviderHealth()
    // A profile without a network carrier (CLI, desktop pipe) is a legitimate
    // deployment, so an absent webserver reports down without affecting
    // readiness.
    const connection = presence(this.ctx.get('webServer'), 'webServer')
    return {
      process: { state: 'up', detail: `pid ${String(process.pid)}` },
      runtime: { state: 'up', detail: `node ${process.version}` },
      sessionStore,
      pluginState,
      connection,
      modelProvider,
      ready: sessionStore.state === 'up'
        && pluginState.state !== 'down'
        && modelProvider.state === 'up',
    }
  }

  /** Loader presence plus a failed-fiber probe: degraded is partial, readiness keeps holding. */
  private async pluginHealth(signal?: AbortSignal): Promise<HealthComponent> {
    const loader = this.ctx.get('loader') as object | undefined
    if (loader === undefined) return presence(undefined, 'loader')
    const inventory = this.ctx.get('pluginInventory') as InventoryOwner | undefined
    if (inventory === undefined) return presence(loader, 'loader')
    try {
      const snapshot = await inventory.list(signal)
      const failed = snapshot.entries.filter(entry => entry.fiberPhase === 'failed').length
      return failed > 0
        ? { state: 'degraded', detail: `${failed} plugin fiber(s) failed` }
        : { state: 'up', detail: 'loader is composed' }
    } catch (error) {
      return { state: 'degraded', detail: `pluginInventory read failed (${error instanceof Error ? error.name : 'Error'})` }
    }
  }

  /** LLM presence plus a provider probe: without a provider no Agent request can run. */
  private modelProviderHealth(): HealthComponent {
    const llm = this.ctx.get('llm') as ModelProviderOwner | undefined
    if (llm === undefined) return presence(undefined, 'llm')
    return llm.listProviders().length === 0
      ? { state: 'degraded', detail: 'no model provider is registered' }
      : { state: 'up', detail: 'llm is composed' }
  }

  /**
   * Compose the §42 diagnostics payload: the Host descriptor facts, the
   * Loader inventory, the released migration chain, the recorder's crash and
   * last-error facts, and the health snapshot.
   * @param signal - optional request cancellation; a cancelled inventory read
   * aborts the composition.
   * @returns the sanitized diagnostics snapshot.
   */
  @Remote('describe')
  async describe(signal?: AbortSignal): Promise<DiagnosticsSnapshot> {
    const description = this.ctx.get('hostDescription') as { describe(): HostDescriptor } | undefined
    if (description === undefined) {
      throw new RemoteError('gateway/service-unavailable', 'host description owner is not composed', {
        endpoint: 'hostDiagnostics/describe',
      })
    }
    const descriptor = description.describe()
    const plugins = await this.plugins(signal)
    return {
      productVersion: descriptor.productVersion,
      apiProtocolVersion: descriptor.apiProtocolVersion,
      sessionFormatVersion: descriptor.sessionFormatVersion,
      hostId: descriptor.hostId,
      platform: descriptor.platform,
      arch: descriptor.arch,
      runtimeMode: descriptor.runtimeMode,
      nodeVersion: process.version,
      transports: descriptor.transports,
      capabilities: descriptor.capabilities,
      plugins,
      migrations: MIGRATIONS,
      crash: this.recorder.crash,
      lastErrors: this.recorder.lastErrors,
      health: await this.health(signal),
    }
  }

  /**
   * Produce one §43 support bundle: the just-composed §42 diagnostics entry,
   * the session-headers entry when a session store is composed and holds at
   * least one session, and the settings-export entry when the settings seam
   * is composed and registers at least one namespace; the collector validates
   * the same artifact.
   * @param signal - optional request cancellation passed to the composition.
   * @returns the sealed, self-checksummed bundle.
   */
  @Remote('supportBundle')
  async supportBundle(signal?: AbortSignal): Promise<SupportBundle> {
    const snapshot = await this.describe(signal)
    const store = this.ctx.get('sessionPersistence') as SessionStoreOwner | undefined
    const snapshots = store === undefined ? [] : await store.list(signal)
    const settings = this.ctx.get('settings') as SettingsOwner | undefined
    const descriptors = settings === undefined ? [] : settings.describe({ redactSecrets: true })
    const candidates = [diagnosticsBundleEntry(snapshot)]
    if (descriptors.length > 0) {
      candidates.push(settingsExportBundleEntry(descriptors.map(descriptor => ({
        ns: descriptor.ns,
        revision: descriptor.revision,
        applies: descriptor.applies,
        value: descriptor.value,
        redacted: descriptor.secrets ?? [],
      }))))
    }
    if (snapshots.length > 0) {
      candidates.push(sessionHeadersBundleEntry(snapshots.map(listed => ({
        id: listed.header.id,
        createdAt: listed.header.createdAt,
        isSeeded: listed.header.isSeeded,
        revision: listed.revision,
        ...(listed.header.cwd !== undefined ? { cwd: listed.header.cwd } : {}),
        ...(listed.header.parentSession !== undefined ? { parentSession: listed.header.parentSession } : {}),
        ...(listed.eventCount !== undefined ? { eventCount: listed.eventCount } : {}),
        ...(listed.sizeBytes !== undefined ? { sizeBytes: listed.sizeBytes } : {}),
      }))))
    }
    const bundle = buildSupportBundle(candidates)
    validateSupportBundle(bundle)
    return bundle
  }

  /** Inventory rows as §42 plugin facts; without the inventory owner the list is empty, not guessed. */
  private async plugins(signal?: AbortSignal): Promise<readonly DiagnosticsPlugin[]> {
    const inventory = this.ctx.get('pluginInventory') as InventoryOwner | undefined
    if (inventory === undefined) return []
    const snapshot = await inventory.list(signal)
    return snapshot.entries.map(entry => ({
      moduleName: entry.moduleName,
      enabled: entry.enabled,
      // The inventory projects disposed fibers as null; the §42 row names the phase.
      fiberPhase: entry.fiberPhase ?? 'disposed',
    }))
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host diagnostics owner: §41 health and §42 payload. */
    hostDiagnostics: HostDiagnosticsService
  }
}

export default HostDiagnosticsService

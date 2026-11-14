/** Host discovery over the application's existing authenticated Typert Remote. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-gateway'
import { loadHostId } from './identity.ts'
import { readProductVersion } from './version.ts'
import { LEGACY_DISCOVERY_PROTOCOL_VERSION, SUPPORTED_REMOTE_PROTOCOL_VERSIONS } from '@deepseek-ai/dsh-api-gateway/protocol'
import type { HostDescriptor, HostId, HostTransport } from './types.ts'

export type * from './types.ts'
export { API_PROTOCOL_VERSION } from '@deepseek-ai/dsh-api-gateway/protocol'

/** Application-owned identity location, label, and physical carriers. */
export interface Config {
  /** Absolute path to the Harness home's persistent UUID file. */
  identityFile: string
  /** Operator-visible Host label. @default DeepSeek Harness */
  displayName?: string
  /** Physical carriers actually mounted by the application. */
  transports: HostTransport[]
  /** Maximum wait for concurrent identity creation, in milliseconds. @default 2000 */
  identityLockWaitMs?: number
}

/** Validates deployment choices before loading Host identity. */
export const Config: z<Config> = z.object({
  identityFile: z.string().required(),
  displayName: z.string().min(1).default('DeepSeek Harness'),
  transports: z.array(z.union(['http', 'websocket', 'desktop-pipe'] as const)).min(1).required(),
  identityLockWaitMs: z.natural().min(1).default(2000),
})

interface HostFacts {
  readonly hostId: HostId
  readonly displayName: string
  readonly productVersion: string
  readonly transports: readonly HostTransport[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host discovery Remote owner. */
    hostDescription: HostDescriptionGateway
  }
}

/** Read-only Remote namespace for Host facts and explicitly declared capabilities. */
export class HostDescriptionGateway extends TypertRemoteService {
  /**
   * @param ctx - Host context containing the shared Gateway.
   * @param facts - validated application facts after persistent identity is ready.
   */
  constructor(ctx: Context, private readonly facts: HostFacts) {
    super(ctx, 'hostDescription', {
      namespace: 'host',
      capabilities: [
        { id: 'host.describe.v1', methods: ['describe'], requiredPermission: 'view' },
        { id: 'host.negotiate.v1', methods: ['negotiate'], requiredPermission: 'view' },
      ],
    })
  }

  /**
   * Read current Host facts without changing Session or Workspace state.
   * Capability presence does not grant permission to invoke its operations.
   * @returns installed versions, stable identity, and current operation availability.
   */
  @Remote('describe')
  describe(): HostDescriptor {
    return {
      ...this.facts,
      apiProtocolVersion: LEGACY_DISCOVERY_PROTOCOL_VERSION,
      supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS],
      sessionFormatVersion: SESSION_FORMAT_VERSION,
      platform: process.platform,
      arch: process.arch,
      runtimeMode: 'full',
      capabilities: this.ctx.typertGateway.capabilities(),
      serverTime: Date.now(),
    }
  }

  /**
   * Select the highest shared request codec without changing identity or granting permissions.
   * @param supportedApiProtocolVersions - nonempty, distinct positive integer Client offers.
   * @returns Host facts expressed in the selected API generation.
   */
  @Remote('negotiate')
  negotiate(supportedApiProtocolVersions: readonly number[]): HostDescriptor {
    if (supportedApiProtocolVersions.length === 0
      || supportedApiProtocolVersions.some(version => !Number.isSafeInteger(version) || version < 1)
      || new Set(supportedApiProtocolVersions).size !== supportedApiProtocolVersions.length) {
      throw new RemoteError('gateway/arguments-invalid', 'Client protocol offers must be distinct positive integers', {
        endpoint: 'host/negotiate', field: 'supportedApiProtocolVersions',
      })
    }
    const selected = SUPPORTED_REMOTE_PROTOCOL_VERSIONS.find(version => supportedApiProtocolVersions.includes(version))
    if (selected === undefined) throw new RemoteError('gateway/protocol-unsupported', 'Host and Client have no shared API protocol; update the application', {
      endpoint: 'host/negotiate', supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS],
    })
    return { ...this.describe(), apiProtocolVersion: selected }
  }
}

/** Cordis plugin name. */
export const name = 'api-host-description'
/** Capabilities come from the active Gateway's Remote bindings. */
export const inject = ['typertGateway']

/**
 * Publish Host discovery only after stable identity and release metadata load.
 * @param ctx - plugin-owned Host context.
 * @param config - configuration with schema defaults applied.
 * @returns completion after the Host Remote namespace is registered.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = config as Required<Config>
  const [hostId, productVersion] = await Promise.all([
    loadHostId(config.identityFile, resolved.identityLockWaitMs),
    readProductVersion(),
  ])
  new HostDescriptionGateway(ctx, {
    hostId, productVersion, displayName: resolved.displayName,
    transports: resolved.transports,
  })
}

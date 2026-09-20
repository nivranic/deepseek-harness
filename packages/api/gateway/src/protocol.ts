/** Versioned Remote request envelopes shared by Host and Client carriers. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
export type {} from './remote-error-codes.ts'
export type {
  RemoteInteractionOrigin,
  RemoteInteractionPolicy,
  RemoteInteractionRecord,
  RemoteInteractionSessionId,
} from './stream-protocol.ts'

/** Current application request protocol, independent of release and Session versions. */
export const API_PROTOCOL_VERSION = 2

/** Discovery representation accepted by frozen protocol-1 Clients. */
export const LEGACY_DISCOVERY_PROTOCOL_VERSION = 1

/** Degraded announcement for Clients two generations behind; Host discovery endpoints only. */
export const DIAGNOSTICS_ONLY_PROTOCOL_VERSION = 0

/** Request codecs implemented by Gateway; discovery determines which a peer accepts. */
export const SUPPORTED_REMOTE_PROTOCOL_VERSIONS = [2, 1] as const

/** Read-only Host discovery endpoints admitted on the diagnostics-only tier; all other endpoints reject. */
export const DIAGNOSTICS_ONLY_ENDPOINTS: ReadonlySet<string> = new Set(['host/describe', 'host/negotiate'])

/** Explicitly selected request codec; an unversioned request uses version 1. */
export type RemoteProtocolVersion = typeof SUPPORTED_REMOTE_PROTOCOL_VERSIONS[number]

/** One decoded carrier request: the wire codec plus whether the degraded tier was announced. */
export interface DecodedRemoteRequest {
  /** Codec for this request; the diagnostics-only tier rides the frozen legacy codec. */
  readonly version: RemoteProtocolVersion
  /** Endpoint argument envelope after supported metadata handling. */
  readonly payload: unknown
  /** True when the announcement named the diagnostics-only version instead of a negotiated codec. */
  readonly diagnosticsOnly: boolean
  /** Signed device admission a versioned envelope carried beside `args`; absent for anonymous requests. */
  readonly device?: unknown
}

/**
 * Encode named arguments with a previously resolved peer protocol.
 * @param args - exact named business arguments or reserved-event arguments.
 * @param version - codec selected before dispatch; version 1 omits all metadata.
 * @param device - optional signed device admission riding the versioned envelope.
 * @returns carrier payload accepted by the selected protocol's Host.
 */
export function encodeRemotePayload(
  args: Readonly<Record<string, unknown>>,
  version: RemoteProtocolVersion,
  device?: unknown,
): object {
  if (version === 1) return { args }
  return { apiProtocolVersion: version, args, ...(device === undefined ? {} : { device }) }
}

/**
 * Remove supported request metadata before endpoint-specific argument validation.
 * @param endpoint - endpoint included in structured protocol failures.
 * @param payload - untrusted carrier payload; absent metadata selects version 1.
 * @returns legacy argument envelope; unrelated fields remain for strict rejection.
 * @throws RemoteError when explicit metadata does not name an implemented codec.
 */
export function decodeRemotePayload(endpoint: string, payload: unknown): unknown {
  return decodeRemoteRequest(endpoint, payload).payload
}

/**
 * Decode arguments, the selected codec, and the degraded tier marker.
 * @param endpoint - endpoint included in protocol failures.
 * @param payload - untrusted carrier payload; absent metadata selects protocol 1.
 * @returns validated protocol selection and the endpoint argument envelope.
 * @throws RemoteError when explicit metadata names neither a negotiated codec
 *   nor the diagnostics-only version.
 */
export function decodeRemoteRequest(endpoint: string, payload: unknown): DecodedRemoteRequest {
  if (typeof payload !== 'object' || payload === null || !Object.hasOwn(payload, 'apiProtocolVersion')) {
    return { version: 1, payload, diagnosticsOnly: false }
  }
  const version: unknown = Reflect.get(payload, 'apiProtocolVersion')
  let codec: RemoteProtocolVersion
  let diagnosticsOnly = false
  if (version === DIAGNOSTICS_ONLY_PROTOCOL_VERSION) {
    codec = LEGACY_DISCOVERY_PROTOCOL_VERSION
    diagnosticsOnly = true
  } else if (version === 1 || version === 2) {
    codec = version
  } else {
    throw new RemoteError('gateway/protocol-unsupported', 'Remote request API protocol is unsupported; update the application', {
      endpoint, supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS],
    })
  }
  const prototype: unknown = Object.getPrototypeOf(payload)
  if (prototype !== Object.prototype && prototype !== null) return { version: codec, payload, diagnosticsOnly }
  const keys = Reflect.ownKeys(payload)
  if (keys.length === 2 && Object.hasOwn(payload, 'args')) {
    return { version: codec, payload: { args: Reflect.get(payload, 'args') as unknown }, diagnosticsOnly }
  }
  if (keys.length === 3 && Object.hasOwn(payload, 'args') && Object.hasOwn(payload, 'device')) {
    return {
      version: codec,
      payload: { args: Reflect.get(payload, 'args') as unknown },
      diagnosticsOnly,
      device: Reflect.get(payload, 'device'),
    }
  }
  return { version: codec, payload, diagnosticsOnly }
}

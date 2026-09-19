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

/** Request codecs implemented by Gateway; discovery determines which a peer accepts. */
export const SUPPORTED_REMOTE_PROTOCOL_VERSIONS = [2, 1] as const

/** Explicitly selected request codec; an unversioned request uses version 1. */
export type RemoteProtocolVersion = typeof SUPPORTED_REMOTE_PROTOCOL_VERSIONS[number]

/**
 * Encode named arguments with a previously resolved peer protocol.
 * @param args - exact named business arguments or reserved-event arguments.
 * @param version - codec selected before dispatch; version 1 omits all metadata.
 * @returns carrier payload accepted by the selected protocol's Host.
 */
export function encodeRemotePayload(args: Readonly<Record<string, unknown>>, version: RemoteProtocolVersion): object {
  return version === 1 ? { args } : { apiProtocolVersion: version, args }
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
 * Decode arguments and retain the selected codec for versioned stream output.
 * @param endpoint - endpoint included in protocol failures.
 * @param payload - untrusted carrier payload; absent metadata selects protocol 1.
 * @returns validated protocol selection and the endpoint argument envelope.
 */
export function decodeRemoteRequest(
  endpoint: string,
  payload: unknown,
): { readonly version: RemoteProtocolVersion; readonly payload: unknown } {
  if (typeof payload !== 'object' || payload === null || !Object.hasOwn(payload, 'apiProtocolVersion')) {
    return { version: 1, payload }
  }
  const version: unknown = Reflect.get(payload, 'apiProtocolVersion')
  if (version !== 1 && version !== 2) {
    throw new RemoteError('gateway/protocol-unsupported', 'Remote request API protocol is unsupported; update the application', {
      endpoint, supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS],
    })
  }
  const prototype: unknown = Object.getPrototypeOf(payload)
  if (prototype !== Object.prototype && prototype !== null) return { version, payload }
  if (Reflect.ownKeys(payload).length !== 2 || !Object.hasOwn(payload, 'args')) return { version, payload }
  return { version, payload: { args: Reflect.get(payload, 'args') as unknown } }
}

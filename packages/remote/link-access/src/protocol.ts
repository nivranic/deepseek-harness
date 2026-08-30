/**
 * Wire vocabulary of the link-access carrier: route and header names, the
 * remote endpoint allowlist contract, the canonical request-signature input,
 * and the pairing and host-description payloads crossing the carrier
 * boundary. Pure values and functions only; the carrier owns the sockets.
 * @module @deepseek-ai/dsh-link-access/protocol
 */

import { hostname, type NetworkInterfaceInfo } from 'node:os'
import type { DeviceRole } from '@deepseek-ai/dsh-device-trust'

/** Version of the link pairing and authentication protocol this carrier speaks. */
export const LINK_PROTOCOL_VERSION = 1

/** Carrier route accepting one pairing request (the only unauthenticated POST). */
export const LINK_PAIR_PATH = '/link/pair'

/** Carrier route answering the authenticated host description. */
export const LINK_DESCRIBE_PATH = '/link/describe'

/** Carrier route prefix carrying one Gateway Remote stream as NDJSON. */
export const LINK_STREAM_PREFIX = '/link/stream/'

/** Gateway-internal unary endpoint answering one pending remote interaction. */
export const REMOTE_INTERACTION_ANSWER_ENDPOINT = '$events/result'

/** Carrier route prefix forwarding unary RPC onto the shared `/api` channel. */
export const LINK_API_PREFIX = '/api/'

/** Header carrying the paired device identity. */
export const LINK_DEVICE_ID_HEADER = 'x-dsh-device-id'

/** Header carrying the request timestamp in epoch milliseconds. */
export const LINK_TIMESTAMP_HEADER = 'x-dsh-timestamp'

/** Header carrying the base64 Ed25519 signature over {@link linkSigningInput}. */
export const LINK_SIGNATURE_HEADER = 'x-dsh-signature'

/** Carrier cap for the small protocol bodies (pairing and stream payloads). */
export const LINK_PROTOCOL_BODY_LIMIT_BYTES = 64 * 1024

/** Default carrier cap for unary RPC bodies; matches the browser carrier so attachments route identically. */
export const LINK_DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

/** How a remote endpoint is invoked through the carrier. */
export type LinkEndpointKind = 'unary' | 'stream'

/** Roles a deployment may pin as an endpoint's minimum. */
export type LinkMinimumRole = 'observer' | 'controller'

/** One row of the remote endpoint allowlist. */
export interface LinkEndpointAccess {
  /** Canonical `<namespace>/<method>` endpoint, or `$events` / `$events/result`. */
  readonly endpoint: string
  readonly kind: LinkEndpointKind
  readonly minRole: DeviceRole
  /** The endpoint answers a pending remote interaction and needs the independent remote-approval switch. */
  readonly approval?: true
}

/** Configuration-facing allowlist row before resolution to {@link LinkEndpointAccess}. */
export interface LinkEndpointInput {
  /** Canonical `<namespace>/<method>` endpoint, or `$events` / `$events/result`. */
  readonly endpoint: string
  /** How the endpoint is invoked through the carrier. */
  readonly kind: LinkEndpointKind
  /** Minimum device role allowed to invoke the endpoint. */
  readonly minRole: LinkMinimumRole
}

/**
 * The default remote surface: read-only session and workspace observation for
 * every device, session control for controllers, and remote interaction
 * answers for controllers behind the approval switch. Endpoints absent here
 * (host administration, credential surfaces, session creation) are not
 * remote until a deployment lists them.
 */
export const DEFAULT_LINK_ENDPOINTS: LinkEndpointInput[] = [
  { endpoint: 'session/list', kind: 'unary', minRole: 'observer' },
  { endpoint: 'session/search', kind: 'unary', minRole: 'observer' },
  { endpoint: 'session/page', kind: 'unary', minRole: 'observer' },
  { endpoint: 'session/modelCatalog', kind: 'unary', minRole: 'observer' },
  { endpoint: 'session/attachment', kind: 'unary', minRole: 'observer' },
  { endpoint: 'fileReferences/list', kind: 'unary', minRole: 'observer' },
  { endpoint: 'session/follow', kind: 'stream', minRole: 'observer' },
  { endpoint: 'session/control', kind: 'stream', minRole: 'observer' },
  { endpoint: 'workspace/follow', kind: 'stream', minRole: 'observer' },
  { endpoint: '$events', kind: 'stream', minRole: 'observer' },
  { endpoint: 'session/prompt', kind: 'unary', minRole: 'controller' },
  { endpoint: 'session/cancel', kind: 'unary', minRole: 'controller' },
  { endpoint: 'session/updateQueue', kind: 'unary', minRole: 'controller' },
  { endpoint: 'session/rename', kind: 'unary', minRole: 'controller' },
  { endpoint: 'session/fork', kind: 'unary', minRole: 'controller' },
  { endpoint: 'session/selectModel', kind: 'unary', minRole: 'controller' },
  { endpoint: REMOTE_INTERACTION_ANSWER_ENDPOINT, kind: 'unary', minRole: 'controller' },
]

/** Authorization weight of each device role. */
const ROLE_RANK: Readonly<Record<DeviceRole, number>> = {
  observer: 0,
  controller: 1,
  administrator: 2,
}

/** Why a remote call was refused after authentication. */
export type LinkAuthorizationFailure = 'not-remote' | 'role' | 'approval-disabled'

/**
 * Decide whether one device role may invoke one endpoint through the carrier.
 * @param table - the resolved endpoint allowlist.
 * @param endpoint - canonical endpoint the device asked for.
 * @param kind - invocation kind the device used.
 * @param role - the authenticated device's role.
 * @param allowRemoteApproval - whether the independent remote-approval switch is on.
 * @returns the refusal reason, or `undefined` when the call is authorized.
 */
export function authorizeLinkEndpoint(
  table: ReadonlyMap<string, LinkEndpointAccess>,
  endpoint: string,
  kind: LinkEndpointKind,
  role: DeviceRole,
  allowRemoteApproval: boolean,
): LinkAuthorizationFailure | undefined {
  const access = table.get(endpoint)
  if (access === undefined || access.kind !== kind) return 'not-remote'
  if (ROLE_RANK[role] < ROLE_RANK[access.minRole]) return 'role'
  if (access.approval === true && !allowRemoteApproval) return 'approval-disabled'
  return undefined
}

/**
 * Canonical byte string covered by the device request signature. The body
 * digest binds the request body without re-sending it.
 * @param timestamp - the exact `x-dsh-timestamp` header value.
 * @param method - uppercase HTTP method.
 * @param path - request pathname, starting at `/`.
 * @param bodySha256Hex - lowercase hex SHA-256 of the request body (empty body digested as empty).
 * @returns the newline-joined canonical input.
 */
export function linkSigningInput(
  timestamp: string,
  method: string,
  path: string,
  bodySha256Hex: string,
): string {
  return `${timestamp}\n${method}\n${path}\n${bodySha256Hex}`
}

/** One pairing request posted to {@link LINK_PAIR_PATH}. */
export interface LinkPairRequest {
  /** One-time pairing code from the host's displayed payload. */
  readonly code: string
  readonly deviceName: string
  /** Base64 DER SubjectPublicKeyInfo of the device's Ed25519 signing key. */
  readonly devicePublicKey: string
}

/** Successful pairing response. */
export interface LinkPairValue {
  readonly deviceId: string
  readonly hostId: string
  readonly hostName: string
  readonly role: DeviceRole
  readonly linkProtocolVersion: number
}

/** Authenticated host description served at {@link LINK_DESCRIBE_PATH}. */
export interface LinkHostDescription {
  readonly linkProtocolVersion: number
  readonly hostVersion: string
  readonly hostId: string
  readonly hostName: string
  readonly runtimeClass: 'full'
  readonly sessionFormatVersion: number
  readonly allowRemoteApproval: boolean
  readonly capabilities: {
    readonly session: { readonly list: true; readonly history: true; readonly follow: true; readonly prompt: true; readonly cancel: true }
    readonly workspace: { readonly follow: true }
    readonly interaction: { readonly approval: boolean; readonly question: boolean }
  }
}

/** Payload rendered into the host's pairing QR code. */
export interface LinkPairingPayload {
  readonly v: 1
  readonly kind: 'dsh-link-pairing'
  readonly hostId: string
  readonly hostName: string
  /** Absolute `https://` endpoint the device connects to. */
  readonly endpoint: string
  /** Lowercase hex SHA-256 of the host certificate's SubjectPublicKeyInfo DER. */
  readonly spkiFingerprint: string
  readonly code: string
  readonly expiresAt: number
}

/**
 * Derive the authority the pairing endpoint advertises: the bind host when
 * specific, or the first non-internal IPv4 address for an all-interface bind.
 * @param host - configured bind host.
 * @param port - bound port.
 * @param links - flattened `os.networkInterfaces()` entries.
 * @returns the `https://` authority carried in the pairing payload.
 */
export function pairingEndpoint(host: string, port: number, links: readonly NetworkInterfaceInfo[]): string {
  if (host !== '0.0.0.0' && host !== '::') return `https://${host}:${String(port)}`
  for (const link of links) {
    if (link.family === 'IPv4' && !link.internal) return `https://${link.address}:${String(port)}`
  }
  return `https://${hostname()}:${String(port)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Parse and validate one untrusted pairing request body.
 * @param value - decoded JSON body.
 * @returns the validated pairing fields.
 * @throws when the body is not exactly the pairing request shape.
 */
export function parseLinkPairRequest(value: unknown): LinkPairRequest {
  if (!isRecord(value) || !exactKeys(value, ['code', 'deviceName', 'devicePublicKey'])
    || !nonEmptyString(value.code) || !nonEmptyString(value.deviceName) || !nonEmptyString(value.devicePublicKey)) {
    throw new Error('link access: invalid pairing request')
  }
  return value as unknown as LinkPairRequest
}

/**
 * Parse and validate one untrusted pairing response at the client boundary.
 * @param value - decoded JSON body.
 * @returns the validated pairing fields.
 * @throws when the body is not exactly the pairing response shape.
 */
export function parseLinkPairValue(value: unknown): LinkPairValue {
  if (!isRecord(value)
    || !exactKeys(value, ['deviceId', 'hostId', 'hostName', 'role', 'linkProtocolVersion'])
    || !nonEmptyString(value.deviceId) || !nonEmptyString(value.hostId) || !nonEmptyString(value.hostName)
    || (value.role !== 'observer' && value.role !== 'controller' && value.role !== 'administrator')
    || value.linkProtocolVersion !== LINK_PROTOCOL_VERSION) {
    throw new Error('link access: invalid pairing response')
  }
  return value as unknown as LinkPairValue
}

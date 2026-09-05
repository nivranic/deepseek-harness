/**
 * Resource-scope enforcement for the Native Remote carrier. Device Trust
 * owns grants; this module extracts resource identities from the fixed Link
 * endpoint policies and projects Host-wide list/feed values before they cross
 * the device socket. Session, Workspace, Artifact, Attachment, and filesystem
 * owners still validate their own business relationships.
 * @module @deepseek-ai/dsh-link-access/authorization
 */

import type { DeviceAccess, DeviceId, PairedDevice } from '@deepseek-ai/dsh-device-trust'
import type { LinkEndpointScope } from './protocol.ts'

/** Session notifications Native companions consume; every other Host event stays local. */
const LINK_SESSION_EMIT_EVENTS = new Set([
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
])

/** One Host-issued Remote Event Client generation bound to one paired device. */
export interface LinkEventGeneration {
  readonly deviceId: DeviceId
  readonly clientId: string
  readonly eventIds: Set<string>
  readonly claims: Set<string>
  readonly abort: (reason: unknown) => void
}

/** Carrier-owned facts and callbacks used to project one Remote Event frame. */
export interface LinkRemoteEventProjectionContext {
  readonly device: PairedDevice
  readonly generation: LinkEventGeneration | undefined
  readonly allowRemoteApproval: boolean
  readonly isClientActive: (clientId: string) => boolean
  readonly delegate: (clientId: string, eventId: string) => void
  readonly abort: (reason: unknown) => void
}

/** Result of projecting one Gateway Remote Event frame for a Link device. */
export interface LinkRemoteEventProjection {
  readonly value: unknown
  readonly generation?: LinkEventGeneration
}

/** Resource-scope refusal returned after authentication and role checks. */
export type LinkScopeAuthorizationFailure =
  | 'session-scope'
  | 'workspace-scope'
  | 'resource-scope'
  | 'path-scope'
  | 'scope-invalid'

/**
 * Parse the named Gateway arguments needed by a scoped endpoint.
 * @param body - exact unary request bytes already authenticated by the carrier.
 * @param endpoint - path-selected canonical endpoint.
 * @returns the request's named `payload.args` object.
 * @throws when the envelope cannot prove the path-selected method and named arguments.
 */
export function parseScopedRpcArgs(body: Buffer, endpoint: string): Readonly<Record<string, unknown>> {
  const envelope = parseJsonObject(body)
  if (envelope.method !== endpoint || !isPlainRecord(envelope.payload)) {
    throw new Error('link access: scoped RPC envelope does not match the requested endpoint')
  }
  const args = envelope.payload.args
  if (!isPlainRecord(args)) throw new Error('link access: scoped RPC envelope has no named args object')
  return args
}

/**
 * Read named arguments from one decoded Remote stream payload.
 * @param payload - decoded stream request payload.
 * @returns the named args object, or `undefined` when absent or malformed.
 */
export function scopedStreamArgs(payload: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.args)) return undefined
  return payload.args
}

/**
 * Read the Host-issued identities carried by an interaction answer.
 * @param args - named `$events/result` arguments.
 * @returns both non-empty identities, or `undefined` when either is absent.
 */
export function interactionCorrelation(
  args: Readonly<Record<string, unknown>>,
): { readonly clientId: string; readonly eventId: string } | undefined {
  return typeof args.clientId === 'string' && args.clientId.length > 0
    && typeof args.eventId === 'string' && args.eventId.length > 0
    ? { clientId: args.clientId, eventId: args.eventId }
    : undefined
}

/**
 * Decide whether one Gateway interaction-answer response settled normally.
 * @param response - cloned Gateway RPC response.
 * @returns the RPC success flag.
 * @throws when the Gateway response does not carry its typed RPC envelope.
 */
export async function linkRpcSucceeded(response: Response): Promise<boolean> {
  const value = JSON.parse(await response.text()) as unknown
  if (!isPlainRecord(value) || !isPlainRecord(value.result) || typeof value.result.ok !== 'boolean') {
    throw new Error('link access: Gateway returned an invalid RPC response envelope')
  }
  return value.result.ok
}

/**
 * Apply one endpoint's fixed resource policy to its named arguments.
 * @param endpoint - canonical endpoint whose field locations are fixed below.
 * @param scope - policy resolved at carrier load.
 * @param args - named Gateway arguments from the authenticated request.
 * @param access - durable grants of the authenticated device.
 * @returns a stable refusal, or `undefined` when the owner may execute.
 */
export function authorizeScopedRequest(
  endpoint: string,
  scope: LinkEndpointScope,
  args: Readonly<Record<string, unknown>>,
  access: DeviceAccess,
): LinkScopeAuthorizationFailure | undefined {
  if (scope === 'unscoped' || scope === 'session-collection'
    || scope === 'workspace-collection' || scope === 'remote-events') return undefined
  if (scope === 'interaction') return 'scope-invalid'
  if (scope === 'workspace-path') {
    const workspaceId = stringField(args, 'workspaceId')
    if (workspaceId === undefined) return 'scope-invalid'
    return canAccessWorkspace(access, workspaceId) ? undefined : 'path-scope'
  }
  const sessionId = sessionTarget(endpoint, scope, args)
  if (sessionId === undefined) return 'scope-invalid'
  if (canAccessSession(access, sessionId)) return undefined
  return scope === 'session-resource' ? 'resource-scope' : 'session-scope'
}

/**
 * Whether one device grant covers a Session identity.
 * @param access - durable device grants.
 * @param sessionId - opaque Session identity at the wire boundary.
 * @returns whether the Session is covered.
 */
export function canAccessSession(access: DeviceAccess, sessionId: string): boolean {
  return access.sessions === 'all' || access.sessions.some(grant => grant === sessionId)
}

/**
 * Whether one device grant covers a Workspace identity.
 * @param access - durable device grants.
 * @param workspaceId - opaque Workspace identity at the wire boundary.
 * @returns whether the Workspace is covered.
 */
export function canAccessWorkspace(access: DeviceAccess, workspaceId: string): boolean {
  return access.workspaces === 'all' || access.workspaces.some(grant => grant === workspaceId)
}

/**
 * Remove out-of-scope rows from Host-wide unary values before socket output.
 * @param endpoint - canonical collection endpoint.
 * @param response - Gateway response carrying the normal RPC envelope.
 * @param access - durable grants of the authenticated device.
 * @returns the original response for full access, otherwise a filtered response.
 */
export async function filterLinkUnaryResponse(
  endpoint: string,
  response: Response,
  access: DeviceAccess,
): Promise<Response> {
  if (access.sessions === 'all' || (endpoint !== 'session/list' && endpoint !== 'session/search')) {
    return response
  }
  const text = await response.text()
  const envelope = parseTextObject(text)
  const result = plainField(envelope, 'result')
  if (result?.ok !== true) return responseFromText(response, text)
  const value = plainField(result, 'value')
  if (value === undefined || !Array.isArray(value.items)) {
    throw new Error(`link access: ${endpoint} returned no filterable items`)
  }
  const items = value.items.filter((item) => {
    return isPlainRecord(item)
      && typeof item.sessionId === 'string'
      && canAccessSession(access, item.sessionId)
  })
  const filteredValue = {
    ...value,
    items,
    ...(endpoint === 'session/search' ? { hasMore: false } : {}),
  }
  return responseFromJson(response, {
    ...envelope,
    result: { ...result, value: filteredValue },
  })
}

/**
 * Remove out-of-scope rows from Host-wide stream values.
 * @param endpoint - canonical collection stream endpoint.
 * @param value - one validated same-process Gateway stream value.
 * @param access - durable grants of the authenticated device.
 * @returns the projected value, or `undefined` when the frame is wholly out of scope.
 */
export function filterLinkStreamValue(
  endpoint: string,
  value: unknown,
  access: DeviceAccess,
): unknown {
  if (endpoint === 'session/control') return filterSessionControl(value, access)
  if (endpoint === 'workspace/follow') return filterWorkspaceFollow(value, access)
  return value
}

/**
 * Project one Gateway Remote Event frame for a paired device. The Gateway
 * remains the pending-delivery owner; this function only records identities
 * actually delivered to this device and delegates withheld waterfalls.
 * @param value - one same-process Gateway Remote Event frame.
 * @param context - authenticated device, current generation, switches, and owner callbacks.
 * @returns the device-visible frame and any generation created by `ready`.
 * @throws when the frame cannot prove the fields needed for secure projection.
 */
export function projectLinkRemoteEvent(
  value: unknown,
  context: LinkRemoteEventProjectionContext,
): LinkRemoteEventProjection {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    throw new Error('link access: Remote Event stream emitted an invalid frame')
  }
  if (value.type === 'ready') {
    if (context.generation !== undefined || typeof value.clientId !== 'string' || value.clientId.length === 0) {
      throw new Error('link access: Remote Event stream emitted an invalid ready frame')
    }
    const created: LinkEventGeneration = {
      deviceId: context.device.deviceId,
      clientId: value.clientId,
      eventIds: new Set(),
      claims: new Set(),
      abort: context.abort,
    }
    if (context.isClientActive(created.clientId)) {
      throw new Error('link access: Remote Event Client identity is already active')
    }
    return { value, generation: created }
  }
  const generation = context.generation
  if (generation === undefined) throw new Error('link access: Remote Event item preceded its ready frame')
  if (value.type === 'emit') {
    const sessionId = sessionIdOfRemoteEmit(value)
    return {
      value: sessionId !== undefined && canAccessSession(context.device.access, sessionId) ? value : undefined,
    }
  }
  if (value.type === 'waterfall') {
    if (typeof value.eventId !== 'string' || value.eventId.length === 0
      || typeof value.agentId !== 'string' || value.agentId.length === 0) {
      throw new Error('link access: Remote Event waterfall has invalid correlation fields')
    }
    if (context.device.role === 'observer' || !context.allowRemoteApproval
      || !canAccessSession(context.device.access, value.agentId)) {
      context.delegate(generation.clientId, value.eventId)
      return { value: undefined }
    }
    generation.eventIds.add(value.eventId)
    return { value }
  }
  if (value.type === 'cancel') {
    if (typeof value.eventId !== 'string' || value.eventId.length === 0) {
      throw new Error('link access: Remote Event cancellation has no identity')
    }
    generation.claims.delete(value.eventId)
    return { value: generation.eventIds.delete(value.eventId) ? value : undefined }
  }
  throw new Error(`link access: Remote Event stream emitted unknown frame ${JSON.stringify(value.type)}`)
}

/**
 * Delegate every delivered interaction in one generation back to the Gateway.
 * @param generation - device-bound Remote Event generation being disabled or revoked.
 * @param delegate - Gateway callback accepting the equivalent of a `next` result.
 */
export function delegateLinkEventGeneration(
  generation: LinkEventGeneration,
  delegate: (clientId: string, eventId: string) => void,
): void {
  for (const eventId of generation.eventIds) delegate(generation.clientId, eventId)
  generation.eventIds.clear()
  generation.claims.clear()
}

function sessionTarget(
  endpoint: string,
  scope: LinkEndpointScope,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  if (endpoint === 'fileReferences/list') return stringField(args, 'agentId')
  if (endpoint === 'subagents/list') return stringField(args, 'parentSessionId')
  const request = plainField(args, 'request')
  if (request === undefined) return undefined
  if (scope !== 'session-address') return stringField(request, 'sessionId')
  const address = plainField(request, 'address')
  if (address === undefined) return undefined
  if (address.kind === 'session') return stringField(address, 'sessionId')
  if (address.kind === 'subagent') return stringField(address, 'parentSessionId')
  return undefined
}

function filterSessionControl(value: unknown, access: DeviceAccess): unknown {
  if (access.sessions === 'all') return value
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    throw new Error('link access: session/control emitted an invalid frame')
  }
  if (value.type !== 'baseline') {
    const sessionId = stringField(value, 'sessionId')
    if (sessionId === undefined) throw new Error('link access: session/control frame has no Session identity')
    return canAccessSession(access, sessionId) ? value : undefined
  }
  const baseline = plainField(value, 'value')
  if (baseline === undefined) throw new Error('link access: session/control baseline has no value')
  return {
    ...value,
    value: {
      ...baseline,
      queues: filterSessionRecord(plainField(baseline, 'queues'), access),
      jobs: filterSessionRecord(plainField(baseline, 'jobs'), access),
      projections: filterSessionRecord(plainField(baseline, 'projections'), access),
    },
  }
}

function filterWorkspaceFollow(value: unknown, access: DeviceAccess): unknown {
  if (access.workspaces === 'all' && access.sessions === 'all') return value
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    throw new Error('link access: workspace/follow emitted an invalid frame')
  }
  if (value.type === 'baseline') {
    const baseline = plainField(value, 'value')
    if (baseline === undefined || !Array.isArray(baseline.items) || !Array.isArray(baseline.archivedSessionIds)) {
      throw new Error('link access: workspace/follow baseline has invalid collections')
    }
    return {
      ...value,
      value: {
        ...baseline,
        items: baseline.items.flatMap((item) => {
          const filtered = filterWorkspace(item, access)
          return filtered === undefined ? [] : [filtered]
        }),
        archivedSessionIds: baseline.archivedSessionIds.filter(
          (id): id is string => typeof id === 'string' && canAccessSession(access, id),
        ),
      },
    }
  }
  if (value.type === 'upsert') {
    const workspace = filterWorkspace(value.workspace, access)
    return workspace === undefined ? undefined : { ...value, workspace }
  }
  if (value.type === 'remove') {
    const workspaceId = stringField(value, 'workspaceId')
    if (workspaceId === undefined) throw new Error('link access: workspace removal has no identity')
    return canAccessWorkspace(access, workspaceId) ? value : undefined
  }
  if (value.type === 'order') {
    if (!Array.isArray(value.workspaceIds)) throw new Error('link access: workspace order has no identities')
    return {
      ...value,
      workspaceIds: value.workspaceIds.filter(
        (id): id is string => typeof id === 'string' && canAccessWorkspace(access, id),
      ),
    }
  }
  if (value.type === 'archived') {
    if (!Array.isArray(value.archivedSessionIds)) throw new Error('link access: archive frame has no identities')
    return {
      ...value,
      archivedSessionIds: value.archivedSessionIds.filter(
        (id): id is string => typeof id === 'string' && canAccessSession(access, id),
      ),
    }
  }
  throw new Error(`link access: workspace/follow emitted unknown frame ${JSON.stringify(value.type)}`)
}

function filterWorkspace(value: unknown, access: DeviceAccess): Record<string, unknown> | undefined {
  if (!isPlainRecord(value) || typeof value.workspaceId !== 'string' || !Array.isArray(value.sessionIds)) {
    throw new Error('link access: workspace/follow emitted an invalid Workspace')
  }
  if (!canAccessWorkspace(access, value.workspaceId)) return undefined
  return {
    ...value,
    sessionIds: value.sessionIds.filter(
      (id): id is string => typeof id === 'string' && canAccessSession(access, id),
    ),
  }
}

function filterSessionRecord(
  value: Record<string, unknown> | undefined,
  access: DeviceAccess,
): Record<string, unknown> {
  if (value === undefined) throw new Error('link access: Session collection baseline has an invalid record')
  return Object.fromEntries(
    Object.entries(value).filter(([sessionId]) => canAccessSession(access, sessionId)),
  )
}

function sessionIdOfRemoteEmit(frame: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof frame.event !== 'string' || !LINK_SESSION_EMIT_EVENTS.has(frame.event)
    || !Array.isArray(frame.args) || frame.args.length === 0) return undefined
  const first: unknown = frame.args[0]
  if (frame.event === 'api-session/added') {
    return isPlainRecord(first) && typeof first.sessionId === 'string' ? first.sessionId : undefined
  }
  return typeof first === 'string' ? first : undefined
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function plainField(value: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> | undefined {
  const field = value[key]
  return isPlainRecord(field) ? field : undefined
}

function parseJsonObject(body: Buffer): Record<string, unknown> {
  return parseTextObject(body.toString('utf8'))
}

function parseTextObject(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown
  if (!isPlainRecord(value)) throw new Error('link access: expected a JSON object')
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function responseFromText(response: Response, text: string): Response {
  const headers = new Headers(response.headers)
  headers.set('content-length', String(Buffer.byteLength(text)))
  return new Response(text, { status: response.status, statusText: response.statusText, headers })
}

function responseFromJson(response: Response, value: object): Response {
  return responseFromText(response, JSON.stringify(value))
}

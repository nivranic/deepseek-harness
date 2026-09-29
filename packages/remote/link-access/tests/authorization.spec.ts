import { describe, expect, it, vi } from 'vitest'
import {
  DeviceSessionGrantId,
  DeviceWorkspaceGrantId,
  type DeviceAccess,
  type DeviceId,
  type PairedDevice,
} from '@deepseek-ai/dsh-device-trust'
import {
  authorizeScopedRequest,
  canAccessSession,
  canAccessWorkspace,
  delegateLinkEventGeneration,
  filterLinkStreamValue,
  filterLinkUnaryResponse,
  interactionCorrelation,
  linkRpcSucceeded,
  parseScopedRpcArgs,
  projectLinkRemoteEvent,
  scopedStreamArgs,
  type LinkEventGeneration,
  type LinkRemoteEventProjectionContext,
} from '../src/authorization.ts'
import type { LinkEndpointScope } from '../src/protocol.ts'

const FULL_ACCESS: DeviceAccess = { sessions: 'all', workspaces: 'all' }
const LIMITED_ACCESS: DeviceAccess = {
  sessions: [DeviceSessionGrantId('session-allowed')],
  workspaces: [DeviceWorkspaceGrantId('workspace-allowed')],
}

function pairedDevice(
  role: PairedDevice['role'] = 'controller',
  access: DeviceAccess = LIMITED_ACCESS,
): PairedDevice {
  return {
    deviceId: 'device-1' as DeviceId,
    name: 'Fixture',
    publicKeySpki: 'fixture',
    role,
    createdAt: 1,
    lastSeenAt: undefined,
    revokedAt: undefined,
    access,
  }
}

function generation(...eventIds: string[]): LinkEventGeneration {
  return {
    deviceId: 'device-1' as DeviceId,
    clientId: 'client-1',
    eventIds: new Set(eventIds),
    claims: new Set(),
    abort: vi.fn(),
  }
}

function eventContext(
  overrides: Partial<LinkRemoteEventProjectionContext> = {},
): LinkRemoteEventProjectionContext {
  return {
    device: pairedDevice(),
    generation: generation(),
    allowRemoteApproval: true,
    isClientActive: () => false,
    delegate: vi.fn(),
    abort: vi.fn(),
    ...overrides,
  }
}

function rpcBody(endpoint: string, args: unknown): Buffer {
  return Buffer.from(JSON.stringify({ method: endpoint, payload: { args } }))
}

function rpcResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ id: 1, result: value }), {
    status: 201,
    statusText: 'Created',
    headers: { 'x-test': 'kept' },
    ...init,
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('scoped RPC request parsing', () => {
  it('returns the path-matched named arguments', () => {
    expect(parseScopedRpcArgs(rpcBody('session/page', { request: { sessionId: 'session-allowed' } }), 'session/page'))
      .toEqual({ request: { sessionId: 'session-allowed' } })
  })

  it.each([
    [Buffer.from('{'), 'JSON'],
    [Buffer.from('[]'), 'expected a JSON object'],
    [Buffer.from(JSON.stringify({ method: 'session/list', payload: { args: {} } })), 'does not match'],
    [Buffer.from(JSON.stringify({ method: 'session/page', payload: [] })), 'does not match'],
    [Buffer.from(JSON.stringify({ method: 'session/page', payload: { args: [] } })), 'no named args'],
  ])('fails closed for a malformed or mismatched envelope', (body, message) => {
    expect(() => parseScopedRpcArgs(body, 'session/page')).toThrow(message)
  })

  it('extracts only an object of named stream arguments', () => {
    expect(scopedStreamArgs({ args: { request: { sessionId: 'session-allowed' } } }))
      .toEqual({ request: { sessionId: 'session-allowed' } })
    expect(scopedStreamArgs(null)).toBeUndefined()
    expect(scopedStreamArgs(new Date(0))).toBeUndefined()
    expect(scopedStreamArgs({ args: [] })).toBeUndefined()
  })

  it('requires both non-empty interaction identities', () => {
    expect(interactionCorrelation({ clientId: 'client-1', eventId: 'event-1' }))
      .toEqual({ clientId: 'client-1', eventId: 'event-1' })
    expect(interactionCorrelation({ eventId: 'event-1' })).toBeUndefined()
    expect(interactionCorrelation({ clientId: '', eventId: 'event-1' })).toBeUndefined()
    expect(interactionCorrelation({ clientId: 'client-1' })).toBeUndefined()
    expect(interactionCorrelation({ clientId: 'client-1', eventId: '' })).toBeUndefined()
  })

  it('reads only a typed Gateway RPC success result', async () => {
    await expect(linkRpcSucceeded(new Response(JSON.stringify({ result: { ok: true } })))).resolves.toBe(true)
    await expect(linkRpcSucceeded(new Response(JSON.stringify({ result: { ok: false } })))).resolves.toBe(false)
    await expect(linkRpcSucceeded(new Response('[]'))).rejects.toThrow('invalid RPC response envelope')
    await expect(linkRpcSucceeded(new Response(JSON.stringify({})))).rejects.toThrow('invalid RPC response envelope')
    await expect(linkRpcSucceeded(new Response(JSON.stringify({ result: { ok: 'yes' } })))).rejects.toThrow('invalid RPC response envelope')
  })
})

describe('request scope authorization', () => {
  it.each<LinkEndpointScope>([
    'unscoped',
    'session-collection',
    'workspace-collection',
    'remote-events',
  ])('delegates %s to its owner without extracting an identity', (scope) => {
    expect(authorizeScopedRequest('custom/read', scope, {}, LIMITED_ACCESS)).toBeUndefined()
  })

  it('keeps interaction authorization on the pending-interaction path', () => {
    expect(authorizeScopedRequest('$events/result', 'interaction', {}, FULL_ACCESS)).toBe('scope-invalid')
  })

  it('requires and checks the Workspace identity for filesystem endpoints', () => {
    expect(authorizeScopedRequest('workspaceFiles/list', 'workspace-path', {}, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('workspaceFiles/list', 'workspace-path', { workspaceId: '' }, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('workspaceFiles/list', 'workspace-path', { workspaceId: 'workspace-denied' }, LIMITED_ACCESS)).toBe('path-scope')
    expect(authorizeScopedRequest('workspaceFiles/read', 'workspace-path', { workspaceId: 'workspace-allowed' }, LIMITED_ACCESS)).toBeUndefined()
  })

  it('checks direct and resource Session targets', () => {
    expect(authorizeScopedRequest('session/prompt', 'session', {}, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('session/prompt', 'session', { request: [] }, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('session/prompt', 'session', { request: { sessionId: '' } }, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('session/prompt', 'session', { request: { sessionId: 'session-denied' } }, LIMITED_ACCESS)).toBe('session-scope')
    expect(authorizeScopedRequest('session/prompt', 'session', { request: { sessionId: 'session-allowed' } }, LIMITED_ACCESS)).toBeUndefined()
    expect(authorizeScopedRequest('session/artifact', 'session-resource', { request: { sessionId: 'session-denied' } }, LIMITED_ACCESS)).toBe('resource-scope')
    expect(authorizeScopedRequest('session/attachment', 'session-resource', { request: { sessionId: 'session-allowed' } }, LIMITED_ACCESS)).toBeUndefined()
  })

  it('extracts both forms of Session address', () => {
    expect(authorizeScopedRequest('session/page', 'session-address', { request: {} }, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('session/page', 'session-address', { request: { address: [] } }, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('session/page', 'session-address', { request: { address: { kind: 'unknown' } } }, LIMITED_ACCESS)).toBe('scope-invalid')
    expect(authorizeScopedRequest('session/page', 'session-address', { request: { address: { kind: 'session', sessionId: 'session-allowed' } } }, LIMITED_ACCESS)).toBeUndefined()
    expect(authorizeScopedRequest('session/follow', 'session-address', { request: { address: { kind: 'subagent', parentSessionId: 'session-denied' } } }, LIMITED_ACCESS)).toBe('session-scope')
  })

  it('extracts the dedicated file-reference and subagent fields', () => {
    expect(authorizeScopedRequest('fileReferences/list', 'session', { agentId: 'session-allowed' }, LIMITED_ACCESS)).toBeUndefined()
    expect(authorizeScopedRequest('fileReferences/list', 'session', { agentId: 'session-denied' }, LIMITED_ACCESS)).toBe('session-scope')
    expect(authorizeScopedRequest('subagents/list', 'session', { parentSessionId: 'session-allowed' }, LIMITED_ACCESS)).toBeUndefined()
    expect(authorizeScopedRequest('subagents/list', 'session', {}, LIMITED_ACCESS)).toBe('scope-invalid')
  })

  it('supports all-resource and explicit-list grants', () => {
    expect(canAccessSession(FULL_ACCESS, 'any-session')).toBe(true)
    expect(canAccessSession(LIMITED_ACCESS, 'session-allowed')).toBe(true)
    expect(canAccessSession(LIMITED_ACCESS, 'session-denied')).toBe(false)
    expect(canAccessWorkspace(FULL_ACCESS, 'any-workspace')).toBe(true)
    expect(canAccessWorkspace(LIMITED_ACCESS, 'workspace-allowed')).toBe(true)
    expect(canAccessWorkspace(LIMITED_ACCESS, 'workspace-denied')).toBe(false)
  })
})

describe('unary response projection', () => {
  it('returns responses unchanged when no collection projection applies', async () => {
    const full = rpcResponse({ ok: true, value: { items: [] } })
    const unrelated = rpcResponse({ ok: true, value: { items: [] } })
    expect(await filterLinkUnaryResponse('session/list', full, FULL_ACCESS)).toBe(full)
    expect(await filterLinkUnaryResponse('session/page', unrelated, LIMITED_ACCESS)).toBe(unrelated)
  })

  it.each(['session/list', 'session/search'])('filters %s and preserves response metadata', async (endpoint) => {
    const response = rpcResponse({
      ok: true,
      value: {
        items: [
          { sessionId: 'session-allowed', title: 'kept' },
          { sessionId: 'session-denied', title: 'removed' },
          { title: 'missing identity' },
          null,
        ],
        hasMore: true,
      },
    })
    const filtered = await filterLinkUnaryResponse(endpoint, response, LIMITED_ACCESS)
    expect(filtered.status).toBe(201)
    expect(filtered.statusText).toBe('Created')
    expect(filtered.headers.get('x-test')).toBe('kept')
    const text = await filtered.text()
    expect(filtered.headers.get('content-length')).toBe(String(Buffer.byteLength(text)))
    const envelope = JSON.parse(text) as { result: { value: { items: unknown[]; hasMore: boolean } } }
    expect(envelope.result.value.items).toEqual([{ sessionId: 'session-allowed', title: 'kept' }])
    expect(envelope.result.value.hasMore).toBe(endpoint === 'session/search' ? false : true)
  })

  it('passes structured Gateway failures through without projection', async () => {
    const response = rpcResponse({ ok: false, error: { code: 'denied' } })
    const filtered = await filterLinkUnaryResponse('session/list', response, LIMITED_ACCESS)
    expect(await json(filtered)).toEqual({ id: 1, result: { ok: false, error: { code: 'denied' } } })
  })

  it.each([
    [rpcResponse({ ok: true }), 'no filterable items'],
    [rpcResponse({ ok: true, value: { items: {} } }), 'no filterable items'],
    [new Response('[]'), 'expected a JSON object'],
  ])('fails closed when a collection response cannot be projected', async (response, message) => {
    await expect(filterLinkUnaryResponse('session/list', response, LIMITED_ACCESS)).rejects.toThrow(message)
  })
})

describe('stream value projection', () => {
  it('passes through unrelated streams and full-access collection streams', () => {
    const frame = { type: 'baseline' }
    expect(filterLinkStreamValue('session/follow', frame, LIMITED_ACCESS)).toBe(frame)
    expect(filterLinkStreamValue('session/control', frame, FULL_ACCESS)).toBe(frame)
    expect(filterLinkStreamValue('workspace/follow', frame, FULL_ACCESS)).toBe(frame)
  })

  it('filters Session control baselines and incremental frames', () => {
    const baseline = {
      type: 'baseline',
      value: {
        queues: { 'session-allowed': ['kept'], 'session-denied': ['removed'] },
        jobs: { 'session-allowed': ['kept'], 'session-denied': ['removed'] },
        projections: { 'session-allowed': ['kept'], 'session-denied': ['removed'] },
      },
    }
    expect(filterLinkStreamValue('session/control', baseline, LIMITED_ACCESS)).toEqual({
      type: 'baseline',
      value: {
        queues: { 'session-allowed': ['kept'] },
        jobs: { 'session-allowed': ['kept'] },
        projections: { 'session-allowed': ['kept'] },
      },
    })
    const allowed = { type: 'queue', sessionId: 'session-allowed' }
    expect(filterLinkStreamValue('session/control', allowed, LIMITED_ACCESS)).toBe(allowed)
    expect(filterLinkStreamValue('session/control', { type: 'queue', sessionId: 'session-denied' }, LIMITED_ACCESS)).toBeUndefined()
  })

  it.each([
    [null, 'invalid frame'],
    [new Date(0), 'invalid frame'],
    [{}, 'invalid frame'],
    [{ type: 'queue' }, 'no Session identity'],
    [{ type: 'baseline' }, 'baseline has no value'],
    [{ type: 'baseline', value: { jobs: {}, projections: {} } }, 'invalid record'],
    [{ type: 'baseline', value: { queues: {}, projections: {} } }, 'invalid record'],
    [{ type: 'baseline', value: { queues: {}, jobs: {} } }, 'invalid record'],
  ])('rejects invalid Session control frames', (frame, message) => {
    expect(() => filterLinkStreamValue('session/control', frame, LIMITED_ACCESS)).toThrow(message)
  })

  it('filters every Workspace follow frame kind', () => {
    const baseline = {
      type: 'baseline',
      value: {
        items: [
          { workspaceId: 'workspace-allowed', sessionIds: ['session-allowed', 'session-denied', null] },
          { workspaceId: 'workspace-denied', sessionIds: ['session-allowed'] },
        ],
        archivedSessionIds: ['session-allowed', 'session-denied', null],
      },
    }
    expect(filterLinkStreamValue('workspace/follow', baseline, LIMITED_ACCESS)).toEqual({
      type: 'baseline',
      value: {
        items: [{ workspaceId: 'workspace-allowed', sessionIds: ['session-allowed'] }],
        archivedSessionIds: ['session-allowed'],
      },
    })
    expect(filterLinkStreamValue('workspace/follow', {
      type: 'upsert',
      workspace: { workspaceId: 'workspace-allowed', sessionIds: ['session-allowed', 'session-denied'] },
    }, LIMITED_ACCESS)).toEqual({
      type: 'upsert',
      workspace: { workspaceId: 'workspace-allowed', sessionIds: ['session-allowed'] },
    })
    expect(filterLinkStreamValue('workspace/follow', {
      type: 'upsert',
      workspace: { workspaceId: 'workspace-denied', sessionIds: [] },
    }, LIMITED_ACCESS)).toBeUndefined()
    expect(filterLinkStreamValue('workspace/follow', { type: 'remove', workspaceId: 'workspace-allowed' }, LIMITED_ACCESS)).toEqual({ type: 'remove', workspaceId: 'workspace-allowed' })
    expect(filterLinkStreamValue('workspace/follow', { type: 'remove', workspaceId: 'workspace-denied' }, LIMITED_ACCESS)).toBeUndefined()
    expect(filterLinkStreamValue('workspace/follow', { type: 'order', workspaceIds: ['workspace-allowed', 'workspace-denied', null] }, LIMITED_ACCESS)).toEqual({ type: 'order', workspaceIds: ['workspace-allowed'] })
    expect(filterLinkStreamValue('workspace/follow', { type: 'archived', archivedSessionIds: ['session-allowed', 'session-denied', null] }, LIMITED_ACCESS)).toEqual({ type: 'archived', archivedSessionIds: ['session-allowed'] })
  })

  it.each([
    [null, 'invalid frame'],
    [{}, 'invalid frame'],
    [{ type: 'baseline', value: { items: [] } }, 'invalid collections'],
    [{ type: 'baseline', value: { items: {}, archivedSessionIds: [] } }, 'invalid collections'],
    [{ type: 'baseline', value: { items: [], archivedSessionIds: {} } }, 'invalid collections'],
    [{ type: 'baseline', value: { items: [null], archivedSessionIds: [] } }, 'invalid Workspace'],
    [{ type: 'baseline', value: { items: [{ workspaceId: 1, sessionIds: [] }], archivedSessionIds: [] } }, 'invalid Workspace'],
    [{ type: 'baseline', value: { items: [{ workspaceId: 'workspace-allowed', sessionIds: {} }], archivedSessionIds: [] } }, 'invalid Workspace'],
    [{ type: 'upsert', workspace: null }, 'invalid Workspace'],
    [{ type: 'remove' }, 'removal has no identity'],
    [{ type: 'order' }, 'order has no identities'],
    [{ type: 'archived' }, 'archive frame has no identities'],
    [{ type: 'future' }, 'unknown frame'],
  ])('rejects invalid Workspace follow frames', (frame, message) => {
    expect(() => filterLinkStreamValue('workspace/follow', frame, LIMITED_ACCESS)).toThrow(message)
  })
})

describe('Remote Event projection', () => {
  it('binds the Host-issued ready identity to the authenticated device', () => {
    const abort = vi.fn()
    const result = projectLinkRemoteEvent(
      { type: 'ready', clientId: 'client-ready', host: { home: '/fixture' } },
      eventContext({ generation: undefined, abort }),
    )
    expect(result.value).toEqual({ type: 'ready', clientId: 'client-ready', host: { home: '/fixture' } })
    expect(result.generation).toMatchObject({ deviceId: 'device-1', clientId: 'client-ready' })
    expect(result.generation?.eventIds.size).toBe(0)
    expect(result.generation?.claims.size).toBe(0)
    result.generation?.abort('closed')
    expect(abort).toHaveBeenCalledWith('closed')
  })

  it.each([
    [null, eventContext(), 'invalid frame'],
    [{}, eventContext(), 'invalid frame'],
    [new Date(0), eventContext(), 'invalid frame'],
    [{ type: 'ready', clientId: 'next' }, eventContext(), 'invalid ready'],
    [{ type: 'ready' }, eventContext({ generation: undefined }), 'invalid ready'],
    [{ type: 'ready', clientId: '' }, eventContext({ generation: undefined }), 'invalid ready'],
    [{ type: 'ready', clientId: 'duplicate' }, eventContext({ generation: undefined, isClientActive: () => true }), 'already active'],
    [{ type: 'emit', event: 'api-session/status', args: ['session-allowed'] }, eventContext({ generation: undefined }), 'preceded its ready'],
  ])('rejects an invalid generation frame', (frame, context, message) => {
    expect(() => projectLinkRemoteEvent(frame, context)).toThrow(message)
  })

  it.each([
    [{ type: 'emit', event: 'api-session/status', args: ['session-allowed'] }, true],
    [{ type: 'emit', event: 'api-session/status', args: ['session-denied'] }, false],
    [{ type: 'emit', event: 'api-session/added', args: [{ sessionId: 'session-allowed' }] }, true],
    [{ type: 'emit', event: 'api-session/added', args: [{ sessionId: 'session-denied' }] }, false],
    [{ type: 'emit', event: 'api-session/added', args: [new Date(0)] }, false],
    [{ type: 'emit', event: 'api-session/added', args: [{}] }, false],
    [{ type: 'emit', event: 'api-session/error', args: [1] }, false],
    [{ type: 'emit', event: 'unlisted', args: ['session-allowed'] }, false],
    [{ type: 'emit', event: 1, args: ['session-allowed'] }, false],
    [{ type: 'emit', event: 'api-session/status', args: {} }, false],
    [{ type: 'emit', event: 'api-session/status', args: [] }, false],
  ])('projects only recognized notifications for an authorized Session', (frame, visible) => {
    const result = projectLinkRemoteEvent(frame, eventContext())
    expect(result.value === frame).toBe(visible)
    if (!visible) expect(result.value).toBeUndefined()
  })

  it.each([
    [{ type: 'waterfall', agentId: 'session-allowed' }],
    [{ type: 'waterfall', eventId: '', agentId: 'session-allowed' }],
    [{ type: 'waterfall', eventId: 'event-1' }],
    [{ type: 'waterfall', eventId: 'event-1', agentId: '' }],
  ])('rejects a waterfall without both correlation identities', (frame) => {
    expect(() => projectLinkRemoteEvent(frame, eventContext())).toThrow('invalid correlation fields')
  })

  it.each([
    ['observer role', eventContext({ device: pairedDevice('observer') })],
    ['approval disabled', eventContext({ allowRemoteApproval: false })],
    ['Session denied', eventContext({ device: pairedDevice('controller', { sessions: [], workspaces: 'all' }) })],
  ])('delegates a withheld waterfall for %s', (_label, context) => {
    const result = projectLinkRemoteEvent(
      { type: 'waterfall', eventId: 'event-1', agentId: 'session-allowed' },
      context,
    )
    expect(result.value).toBeUndefined()
    expect(context.delegate).toHaveBeenCalledWith('client-1', 'event-1')
    expect(context.generation?.eventIds.size).toBe(0)
  })

  it('records only a delivered, authorized waterfall', () => {
    const context = eventContext()
    const frame = { type: 'waterfall', eventId: 'event-1', agentId: 'session-allowed' }
    expect(projectLinkRemoteEvent(frame, context).value).toBe(frame)
    expect(context.generation?.eventIds).toEqual(new Set(['event-1']))
    expect(context.delegate).not.toHaveBeenCalled()
  })

  it.each([
    [{ type: 'cancel' }],
    [{ type: 'cancel', eventId: '' }],
  ])('rejects a cancellation without an identity', (frame) => {
    expect(() => projectLinkRemoteEvent(frame, eventContext())).toThrow('cancellation has no identity')
  })

  it('forwards cancellation only for an interaction delivered to this generation', () => {
    const active = generation('event-1')
    active.claims.add('event-1')
    const frame = { type: 'cancel', eventId: 'event-1' }
    expect(projectLinkRemoteEvent(frame, eventContext({ generation: active })).value).toBe(frame)
    expect(active.eventIds.size).toBe(0)
    expect(active.claims.size).toBe(0)
    expect(projectLinkRemoteEvent(frame, eventContext({ generation: active })).value).toBeUndefined()
  })

  it('rejects unknown Remote Event frame kinds', () => {
    expect(() => projectLinkRemoteEvent({ type: 'future' }, eventContext())).toThrow('unknown frame')
  })

  it('delegates and clears every interaction retained by a generation', () => {
    const active = generation('event-a', 'event-b')
    active.claims.add('event-a')
    const delegate = vi.fn()
    delegateLinkEventGeneration(active, delegate)
    expect(delegate.mock.calls).toEqual([
      ['client-1', 'event-a'],
      ['client-1', 'event-b'],
    ])
    expect(active.eventIds.size).toBe(0)
    expect(active.claims.size).toBe(0)
    delegateLinkEventGeneration(active, delegate)
    expect(delegate).toHaveBeenCalledTimes(2)
  })
})

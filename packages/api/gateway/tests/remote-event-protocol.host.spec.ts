import { describe, expect, it } from 'vitest'
import {
  isRemoteJsonValue,
  parseRemoteEventResult,
  parseRemoteInteractionRecord,
  parseRemoteStreamClientMessage,
  projectRemoteEventRequest,
  projectRemoteEventRejection,
  restoreRemoteEventRejection,
  type RemoteEventId,
} from '../src/stream-protocol.ts'

describe('Remote interaction records', () => {
  const eventId = 'event-1' as RemoteEventId
  const record = {
    requestId: eventId, sessionId: 'session-1', type: 'approval', requiredPermission: 'approval.respond',
    createdAt: 100, status: 'pending', revision: 1,
  }

  it('preserves configured expiry and requires it on expired terminal records', () => {
    const expiring = { ...record, expiresAt: 200 }
    expect(parseRemoteInteractionRecord(expiring, eventId, true)).toEqual(expiring)
    const expired = { ...expiring, status: 'expired', revision: 2 }
    expect(parseRemoteInteractionRecord(expired, eventId, false)).toEqual(expired)
    expect(() => parseRemoteInteractionRecord({ ...record, status: 'expired', revision: 2 }, eventId, false))
      .toThrow('invalid interaction record')
  })

  it.each([undefined, null, 0, 99, 100, 100.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '200'])
  ('rejects invalid expiresAt %s', (expiresAt) => {
    expect(() => parseRemoteInteractionRecord({ ...record, expiresAt }, eventId, true)).toThrow('invalid interaction record')
  })

  it('accepts pending approvals and questions and terminal revisions', () => {
    expect(parseRemoteInteractionRecord(record, eventId, true)).toEqual(record)
    const question = { ...record, type: 'question', requiredPermission: 'question.respond' }
    expect(parseRemoteInteractionRecord(question, eventId, true)).toEqual(question)
    for (const status of ['resolved', 'delegated', 'cancelled']) {
      const terminal = { ...record, status, revision: 2 }
      expect(parseRemoteInteractionRecord(terminal, eventId, false)).toEqual(terminal)
      expect(() => parseRemoteInteractionRecord(terminal, eventId, true)).toThrow('invalid interaction record')
    }
    expect(() => parseRemoteInteractionRecord(record, eventId, false)).toThrow('invalid interaction record')
  })

  it.each([
    { requestId: 'other' }, { sessionId: '' }, { sessionId: 1 }, { extra: true },
    { createdAt: -1 }, { createdAt: -0 }, { createdAt: 1.5 }, { createdAt: NaN },
    { createdAt: Infinity }, { createdAt: Number.MAX_SAFE_INTEGER + 1 }, { createdAt: '100' },
    { type: 'unknown' }, { requiredPermission: 'question.respond' }, { status: 'unknown' },
    { status: ['resolved'] }, { revision: 0 }, { revision: '1' },
  ])('rejects malformed or mismatched records %#', (patch) => {
    expect(() => parseRemoteInteractionRecord({ ...record, ...patch }, eventId, true))
      .toThrow('invalid interaction record')
    expect(() => parseRemoteInteractionRecord({ ...record, status: 'resolved', revision: 2, ...patch }, eventId, false))
      .toThrow('invalid interaction record')
  })

  it.each([null, [], {}, { ...record, revision: undefined }])('rejects missing records or fields %#', (value) => {
    expect(() => parseRemoteInteractionRecord(value, eventId, true)).toThrow('invalid interaction record')
  })
})

describe('Remote Event result protocol', () => {
  it.each([{ kind: 'next' }, { kind: 'result', value: true },
    { kind: 'rejected', error: { name: 'Error', message: 'cancelled' } }])('preserves revision for $kind', (outcome) => {
    const value = { clientId: 'client-1', eventId: 'event-1', interactionRevision: 1, outcome }
    expect(parseRemoteEventResult(value)).toEqual(value)
  })

  it.each([undefined, null, 0, -0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1'])
  ('rejects an invalid interaction revision %s', (interactionRevision) => {
    expect(() => parseRemoteEventResult({
      clientId: 'client-1', eventId: 'event-1', interactionRevision, outcome: { kind: 'next' },
    })).toThrow('invalid Remote event result')
  })

  it('accepts delegation, values, and structured rejections', () => {
    expect(parseRemoteEventResult({
      clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next' },
    })).toEqual({ clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next' } })
    expect(parseRemoteEventResult({
      clientId: 'client-1', eventId: 'event-2', outcome: { kind: 'result' },
    })).toEqual({ clientId: 'client-1', eventId: 'event-2', outcome: { kind: 'result' } })
    expect(parseRemoteEventResult({
      clientId: 'client-1', eventId: 'event-3', outcome: { kind: 'result', value: { accepted: true } },
    })).toEqual({
      clientId: 'client-1', eventId: 'event-3', outcome: { kind: 'result', value: { accepted: true } },
    })
    expect(parseRemoteEventResult({
      clientId: 'client-1',
      eventId: 'event-minimal',
      outcome: { kind: 'rejected', error: { name: 'Error', message: 'offline' } },
    })).toEqual({
      clientId: 'client-1',
      eventId: 'event-minimal',
      outcome: { kind: 'rejected', error: { name: 'Error', message: 'offline' } },
    })
    expect(parseRemoteEventResult({
      clientId: 'client-1',
      eventId: 'event-4',
      outcome: {
        kind: 'rejected',
        error: {
          name: 'ApprovalError',
          message: 'declined',
          code: 'DECLINED',
          details: { retryable: false },
        },
      },
    })).toEqual({
      clientId: 'client-1',
      eventId: 'event-4',
      outcome: {
        kind: 'rejected',
        error: {
          name: 'ApprovalError',
          message: 'declined',
          code: 'DECLINED',
          details: { retryable: false },
        },
      },
    })
  })

  it.each([
    null,
    [],
    {},
    { clientId: '', eventId: 'event-1', outcome: { kind: 'next' } },
    { clientId: 'client-1', eventId: '', outcome: { kind: 'next' } },
    { clientId: 'client-1', eventId: 'event-1', outcome: null },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next' }, extra: true },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'next', value: null } },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'result', extra: true } },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'result', value: undefined } },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'unknown' } },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error: null } },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error: { name: '', message: 'bad' } } },
    { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error: { name: 'Error', message: 1 } } },
    {
      clientId: 'client-1',
      eventId: 'event-1',
      outcome: { kind: 'rejected', error: { name: 'Error', message: 'bad', code: 1 } },
    },
    {
      clientId: 'client-1',
      eventId: 'event-1',
      outcome: { kind: 'rejected', error: { name: 'Error', message: 'bad', details: 1n } },
    },
    {
      clientId: 'client-1',
      eventId: 'event-1',
      outcome: { kind: 'rejected', error: { name: 'Error', message: 'bad', extra: true } },
    },
  ])('rejects an invalid result frame: %#', (value) => {
    expect(() => parseRemoteEventResult(value)).toThrow('api gateway: invalid Remote event')
  })

  it('rejects symbol properties in rejection records', () => {
    const error = { name: 'Error', message: 'bad', [Symbol('hidden')]: true }
    expect(() => parseRemoteEventResult({
      clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'rejected', error },
    })).toThrow('api gateway: invalid Remote event rejection')
  })
})

describe('Remote Event request projection', () => {
  it('removes only the direct Agent and signal fields', () => {
    const agent = { kind: 'agent' }
    const abort = new AbortController()
    const nested = { agent, signal: 'payload' }
    const projected = projectRemoteEventRequest({
      agent,
      signal: abort.signal,
      prompt: 'approve?',
      nested,
    }, agent)

    expect(projected).toEqual({
      request: { prompt: 'approve?', nested },
      signal: abort.signal,
    })
    expect(Object.getPrototypeOf(projected.request)).toBeNull()
  })

  it('accepts a null-prototype request and an omitted signal', () => {
    const agent = { kind: 'agent' }
    const request = Object.assign(Object.create(null) as Record<string, unknown>, {
      agent,
      accepted: true,
    })
    expect(projectRemoteEventRequest(request, agent)).toEqual({
      request: { accepted: true },
    })
  })

  it('requires the scoped Agent as a direct own field', () => {
    const agent = { kind: 'agent' }
    expect(() => projectRemoteEventRequest(null, agent))
      .toThrow('must carry its scoped Agent directly')
    expect(() => projectRemoteEventRequest({}, agent))
      .toThrow('must carry its scoped Agent directly')
    expect(() => projectRemoteEventRequest({ agent: {} }, agent))
      .toThrow('must carry its scoped Agent directly')
    expect(() => projectRemoteEventRequest(Object.create({ agent }), agent))
      .toThrow('must carry its scoped Agent directly')
  })

  it('rejects an invalid direct signal', () => {
    const agent = { kind: 'agent' }
    expect(() => projectRemoteEventRequest({ agent, signal: 'abort' }, agent))
      .toThrow('request signal must be an AbortSignal')
  })

  it('rejects non-JSON payload fields', () => {
    const agent = { kind: 'agent' }
    expect(() => projectRemoteEventRequest({ agent, value: 1n }, agent))
      .toThrow('request is not lossless JSON data')

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => projectRemoteEventRequest({ agent, cycle }, agent))
      .toThrow('request is not lossless JSON data')
  })

  it('rejects symbol and non-enumerable payload fields', () => {
    const agent = { kind: 'agent' }
    expect(() => projectRemoteEventRequest({ agent, [Symbol('hidden')]: true }, agent))
      .toThrow('request has a non-JSON property')

    const hidden = { agent }
    Object.defineProperty(hidden, 'value', { value: true })
    expect(() => projectRemoteEventRequest(hidden, agent))
      .toThrow('request has a non-JSON property')
  })
})

describe('Remote Event rejection projection', () => {
  it('preserves stable error fields in both directions', () => {
    const reason = Object.assign(new Error('declined'), {
      name: 'ApprovalError',
      code: 'DECLINED',
      details: { retryable: false },
    })
    expect(projectRemoteEventRejection(reason)).toEqual({
      name: 'ApprovalError',
      message: 'declined',
      code: 'DECLINED',
      details: { retryable: false },
    })

    const restored = restoreRemoteEventRejection({
      name: 'ApprovalError',
      message: 'declined',
      code: 'DECLINED',
      details: { retryable: false },
    }) as Error & { code?: string; details?: unknown }
    expect(restored).toMatchObject({
      name: 'ApprovalError',
      message: 'declined',
      code: 'DECLINED',
      details: { retryable: false },
    })
  })

  it('normalizes arbitrary reasons and omits non-JSON optional fields', () => {
    expect(projectRemoteEventRejection('offline')).toEqual({
      name: 'Error', message: 'offline',
    })
    expect(projectRemoteEventRejection(undefined)).toEqual({
      name: 'Error', message: 'undefined',
    })
    expect(projectRemoteEventRejection({
      name: 1, message: 2, code: 3, details: 1n,
    })).toEqual({
      name: 'Error', message: '[object Object]',
    })

    const restored = restoreRemoteEventRejection({ name: 'Error', message: 'offline' })
    expect(restored).toMatchObject({ name: 'Error', message: 'offline' })
    expect(restored).not.toHaveProperty('code')
    expect(restored).not.toHaveProperty('details')
  })
})

describe('Remote Event JSON values', () => {
  it('accepts lossless JSON values, null-prototype objects, and repeated references', () => {
    const shared = { value: 1 }
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      enabled: true,
    })
    expect(isRemoteJsonValue({
      null: null,
      string: 'value',
      boolean: true,
      number: 1.5,
      array: [shared, shared],
      nullPrototype,
    })).toBe(true)
  })

  it.each([
    undefined,
    1n,
    Symbol('value'),
    () => undefined,
    NaN,
    Number.POSITIVE_INFINITY,
    -0,
  ])('rejects a non-lossless scalar: %s', (value) => {
    expect(isRemoteJsonValue(value)).toBe(false)
  })

  it('rejects cycles and non-plain arrays and objects', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(isRemoteJsonValue(cycle)).toBe(false)

    class Fixture {
      value = 1
    }
    expect(isRemoteJsonValue(new Fixture())).toBe(false)

    const customArray = [1]
    Object.setPrototypeOf(customArray, null)
    expect(isRemoteJsonValue(customArray)).toBe(false)
    expect(isRemoteJsonValue(Object.assign([1], { extra: true }))).toBe(false)

    const sparse = new Array<unknown>(2)
    sparse[1] = 'value'
    expect(isRemoteJsonValue(sparse)).toBe(false)
    const disguisedSparse = Object.assign(new Array<unknown>(2), { extra: true })
    disguisedSparse[1] = 'value'
    expect(isRemoteJsonValue(disguisedSparse)).toBe(false)
    expect(isRemoteJsonValue([undefined])).toBe(false)

    const symbolic = { [Symbol('value')]: true }
    expect(isRemoteJsonValue(symbolic)).toBe(false)
    const hidden = {}
    Object.defineProperty(hidden, 'value', { value: true })
    expect(isRemoteJsonValue(hidden)).toBe(false)
    expect(isRemoteJsonValue({ nested: undefined })).toBe(false)
  })
})

describe('Remote stream client protocol', () => {
  it('rejects the removed logical-stream input message', () => {
    expect(() => parseRemoteStreamClientMessage(JSON.stringify({
      type: 'input', streamId: 'stream-1', value: { answer: true },
    }))).toThrow('api gateway: invalid Remote stream client message')
  })
})

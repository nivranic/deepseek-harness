import { describe, expect, it } from 'vitest'
import { DIAGNOSTICS_ONLY_ENDPOINTS, decodeRemotePayload, decodeRemoteRequest, encodeRemotePayload } from '../src/protocol.ts'

describe('Remote request codecs', () => {
  it('retains the selected response codec without admitting malformed argument envelopes', () => {
    expect(decodeRemoteRequest('$events', { args: {} })).toEqual({ version: 1, payload: { args: {} }, diagnosticsOnly: false })
    for (const version of [1, 2] as const) {
      expect(decodeRemoteRequest('$events', { apiProtocolVersion: version, args: {} }))
        .toEqual({ version, payload: { args: {} }, diagnosticsOnly: false })
      const malformed = { apiProtocolVersion: version, args: {}, extra: true }
      expect(decodeRemoteRequest('$events', malformed)).toEqual({ version, payload: malformed, diagnosticsOnly: false })
    }
  })

  it('admits the diagnostics-only announcement on the legacy codec for Host discovery endpoints', () => {
    expect(decodeRemoteRequest('host/describe', { apiProtocolVersion: 0, args: {} }))
      .toEqual({ version: 1, payload: { args: {} }, diagnosticsOnly: true })
    const malformed = { apiProtocolVersion: 0, args: {}, extra: true }
    expect(decodeRemoteRequest('host/negotiate', malformed)).toEqual({ version: 1, payload: malformed, diagnosticsOnly: true })
    for (const endpoint of DIAGNOSTICS_ONLY_ENDPOINTS) expect(typeof endpoint).toBe('string')
  })

  it('preserves the frozen unversioned payload when encoding protocol 1', () => {
    const args = { request: { title: 'ship' } }
    expect(JSON.stringify(encodeRemotePayload(args, 1))).toBe('{"args":{"request":{"title":"ship"}}}')
    expect(encodeRemotePayload(args, 2)).toEqual({ apiProtocolVersion: 2, args })
  })

  it('does not strip invalid payload fields into a valid argument envelope', () => {
    for (const payload of [null, [], { apiProtocolVersion: 2 },
      { apiProtocolVersion: 2, args: {}, extra: true },
      { apiProtocolVersion: 2, args: {}, [Symbol('extra')]: true }]) {
      expect(decodeRemotePayload('fixture/run', payload)).toBe(payload)
    }
    const exotic = Object.assign(new Date(), { apiProtocolVersion: 2, args: {} })
    expect(decodeRemotePayload('fixture/run', exotic)).toBe(exotic)
    expect(decodeRemotePayload('fixture/run', { apiProtocolVersion: 2, args: null })).toEqual({ args: null })
  })

  it('rejects explicit malformed metadata rather than treating it as absent', () => {
    for (const apiProtocolVersion of [undefined, NaN, Infinity, false, 3, -1, 1.5, '0', '2', null, {}, []]) {
      expect(() => decodeRemotePayload('fixture/run', { apiProtocolVersion, args: {} }))
        .toThrow(expect.objectContaining({ code: 'gateway/protocol-unsupported' }))
    }
  })
})

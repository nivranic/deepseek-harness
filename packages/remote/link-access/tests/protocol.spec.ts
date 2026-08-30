import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LINK_ENDPOINTS,
  LINK_PROTOCOL_VERSION,
  authorizeLinkEndpoint,
  linkSigningInput,
  pairingEndpoint,
  parseLinkPairRequest,
  parseLinkPairValue,
  type LinkEndpointAccess,
} from '../src/protocol.ts'

const table = new Map<string, LinkEndpointAccess>([
  ['session/list', { endpoint: 'session/list', kind: 'unary', minRole: 'observer' }],
  ['session/prompt', { endpoint: 'session/prompt', kind: 'unary', minRole: 'controller' }],
  ['$events', { endpoint: '$events', kind: 'stream', minRole: 'observer' }],
  ['$events/result', { endpoint: '$events/result', kind: 'unary', minRole: 'controller', approval: true }],
])

describe('link-access protocol', () => {
  it('authorizes by allowlist membership, invocation kind, role, and the approval switch', () => {
    expect(authorizeLinkEndpoint(table, 'session/list', 'unary', 'observer', false)).toBeUndefined()
    expect(authorizeLinkEndpoint(table, 'session/prompt', 'unary', 'controller', false)).toBeUndefined()
    expect(authorizeLinkEndpoint(table, 'session/prompt', 'unary', 'administrator', false)).toBeUndefined()
    expect(authorizeLinkEndpoint(table, '$events', 'stream', 'observer', false)).toBeUndefined()
    expect(authorizeLinkEndpoint(table, 'session/prompt', 'unary', 'observer', false)).toBe('role')
    expect(authorizeLinkEndpoint(table, 'settings/describe', 'unary', 'controller', false)).toBe('not-remote')
    expect(authorizeLinkEndpoint(table, 'session/list', 'stream', 'observer', false)).toBe('not-remote')
    expect(authorizeLinkEndpoint(table, '$events/result', 'unary', 'controller', false)).toBe('approval-disabled')
    expect(authorizeLinkEndpoint(table, '$events/result', 'unary', 'controller', true)).toBeUndefined()
  })

  it('keeps every default endpoint well-formed and distinct', () => {
    const seen = new Set<string>()
    for (const input of DEFAULT_LINK_ENDPOINTS) {
      expect(seen.has(input.endpoint)).toBe(false)
      seen.add(input.endpoint)
      expect(authorizeLinkEndpoint(
        new Map([[input.endpoint, { ...input, minRole: input.minRole }]]),
        input.endpoint,
        input.kind,
        input.minRole,
        true,
      )).toBeUndefined()
    }
  })

  it('joins the canonical signing input deterministically', () => {
    expect(linkSigningInput('1', 'POST', '/api/session/list', 'abc')).toBe('1\nPOST\n/api/session/list\nabc')
    expect(linkSigningInput('2', 'GET', '/', '0')).not.toBe(linkSigningInput('2', 'GET', '/', '1'))
  })

  it('parses exactly one valid pairing request shape', () => {
    expect(parseLinkPairRequest({
      code: 'c', deviceName: 'iPhone', devicePublicKey: 'a2V5',
    })).toEqual({ code: 'c', deviceName: 'iPhone', devicePublicKey: 'a2V5' })
    for (const invalid of [
      null,
      [],
      'text',
      {},
      { code: '', deviceName: 'n', devicePublicKey: 'k' },
      { code: 'c', deviceName: '', devicePublicKey: 'k' },
      { code: 'c', deviceName: 'n', devicePublicKey: '' },
      { code: 'c', deviceName: 'n' },
      { code: 'c', deviceName: 'n', devicePublicKey: 'k', extra: true },
      { code: 1, deviceName: 'n', devicePublicKey: 'k' },
    ]) {
      expect(() => parseLinkPairRequest(invalid)).toThrow(/invalid pairing request/u)
    }
  })

  it('parses exactly one valid pairing response shape', () => {
    const value = {
      deviceId: 'd', hostId: 'h', hostName: 'n', role: 'controller', linkProtocolVersion: LINK_PROTOCOL_VERSION,
    }
    expect(parseLinkPairValue(value)).toEqual(value)
    for (const invalid of [
      null,
      {},
      { ...value, linkProtocolVersion: LINK_PROTOCOL_VERSION + 1 },
      { ...value, role: 'superuser' },
      { ...value, deviceId: '' },
      { ...value, extra: true },
    ]) {
      expect(() => parseLinkPairValue(invalid)).toThrow(/invalid pairing response/u)
    }
  })

  it('derives the pairing endpoint from the bind host or the first external IPv4', () => {
    expect(pairingEndpoint('127.0.0.1', 3001, [])).toBe('https://127.0.0.1:3001')
    const lan = { family: 'IPv4', address: '192.168.1.4', internal: false } as NetworkInterfaceInfo
    const loopback = { family: 'IPv4', address: '127.0.0.1', internal: true } as NetworkInterfaceInfo
    const v6 = { family: 'IPv6', address: 'fe80::1', internal: false } as NetworkInterfaceInfo
    expect(pairingEndpoint('0.0.0.0', 3003, [loopback, v6, lan])).toBe('https://192.168.1.4:3003')
    expect(pairingEndpoint('0.0.0.0', 3004, [v6, loopback])).toMatch(/^https:\/\/[^/]+:3004$/u)
    expect(pairingEndpoint('::', 3005, [])).toMatch(/^https:\/\/[^/]+:3005$/u)
  })
})

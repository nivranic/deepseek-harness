import { describe, expect, it } from 'vitest'
import { nativePairingOrigin } from '../src/client/pairing-origin.ts'

describe('native pairing address', () => {
  it.each([
    [' https://host.test:8443/ ', 8443, 'https://host.test:8443'],
    ['https://[2001:db8::1]:8443', 8443, 'https://[2001:db8::1]:8443'],
    ['https://host.test', 443, 'https://host.test'],
  ])('normalizes a reachable root origin %s', (input, port, expected) => {
    expect(nativePairingOrigin(input, port)).toBe(expected)
  })
  it.each([
    'host.test', 'http://host.test:8443', 'https://host.test:9443',
    'https://user:password@host.test:8443', 'https://host.test:8443/path',
    'https://host.test:8443/?query=1', 'https://host.test:8443/#fragment',
    'https://0.0.0.0:8443', 'https://[::]:8443',
  ])('refuses unusable or ambiguous input %s', (input) => {
    expect(nativePairingOrigin(input, 8443)).toBeUndefined()
  })
})

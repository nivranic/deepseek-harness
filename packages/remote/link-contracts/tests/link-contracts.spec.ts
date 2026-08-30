/** Contract behavior: fixture round-trips, table coverage, emitted artifacts. */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LINK_CONTRACT_FIXTURES, LINK_CONTRACT_TYPES,
  LinkAdminStatusSchema, LinkDeviceRecordSchema, LinkPairingPayloadSchema,
} from '../src/index.ts'
import { generateLinkContracts } from '../src/generate.ts'

describe('link contract fixtures', () => {
  it('round-trips the typed fixtures through the wire schemas', () => {
    const byId = new Map(LINK_CONTRACT_FIXTURES.map(fixture => [fixture.id, fixture.value]))
    expect(LinkPairingPayloadSchema.parse(byId.get('pairing-payload'))).toEqual(byId.get('pairing-payload'))
    expect(LinkDeviceRecordSchema.parse(byId.get('device-record'))).toEqual(byId.get('device-record'))
    expect(LinkAdminStatusSchema.parse(byId.get('admin-status'))).toEqual(byId.get('admin-status'))
  })

  it('rejects a drifted payload and a wrong-length fingerprint', () => {
    expect(LinkPairingPayloadSchema.safeParse({ v: 2 }).success).toBe(false)
    const pairing = LINK_CONTRACT_FIXTURES.find(fixture => fixture.id === 'pairing-payload')!.value as { spkiFingerprint: string }
    expect(LinkPairingPayloadSchema.safeParse({ ...pairing, spkiFingerprint: 'abcd' }).success).toBe(false)
    const device = LINK_CONTRACT_FIXTURES.find(fixture => fixture.id === 'device-record')!.value as { role: string }
    expect(LinkDeviceRecordSchema.safeParse({ ...device, role: 'root' }).success).toBe(false)
  })

  it('covers every object type with fields and every fixture with a table row', () => {
    const names = new Set(LINK_CONTRACT_TYPES.map(type => type.name))
    expect(names.size).toBe(LINK_CONTRACT_TYPES.length)
    for (const type of LINK_CONTRACT_TYPES) {
      if (type.shape === 'object') expect(type.fields.length).toBeGreaterThan(0)
      for (const fieldRow of type.fields) {
        if (fieldRow.kind === 'object') expect(names.has(fieldRow.ref ?? '')).toBe(true)
      }
    }
    const fixtureRows = LINK_CONTRACT_TYPES.filter(type => type.fixture !== undefined)
    expect(fixtureRows.length).toBe(LINK_CONTRACT_FIXTURES.length)
  })
})

describe('link contract generator', () => {
  it('emits the manifest, Swift, and Kotlin with matching checksums', () => {
    const artifacts = generateLinkContracts()
    const manifest = JSON.parse(artifacts.manifest) as {
      types: Array<{ name: string }>
      fixtures: Array<{ id: string; type: string; sha256: string }>
    }
    expect(manifest.types.map(type => type.name)).toEqual(LINK_CONTRACT_TYPES.map(type => type.name))
    for (const row of manifest.fixtures) {
      const fixture = LINK_CONTRACT_FIXTURES.find(candidate => candidate.id === row.id)!
      const digest = createHash('sha256').update(`${JSON.stringify(fixture.value)}\n`).digest('hex')
      expect(row.sha256).toBe(digest)
    }
  })

  it('refuses a fixture whose table row does not name it', () => {
    const orphan = [{ type: 'LinkPairingPayload', id: 'not-the-row', value: {} }]
    expect(() => generateLinkContracts(undefined, orphan as never)).toThrow(/does not match the table row/u)
  })

  it('names every type in both emitted languages with stable code shape', () => {
    const artifacts = generateLinkContracts()
    for (const type of LINK_CONTRACT_TYPES) {
      const swiftDecl = type.shape === 'object' ? `public struct ${type.name}: Codable` : `public enum ${type.name}: String, Codable`
      const kotlinDecl = type.shape === 'object' ? `data class ${type.name}(` : `enum class ${type.name}(val wire: String)`
      expect(artifacts.swift).toContain(swiftDecl)
      expect(artifacts.kotlin).toContain(kotlinDecl)
    }
    expect(artifacts.swift).toContain('public let v: Double // constant 1')
    expect(artifacts.kotlin).toContain('enum class LinkDeviceRole(val wire: String)')
    expect(artifacts.kotlin).toContain('OBSERVER("observer")')
    expect(artifacts.swift).not.toContain('undefined')
    expect(artifacts.kotlin).not.toContain('undefined')
  })
})

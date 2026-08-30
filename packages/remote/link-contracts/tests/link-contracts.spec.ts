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
        if (fieldRow.kind === 'object' || fieldRow.kind === 'object-array' || fieldRow.kind === 'enum') {
          expect(names.has(fieldRow.ref)).toBe(true)
        }
      }
    }
    const fixtureRows = LINK_CONTRACT_TYPES.filter(type => type.fixture !== undefined)
    expect(fixtureRows.length).toBe(LINK_CONTRACT_FIXTURES.length)
  })

  it('claims session events and chunk rows only from the vocabulary enums', () => {
    const row = (name: string) => {
      const found = LINK_CONTRACT_TYPES.find(type => type.name === name)
      expect(found).toBeDefined()
      return found!.shape as readonly string[]
    }
    const eventKinds = row('LinkSessionEventKind')
    const chunkRowKinds = row('LinkChunkRowKind')
    const modeledEvents = new Set<string>()
    for (const type of LINK_CONTRACT_TYPES) {
      for (const tag of type.sessionEvents ?? []) {
        expect(eventKinds).toContain(tag)
        expect(modeledEvents.has(tag)).toBe(false)
        modeledEvents.add(tag)
      }
      for (const tag of type.chunkRows ?? []) expect(chunkRowKinds).toContain(tag)
    }
    // Every vocabulary tag except the payload-less seed marker has a payload row.
    expect([...eventKinds.filter(tag => tag !== 'session/end-seed')].sort())
      .toEqual([...modeledEvents].sort())
  })

  it('pins the session event payloads to the real host vocabulary', () => {
    const byId = new Map(LINK_CONTRACT_FIXTURES.map(fixture => [fixture.id, fixture.value]))
    expect(byId.get('event-plan-mode')).toEqual({ active: true })
    expect(byId.get('event-todo-write')).toEqual({
      todos: [
        { content: '编译伴侣应用', status: 'in_progress' },
        { content: '跑契约回放测试', status: 'pending' },
      ],
    })
    expect(byId.get('event-goal-change')).toMatchObject({ operation: 'create', goal: { phase: 'active', revision: 1 } })
    expect(byId.get('event-tool-result')).toMatchObject({
      message: { content: [{ type: 'tool-result', toolCallId: 'call-1' }] },
    })
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
    // Slash-bearing wire tags become valid identifiers in both languages.
    expect(artifacts.swift).toContain('case turnStart = "turn/start"')
    expect(artifacts.swift).toContain('case chunkrowTextChunks = "chunkrow/text-chunks"')
    expect(artifacts.kotlin).toContain('TURN_START("turn/start")')
    expect(artifacts.kotlin).toContain('CHUNKROW_TEXT_CHUNKS("chunkrow/text-chunks")')
    // Arrays and enum references carry their element types.
    expect(artifacts.swift).toContain('public let todos: [LinkTodoItem]')
    expect(artifacts.swift).toContain('public let status: LinkTodoStatus')
    expect(artifacts.kotlin).toContain('val dt: List<Double>')
    expect(artifacts.kotlin).toContain('val texts: List<String>')
    expect(artifacts.swift).not.toContain('undefined')
    expect(artifacts.kotlin).not.toContain('undefined')
  })

  it('rejects broken references and unlisted vocabulary tags', () => {
    const vocabulary = LINK_CONTRACT_TYPES.filter(type => type.name === 'LinkSessionEventKind' || type.name === 'LinkChunkRowKind')
    const todoItem = LINK_CONTRACT_TYPES.find(type => type.name === 'LinkTodoItem')!
    const brokenRef = [...vocabulary, { ...todoItem, fields: [
      { name: 'status', kind: 'enum' as const, ref: 'LinkNoSuchEnum' },
    ] }]
    expect(() => generateLinkContracts(brokenRef)).toThrow(/references unknown type/u)
    const shapeConfused = [
      ...vocabulary,
      LINK_CONTRACT_TYPES.find(type => type.name === 'LinkGoalBlockReason')!,
      { ...todoItem, fields: [{ name: 'status', kind: 'enum' as const, ref: 'LinkGoalBlockReason' }] },
    ]
    expect(() => generateLinkContracts(shapeConfused)).toThrow(/as an enum/u)
    const alienEvent = [
      ...LINK_CONTRACT_TYPES.filter(type => type.name !== 'LinkPlanModeData'),
      { ...LINK_CONTRACT_TYPES.find(type => type.name === 'LinkPlanModeData')!, sessionEvents: ['plan/exited'] },
    ]
    expect(() => generateLinkContracts(alienEvent)).toThrow(/unknown session event/u)
    expect(() => generateLinkContracts(LINK_CONTRACT_TYPES.filter(type => type.name !== 'LinkSessionEventKind')))
      .toThrow(/LinkSessionEventKind and LinkChunkRowKind/u)
  })
})

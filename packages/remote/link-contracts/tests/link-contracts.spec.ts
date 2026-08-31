/** Contract behavior: fixture round-trips, table coverage, emitted artifacts, domain-state fold. */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LINK_CONTRACT_FIXTURES, LINK_CONTRACT_TYPES, LINK_DOMAIN_SCENARIOS,
  LinkAdminStatusSchema, LinkDeviceRecordSchema, LinkPairingPayloadSchema,
  LITE_SCENARIOS, emptyCompanionDomain, foldCompanionDomain, foldLiteDomain,
} from '../src/index.ts'
import { generateLinkContracts } from '../src/generate.ts'
import { generateConformanceArtifacts } from '../src/companion-scenarios.ts'
import { generateLiteConformance } from '../src/lite-spec.ts'

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

describe('companion domain-state fold', () => {
  it('derives the expected state from every golden scenario', () => {
    const byId = new Map(LINK_DOMAIN_SCENARIOS.map(scenario => [scenario.id, foldCompanionDomain(scenario.records)]))

    const basic = byId.get('basic-turn')!
    expect(basic.cursor).toBe(7)
    expect(basic.items.map(item => item.text)).toEqual([
      '第 1 轮开始',
      '帮我把登录页改成液态玻璃风格',
      '',
      '你好，构建',
      '已完成：登录页液态玻璃样式落地。',
      '',
      '第 1 轮完成',
    ])
    expect(basic.planActive).toBe(false)
    expect(basic.toolCalls).toEqual([])

    const pane = byId.get('plan-todo-goal')!
    expect(pane.planActive).toBe(false)
    expect(pane.todos).toEqual([
      { text: '编译伴侣应用', status: 'completed' },
      { text: '跑契约回放测试', status: 'in_progress' },
    ])
    expect(pane.goals).toEqual([])

    const tools = byId.get('tool-trajectory')!
    expect(tools.toolCalls.map(call => [call.id, call.phase])).toEqual([
      ['call-1', 'completed'],
      ['call-2', 'failed'],
      ['call-3', 'running'],
    ])
    expect(tools.toolCalls[0]!.resultText).toBe('已写入 42 行。')
    expect(tools.toolCalls[1]!.resultText).toBe('2 个断言失败')

    const artifacts = byId.get('artifacts')!
    expect(artifacts.artifacts).toEqual([
      { id: 'art-report-1', kind: 'report', title: '迁移报告', status: 'failed' },
      { id: 'art-draft-2', kind: 'markdown', title: '发布说明草稿', status: 'pending' },
      { id: 'art-report-1', kind: 'report', title: '迁移报告', status: 'pending' },
    ])
  })

  it('emits one artifact per scenario whose expected value matches the fold', () => {
    const artifacts = generateConformanceArtifacts()
    expect(artifacts.map(artifact => artifact.id)).toEqual(LINK_DOMAIN_SCENARIOS.map(scenario => scenario.id))
    for (const artifact of artifacts) {
      expect(artifact.json.endsWith('\n')).toBe(true)
      const parsed = JSON.parse(artifact.json) as { records: unknown[]; expected: unknown }
      const scenario = LINK_DOMAIN_SCENARIOS.find(candidate => candidate.id === artifact.id)!
      expect(parsed.records).toEqual(scenario.records)
      expect(parsed.expected).toEqual(foldCompanionDomain(scenario.records))
    }
  })

  it('tolerates an unknown event tag as a marker row', () => {
    const state = foldCompanionDomain([
      { type: 'event', event: { type: 'future/event', seq: 9, data: { any: 'thing' } } },
    ])
    expect(state.items).toEqual([{ seq: 9, kind: 'future/event', text: '' }])
    expect(state.cursor).toBe(9)
  })

  it('folds artifact references and status updates by the Lite vocabulary', () => {
    const state = foldCompanionDomain([
      { type: 'event', event: { type: 'artifact/created', seq: 1, data: { id: 'a1', kind: 'markdown', title: '报告.md' } } },
      { type: 'event', event: { type: 'artifact/created', seq: 2, data: { id: 'a2', kind: 'image', title: '截图.png' } } },
      { type: 'event', event: { type: 'artifact/status', seq: 3, data: { id: 'a1', status: 'ready' } } },
      // A status for a reference that never arrived is a no-op.
      { type: 'event', event: { type: 'artifact/status', seq: 4, data: { id: 'ghost', status: 'failed' } } },
      { type: 'event', event: { type: 'artifact/status', seq: 5, data: { id: 'a2', status: 'failed' } } },
      // Malformed payloads are absent referents: no row, no pane change.
      { type: 'event', event: { type: 'artifact/created', seq: 6, data: { id: 3, kind: 'markdown', title: '数值 id' } } },
      { type: 'event', event: { type: 'artifact/created', seq: 7, data: 'not an object' } },
      { type: 'event', event: { type: 'artifact/status', seq: 8, data: { id: 'a1', status: 'weird' } } },
      // A repeated created pushes again, mirroring the Lite fold.
      { type: 'event', event: { type: 'artifact/created', seq: 9, data: { id: 'a1', kind: 'markdown', title: '报告.md' } } },
    ])
    expect(state.artifacts).toEqual([
      { id: 'a1', kind: 'markdown', title: '报告.md', status: 'ready' },
      { id: 'a2', kind: 'image', title: '截图.png', status: 'failed' },
      { id: 'a1', kind: 'markdown', title: '报告.md', status: 'pending' },
    ])
    expect(state.items.map(item => item.text)).toEqual([
      '新建工件 报告.md（markdown）',
      '新建工件 截图.png（image）',
      '工件 a1：就绪',
      '工件 ghost：失败',
      '工件 a2：失败',
      '',
      '',
      '',
      '新建工件 报告.md（markdown）',
    ])
  })

  it('starts every fold with an empty artifacts pane', () => {
    expect(emptyCompanionDomain().artifacts).toEqual([])
  })
})

describe('lite behavior spec', () => {
  it('covers every chapter-63 verification point', () => {
    const covered = new Set(LITE_SCENARIOS.flatMap(scenario => scenario.covers))
    expect([...covered].sort()).toEqual([
      'Artifact', 'Cancel', 'Handoff Request', 'Network Error', 'Plan', 'Prompt',
      'Provider Error', 'Streaming', 'Todo', 'Tool Call', 'Tool Result',
    ])
  })

  it('derives the expected state from every golden scenario', () => {
    const byId = new Map(LITE_SCENARIOS.map(scenario => [scenario.id, foldLiteDomain(scenario.events)]))

    const streamed = byId.get('prompt-and-streaming')!
    expect(streamed.conversation).toEqual([
      { role: 'user', text: '总结这份报告' },
      { role: 'assistant', text: '报告要点共三项。' },
    ])
    expect(streamed.streaming.active).toBe(false)
    expect(streamed.lastTurnEnd).toBe('completed')
    expect(streamed.errors).toEqual([])

    const cancelled = byId.get('cancel-preserves-prefix')!
    expect(cancelled.conversation[1]).toEqual({ role: 'assistant', text: '第一步：拆分视图。', interrupted: true })
    expect(cancelled.interrupted).toBe(true)
    expect(cancelled.lastTurnEnd).toBe('cancelled')

    const tools = byId.get('tool-call-and-result')!
    expect(tools.toolCalls.map(call => [call.id, call.phase])).toEqual([
      ['c1', 'completed'],
      ['c2', 'failed'],
    ])

    const tracked = byId.get('plan-todo-artifact')!
    expect(tracked.planActive).toBe(true)
    expect(tracked.todos.map(todo => todo.status)).toEqual(['completed', 'in_progress'])
    expect(tracked.artifacts).toEqual([
      { id: 'a1', kind: 'markdown', title: 'lite-behavior-spec.md', status: 'ready' },
    ])

    const failures = byId.get('provider-and-network-errors')!
    expect(failures.errors.map(error => [error.kind, error.code])).toEqual([
      ['network', 'dropped'],
      ['provider', 'RATE_LIMITED'],
      ['provider', 'PROMPT_REJECTED'],
    ])
    expect(failures.lastTurnEnd).toBe('provider-error')

    const handoff = byId.get('handoff-request')!
    expect(handoff.pendingHandoff).toBe('requiresFullRuntime')
    expect(handoff.toolCalls[0]!.phase).toBe('running')
  })

  it('emits one artifact per scenario whose expected value matches the fold', () => {
    for (const artifact of generateLiteConformance()) {
      const parsed = JSON.parse(artifact.json) as { events: unknown[]; expected: unknown }
      const scenario = LITE_SCENARIOS.find(candidate => candidate.id === artifact.id)!
      expect(parsed.events).toEqual(scenario.events)
      expect(parsed.expected).toEqual(foldLiteDomain(scenario.events))
    }
  })
})

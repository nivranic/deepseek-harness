/**
 * Golden domain-state conformance scenarios: ordered follow records plus
 * the reference fold's expected companion state, emitted as fixture JSON by
 * the generator and replayed by every native runtime's fold (plan chapter
 * 62 — the same fixture must produce the same domain state in TypeScript,
 * Swift, and Kotlin).
 * @module @deepseek-ai/dsh-link-contracts
 */

import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import { foldCompanionDomain, type CompanionDomainState, type CompanionRecord } from './companion-fold.ts'

/** One golden scenario: its ordered records and the id the artifacts carry. */
export interface CompanionScenario {
  readonly id: string
  readonly records: readonly CompanionRecord[]
}

function event<K extends keyof SessionEventMap>(seq: number, type: K, data: SessionEventMap[K]): CompanionRecord {
  return { type: 'event', event: { type, seq, time: 1_759_017_600_000 + seq, data } }
}

function chunks(seq: number, tag: 'chunkrow/text-chunks' | 'chunkrow/reasoning-chunks', data: Extract<ChunkRow, { type: 'text-chunks' }>['data']): CompanionRecord {
  return { type: 'chunks', event: { type: tag, seq, time: 1_759_017_600_000 + seq, data } }
}

/** The golden scenarios; ids name the emitted `conformance/<id>.json` artifacts. */
export const LINK_DOMAIN_SCENARIOS: readonly CompanionScenario[] = [
  {
    id: 'basic-turn',
    records: [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'user/message', {
        id: MessageId('m-user-1'),
        role: 'user',
        content: [{ type: 'text', text: '帮我把登录页改成液态玻璃风格' }],
        source: { kind: 'user' },
      }),
      event(3, 'step/start', { turn: 1, step: 1 }),
      chunks(4, 'chunkrow/text-chunks', { turn: 1, step: 1, index: 0, dt: [4, 6], texts: ['你好', '，构建'] }),
      event(5, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: MessageId('m-assist-1'),
          role: 'assistant',
          content: [{ type: 'text', text: '已完成：登录页液态玻璃样式落地。' }],
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
        },
        usage: { inputTokens: 120, outputTokens: 36, totalTokens: 156 },
      }),
      event(6, 'step/end', { turn: 1, step: 1 }),
      event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ],
  },
  {
    id: 'plan-todo-goal',
    records: [
      event(1, 'plan/mode', { active: true }),
      event(2, 'todo/write', {
        todos: [
          { content: '编译伴侣应用', status: 'in_progress' },
          { content: '跑契约回放测试', status: 'pending' },
        ],
      }),
      event(3, 'goal/change', {
        kind: 'goal/change',
        version: 1,
        operation: 'create',
        // The brand constructor sits behind the heavy goal package root; a
        // local literal keeps this scenario free of that runtime edge.
        goal: { id: 'goal-1' as GoalId, revision: 1, objective: '发布 0.2 伴侣版', phase: 'active', maxGoalRounds: 12 },
        roundsStarted: 0,
        createdAt: 1_759_017_600_000,
        updatedAt: 1_759_017_600_000,
      }),
      event(4, 'todo/write', {
        todos: [
          { content: '编译伴侣应用', status: 'completed' },
          { content: '跑契约回放测试', status: 'in_progress' },
        ],
      }),
      event(5, 'plan/mode', { active: false }),
      event(6, 'goal/change', {
        kind: 'goal/change',
        version: 1,
        operation: 'clear',
        cleared: { id: 'goal-1' as GoalId, revision: 2 },
        clearedAt: 1_759_017_700_000,
      }),
    ],
  },
  {
    id: 'tool-trajectory',
    records: [
      event(1, 'tool/call', { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'write_file', arguments: '{"path":"Login.swift"}' }),
      event(2, 'tool/call', { turn: 1, step: 1, callId: ToolCallId('call-2'), name: 'run_tests', arguments: '{}' }),
      event(3, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: MessageId('m-tool-1'),
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: ToolCallId('call-1'),
            content: [{ type: 'text', text: '已写入 42 行。' }],
          }],
          source: { kind: 'tool', callId: ToolCallId('call-1') },
        },
      }),
      event(4, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: MessageId('m-tool-x'),
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: ToolCallId('call-x'),
            content: [{ type: 'text', text: '孤儿结果' }],
          }],
          source: { kind: 'tool', callId: ToolCallId('call-x') },
        },
      }),
      event(5, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: MessageId('m-tool-2'),
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: ToolCallId('call-2'),
            content: [{ type: 'text', text: '2 个断言失败' }],
          }],
          source: { kind: 'tool', callId: ToolCallId('call-2') },
        },
        error: { name: 'AssertionError', code: 'EXIT_1' },
      }),
      event(6, 'tool/call', { turn: 2, step: 1, callId: ToolCallId('call-3'), name: 'web_search', arguments: '{"query":"swift observation"}' }),
    ],
  },
]

/** One emitted conformance artifact: the scenario bytes under its id. */
export interface ConformanceArtifact {
  readonly id: string
  /** The exact JSON text the drift gate compares, ending in one newline. */
  readonly json: string
}

/**
 * Emit every scenario's fixture: the records plus the reference fold's
 * expected domain state, so a native replay compares against the TypeScript
 * result byte-for-byte.
 * @param scenarios - the golden scenarios; defaults to the exported set.
 * @returns one artifact per scenario.
 */
export function generateConformanceArtifacts(
  scenarios: readonly CompanionScenario[] = LINK_DOMAIN_SCENARIOS,
): ConformanceArtifact[] {
  return scenarios.map((scenario) => {
    const value: { records: readonly CompanionRecord[]; expected: CompanionDomainState } = {
      records: scenario.records,
      expected: foldCompanionDomain(scenario.records),
    }
    return { id: scenario.id, json: `${JSON.stringify(value, undefined, 2)}\n` }
  })
}

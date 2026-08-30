/**
 * The cross-language companion domain-state fold: the reference projection
 * every native runtime (Swift today, Kotlin later) must reproduce over the
 * same follow records. One scenario is one golden record sequence plus the
 * domain state the reference fold derives from it; the generator emits both
 * as fixture JSON, so a native replay can be compared byte-for-byte against
 * the TypeScript result — plan chapter 62's "same fixture, same domain
 * state" contract.
 * @module @deepseek-ai/dsh-link-contracts
 */

import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
// Type-only edges that pull each plugin's `SessionEventMap` merge into this
// program, so the fold's payload reads see the merged vocabulary.
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-tool-todo/types'

/** Lifecycle of one tool invocation in the folded trajectory. */
export type CompanionToolPhase = 'running' | 'completed' | 'failed'

/** One folded tool invocation, paired across the wire by `callId`. */
export interface CompanionToolCall {
  readonly id: string
  readonly seq: number
  readonly name: string
  readonly arguments: string
  readonly phase: CompanionToolPhase
  readonly resultText: string
}

/** One folded timeline row: the record tag plus its rendered summary. */
export interface CompanionItem {
  readonly seq: number
  readonly kind: string
  readonly text: string
}

/** One folded todo row; the wire status rides verbatim. */
export interface CompanionTodo {
  readonly text: string
  readonly status: string
}

/** One folded goal row; the wire phase rides verbatim. */
export interface CompanionGoal {
  readonly id: string
  readonly title: string
  readonly state: string
}

/**
 * The complete companion-visible state of one session log cut: timeline
 * rows, plan mode, the whole todo list, the current goal (empty after a
 * clear), and the paired tool trajectory.
 */
export interface CompanionDomainState {
  readonly cursor: number
  readonly items: readonly CompanionItem[]
  readonly planActive: boolean
  readonly todos: readonly CompanionTodo[]
  readonly goals: readonly CompanionGoal[]
  readonly toolCalls: readonly CompanionToolCall[]
}

/** The empty state before any record arrives. */
export function emptyCompanionDomain(): CompanionDomainState {
  return { cursor: 0, items: [], planActive: false, todos: [], goals: [], toolCalls: [] }
}

/**
 * The one follow record the fold consumes, shaped exactly as the wire
 * carries it: an event entry or a packed chunk row under its `event` field.
 * Payloads stay JSON-typed because golden scenarios and native replay share
 * the bytes; the fold narrows each known tag to its real payload type.
 */
export interface CompanionRecord {
  readonly type: string
  readonly event: {
    readonly type: string
    readonly seq: number
    readonly time?: number
    readonly data?: unknown
  }
}

/** The content-block fields the fold reads: text directly, tool results one level deeper. */
type TextualBlock = { readonly type?: string; text?: string; content?: unknown }

/** Visible text of a content-block list: text blocks carry it directly, tool-result blocks nest it. */
function blockText(blocks: ReadonlyArray<TextualBlock>): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block.text === 'string' && block.text !== '') parts.push(block.text)
    else if (Array.isArray(block.content)) parts.push(blockText(block.content as ReadonlyArray<TextualBlock>))
  }
  return parts.join('\n')
}

/** The turn-end summary line both languages render identically. */
function turnEndSummary(turn: number, reasonKind: string): string {
  switch (reasonKind) {
    case 'completed': return `第 ${turn} 轮完成`
    case 'aborted': return `第 ${turn} 轮已中止`
    case 'blocked': return `第 ${turn} 轮被阻断`
    case 'error': return `第 ${turn} 轮出错`
    case 'max-tokens': return `第 ${turn} 轮达到输出上限`
    case 'interrupted': return `第 ${turn} 轮因中断收尾`
    default: return ''
  }
}

/** The per-tag summary both languages render identically; unknown tags stay marker rows. */
function renderEvent(tag: string, record: CompanionRecord): string {
  const data = record.event.data
  switch (tag) {
    case 'turn/start':
      return `第 ${(data as SessionEventMap['turn/start']).turn} 轮开始`
    case 'turn/end': {
      const payload = data as SessionEventMap['turn/end']
      return turnEndSummary(payload.turn, payload.reason.kind)
    }
    case 'step/start':
    case 'step/end':
    case 'session/end-seed':
      return ''
    case 'user/message':
      return blockText((data as SessionEventMap['user/message']).content)
    case 'assistant/chunk': {
      const chunk = (data as SessionEventMap['assistant/chunk']).chunk
      return 'text' in chunk && typeof chunk.text === 'string' ? chunk.text : ''
    }
    case 'assistant/message': {
      const payload = data as SessionEventMap['assistant/message']
      const base = blockText(payload.message.content)
      return payload.interrupted === true && base !== '' ? `${base}（已中断）` : base
    }
    case 'tool/call':
      return `调用工具 ${(data as SessionEventMap['tool/call']).name}`
    case 'tool/result': {
      const payload = data as SessionEventMap['tool/result']
      if (payload.error !== undefined) return `工具失败：${payload.error.name}`
      return blockText(payload.message.content)
    }
    case 'plan/mode':
      return (data as SessionEventMap['plan/mode']).active ? '进入计划模式' : '退出计划模式'
    case 'todo/write': {
      const todos = (data as SessionEventMap['todo/write']).todos
      return `更新待办（${todos.length} 项）`
    }
    case 'goal/change': {
      const payload = data as SessionEventMap['goal/change']
      if ('goal' in payload) return `目标：${payload.goal.objective}`
      return '目标已清除'
    }
    case 'chunkrow/text-chunks':
    case 'chunkrow/reasoning-chunks': {
      const payload = data as Extract<ChunkRow, { type: 'text-chunks' }>['data']
      return payload.texts.join('')
    }
    case 'chunkrow/tool-call-chunks':
      return ''
    default:
      return ''
  }
}

/** Mutable accumulator shape shared by the fold entry points. */
interface CompanionFoldState {
  cursor: number
  items: CompanionItem[]
  planActive: boolean
  todos: CompanionTodo[]
  goals: CompanionGoal[]
  toolCalls: CompanionToolCall[]
}

/**
 * Fold one follow record into the companion domain state. Whole-value pane
 * states are last-write-wins; the trajectory pairs calls with results by
 * `callId` and tolerates orphan results as no-ops.
 * @param state - the mutable accumulator, mutated in place.
 * @param record - one wire record (event entry or packed chunk row).
 */
export function foldCompanionRecord(state: CompanionFoldState, record: CompanionRecord): void {
  const tag = record.event.type
  const seq = record.event.seq
  const data = record.event.data
  state.cursor = Math.max(state.cursor, seq)
  state.items.push({ seq, kind: tag, text: renderEvent(tag, record) })
  switch (tag) {
    case 'plan/mode':
      state.planActive = (data as SessionEventMap['plan/mode']).active
      break
    case 'todo/write':
      state.todos = (data as SessionEventMap['todo/write']).todos
        .map(todo => ({ text: todo.content, status: todo.status }))
      break
    case 'goal/change': {
      const payload = data as SessionEventMap['goal/change']
      state.goals = 'goal' in payload
        ? [{ id: payload.goal.id, title: payload.goal.objective, state: payload.goal.phase }]
        : []
      break
    }
    case 'tool/call': {
      const payload = data as SessionEventMap['tool/call']
      state.toolCalls.push({
        id: payload.callId,
        seq,
        name: payload.name,
        arguments: payload.arguments,
        phase: 'running',
        resultText: '',
      })
      break
    }
    case 'tool/result': {
      const payload = data as SessionEventMap['tool/result']
      const callId = (payload.message.content as ReadonlyArray<{ toolCallId?: string }>)[0]?.toolCallId
      const index = callId === undefined ? -1 : state.toolCalls.findIndex(call => call.id === callId)
      const target = index === -1 ? undefined : state.toolCalls[index]
      if (target === undefined) break
      state.toolCalls[index] = {
        ...target,
        phase: payload.error === undefined ? 'completed' : 'failed',
        resultText: blockText(payload.message.content),
      }
      break
    }
    default:
      break
  }
}

/**
 * Fold a complete record sequence into the domain state the generator
 * emits as each scenario's expected value.
 * @param records - ordered follow records (snapshot records then live events).
 * @returns the derived domain state.
 */
export function foldCompanionDomain(records: readonly CompanionRecord[]): CompanionDomainState {
  const state: CompanionFoldState = {
    cursor: 0,
    items: [],
    planActive: false,
    todos: [],
    goals: [],
    toolCalls: [],
  }
  for (const record of records) foldCompanionRecord(state, record)
  return state
}

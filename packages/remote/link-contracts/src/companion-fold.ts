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

/**
 * One durable image reference collected from message content, ordered by
 * first appearance and deduplicated by attachment id.
 */
export interface CompanionImageRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly width: number
  readonly height: number
  readonly name?: string
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

/** Lifecycle of one artifact reference on the wire (the Lite vocabulary). */
export type CompanionArtifactStatus = 'pending' | 'ready' | 'failed'

/**
 * One artifact reference the fold collected — metadata and status only;
 * content rides the resource channel, never the journal (chapter 56).
 */
export interface CompanionArtifact {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly status: CompanionArtifactStatus
}

/** The `artifact/created` payload shape the fold narrows to. */
interface ArtifactCreatedData {
  readonly id: string
  readonly kind: string
  readonly title: string
}

/** The `artifact/status` payload shape the fold narrows to. */
interface ArtifactStatusData {
  readonly id: string
  readonly status: CompanionArtifactStatus
}

/** Narrow one created payload; a non-object record or any non-string
 * id/kind/title field makes the reference an absent referent. */
function artifactCreated(data: unknown): ArtifactCreatedData | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.kind !== 'string' || typeof record.title !== 'string') return undefined
  return { id: record.id, kind: record.kind, title: record.title }
}

/** Narrow one status payload; the status must be one of the three wire
 * values or the update is an absent referent. */
function artifactStatus(data: unknown): ArtifactStatusData | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (typeof record.id !== 'string') return undefined
  if (record.status !== 'pending' && record.status !== 'ready' && record.status !== 'failed') return undefined
  return { id: record.id, status: record.status }
}

/** The artifact-status summary word both languages render identically. */
function artifactStatusLabel(status: CompanionArtifactStatus): string {
  switch (status) {
    case 'pending': return '待定'
    case 'ready': return '就绪'
    case 'failed': return '失败'
  }
}

/**
 * The complete companion-visible state of one session log cut: timeline
 * rows, plan mode, the whole todo list, the current goal (empty after a
 * clear), the paired tool trajectory, and the artifact references the log
 * carries (empty until the host journals artifact events).
 */
export interface CompanionDomainState {
  readonly cursor: number
  readonly items: readonly CompanionItem[]
  readonly planActive: boolean
  readonly todos: readonly CompanionTodo[]
  readonly goals: readonly CompanionGoal[]
  readonly toolCalls: readonly CompanionToolCall[]
  readonly images: readonly CompanionImageRef[]
  readonly artifacts: readonly CompanionArtifact[]
}

/** The empty state before any record arrives. */
export function emptyCompanionDomain(): CompanionDomainState {
  return { cursor: 0, items: [], planActive: false, todos: [], goals: [], toolCalls: [], images: [], artifacts: [] }
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

/** The content-block fields the fold reads: text directly, images by their
 * durable reference metadata, tool results one level deeper. */
interface TextualBlock {
  readonly type?: string
  text?: string
  content?: unknown
  attachment?: {
    attachmentId?: unknown
    mediaType?: unknown
    width?: unknown
    height?: unknown
    name?: unknown
  }
}

/** One image reference rendered as the summary line both languages share. */
function imageSummary(ref: NonNullable<TextualBlock['attachment']>): string {
  const mediaType = typeof ref.mediaType === 'string' ? ref.mediaType : ''
  const width = typeof ref.width === 'number' ? ref.width : 0
  const height = typeof ref.height === 'number' ? ref.height : 0
  const name = typeof ref.name === 'string' && ref.name !== '' ? ` ${ref.name}` : ''
  return `图片${name}（${mediaType}，${width}×${height}）`
}

/** Collect image references from a content-block list, nesting like
 * `blockText` and skipping ids already collected. */
function collectImages(blocks: ReadonlyArray<TextualBlock>, into: CompanionImageRef[]): void {
  for (const block of blocks) {
    const ref = block.type === 'image' ? block.attachment : undefined
    if (ref !== undefined && typeof ref.attachmentId === 'string'
      && !into.some(existing => existing.attachmentId === ref.attachmentId)) {
      into.push({
        attachmentId: ref.attachmentId,
        mediaType: typeof ref.mediaType === 'string' ? ref.mediaType : '',
        width: typeof ref.width === 'number' ? ref.width : 0,
        height: typeof ref.height === 'number' ? ref.height : 0,
        ...(typeof ref.name === 'string' && ref.name !== '' ? { name: ref.name } : {}),
      })
    } else if (Array.isArray(block.content)) {
      collectImages(block.content as ReadonlyArray<TextualBlock>, into)
    }
  }
}

/** Visible text of a content-block list: text blocks carry it directly, image
 * blocks render their reference metadata, tool-result blocks nest it. */
function blockText(blocks: ReadonlyArray<TextualBlock>): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block.text === 'string' && block.text !== '') parts.push(block.text)
    else if (block.type === 'image' && block.attachment !== undefined) parts.push(imageSummary(block.attachment))
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
    case 'artifact/created': {
      const payload = artifactCreated(record.event.data)
      return payload === undefined ? '' : `新建工件 ${payload.title}（${payload.kind}）`
    }
    case 'artifact/status': {
      const payload = artifactStatus(record.event.data)
      return payload === undefined ? '' : `工件 ${payload.id}：${artifactStatusLabel(payload.status)}`
    }
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
  images: CompanionImageRef[]
  artifacts: CompanionArtifact[]
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
    case 'user/message':
      collectImages((data as SessionEventMap['user/message']).content, state.images)
      break
    case 'assistant/message':
      collectImages((data as SessionEventMap['assistant/message']).message.content, state.images)
      break
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
      collectImages(payload.message.content, state.images)
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
    case 'artifact/created': {
      const payload = artifactCreated(data)
      if (payload === undefined) break
      state.artifacts.push({ id: payload.id, kind: payload.kind, title: payload.title, status: 'pending' })
      break
    }
    case 'artifact/status': {
      const payload = artifactStatus(data)
      if (payload === undefined) break
      const index = state.artifacts.findIndex(artifact => artifact.id === payload.id)
      const target = index === -1 ? undefined : state.artifacts[index]
      if (target === undefined) break
      state.artifacts[index] = { ...target, status: payload.status }
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
    images: [],
    artifacts: [],
  }
  for (const record of records) foldCompanionRecord(state, record)
  return state
}

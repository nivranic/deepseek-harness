/**
 * The Lite Behavior Spec (nativization plan chapters 33/34/63): the
 * observable lifecycle vocabulary of an on-device Native Harness Lite
 * runtime and the reference fold into its domain state. One golden scenario
 * per chapter-63 verification point — prompt, streaming, cancel, tool call,
 * tool result, plan, todo, artifact, provider error, network error, handoff
 * — pairs its event sequence with the state the TypeScript reference
 * derives, emitted as fixture JSON a native Lite runtime replays and must
 * fold identically. Behavior compatible, never implementation identical.
 * @module @deepseek-ai/dsh-link-contracts
 */

/** Why a Lite turn ended. */
export type LiteTurnEnd = 'completed' | 'cancelled' | 'provider-error' | 'network-error'

/** One completed conversation row. */
export interface LiteMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** A cancelled stream's delivered prefix, finalized by the cancel. */
  readonly interrupted?: true
}

/** One tool invocation, paired by id. */
export interface LiteToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
  readonly phase: 'running' | 'completed' | 'failed'
  readonly resultText: string
}

/** One artifact reference — metadata only; content never rides the spec (chapter 56). */
export interface LiteArtifact {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly status: 'pending' | 'ready' | 'failed'
}

/** One recorded failure. */
export interface LiteFailure {
  readonly kind: 'provider' | 'network'
  readonly code: string
  readonly message: string
}

/** The complete Lite-visible runtime state at one event cut. */
export interface LiteDomainState {
  readonly conversation: readonly LiteMessage[]
  readonly streaming: { readonly active: boolean; readonly partialText: string; readonly partialReasoning: string }
  readonly interrupted: boolean
  readonly toolCalls: readonly LiteToolCall[]
  readonly planActive: boolean
  readonly todos: readonly { readonly content: string; readonly status: string }[]
  readonly artifacts: readonly LiteArtifact[]
  readonly lastTurnEnd: LiteTurnEnd | null
  readonly errors: readonly LiteFailure[]
  readonly pendingHandoff: string | null
}

/** The Lite lifecycle event vocabulary (chapter 34's P0 surface). */
export type LiteEvent =
  | { readonly type: 'prompt/accepted'; readonly requestId: string; readonly content: string }
  | { readonly type: 'prompt/rejected'; readonly requestId: string; readonly reason: string }
  | { readonly type: 'stream/delta'; readonly text: string }
  | { readonly type: 'stream/reasoning'; readonly text: string }
  | { readonly type: 'message/completed'; readonly text: string; readonly usage?: { readonly inputTokens: number; readonly outputTokens: number } }
  | { readonly type: 'turn/completed' }
  | { readonly type: 'turn/cancelled'; readonly reason: string }
  | { readonly type: 'tool/call'; readonly id: string; readonly name: string; readonly arguments: string }
  | { readonly type: 'tool/result'; readonly id: string; readonly ok: boolean; readonly text: string }
  | { readonly type: 'plan/changed'; readonly active: boolean }
  | { readonly type: 'todo/changed'; readonly todos: ReadonlyArray<{ readonly content: string; readonly status: string }> }
  | { readonly type: 'artifact/created'; readonly id: string; readonly kind: string; readonly title: string }
  | { readonly type: 'artifact/status'; readonly id: string; readonly status: 'pending' | 'ready' | 'failed' }
  | { readonly type: 'provider/error'; readonly code: string; readonly message: string }
  | { readonly type: 'network/error'; readonly kind: 'timeout' | 'unreachable' | 'dropped' }
  | { readonly type: 'handoff/requested'; readonly capability: string }

/** Mutable accumulator shared by the fold entry points. */
interface LiteFoldState {
  conversation: LiteMessage[]
  streaming: { active: boolean; partialText: string; partialReasoning: string }
  interrupted: boolean
  toolCalls: LiteToolCall[]
  planActive: boolean
  todos: { content: string; status: string }[]
  artifacts: LiteArtifact[]
  lastTurnEnd: LiteTurnEnd | null
  errors: LiteFailure[]
  pendingHandoff: string | null
}

/** The state before any event arrives. */
export function emptyLiteDomain(): LiteDomainState {
  return {
    conversation: [],
    streaming: { active: false, partialText: '', partialReasoning: '' },
    interrupted: false,
    toolCalls: [],
    planActive: false,
    todos: [],
    artifacts: [],
    lastTurnEnd: null,
    errors: [],
    pendingHandoff: null,
  }
}

/**
 * Fold one Lite lifecycle event into the runtime state. Whole-value states
 * are last-write-wins; tool invocations pair by id; a cancel finalizes the
 * delivered stream prefix as an interrupted assistant row.
 * @param state - the mutable accumulator, mutated in place.
 * @param event - one Lite lifecycle event.
 */
export function foldLiteEvent(state: LiteFoldState, event: LiteEvent): void {
  switch (event.type) {
    case 'prompt/accepted':
      state.conversation.push({ role: 'user', text: event.content })
      break
    case 'prompt/rejected':
      state.errors.push({ kind: 'provider', code: 'PROMPT_REJECTED', message: event.reason })
      break
    case 'stream/delta':
      state.streaming.active = true
      state.streaming.partialText += event.text
      break
    case 'stream/reasoning':
      state.streaming.active = true
      state.streaming.partialReasoning += event.text
      break
    case 'message/completed':
      state.conversation.push({ role: 'assistant', text: event.text })
      state.streaming = { active: false, partialText: '', partialReasoning: '' }
      break
    case 'turn/completed':
      state.lastTurnEnd = 'completed'
      break
    case 'turn/cancelled':
      if (state.streaming.active && state.streaming.partialText !== '') {
        state.conversation.push({ role: 'assistant', text: state.streaming.partialText, interrupted: true })
        state.interrupted = true
      }
      state.streaming = { active: false, partialText: '', partialReasoning: '' }
      state.lastTurnEnd = 'cancelled'
      break
    case 'tool/call':
      state.toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments, phase: 'running', resultText: '' })
      break
    case 'tool/result': {
      const index = state.toolCalls.findIndex(call => call.id === event.id)
      const target = index === -1 ? undefined : state.toolCalls[index]
      if (target === undefined) break
      state.toolCalls[index] = {
        ...target,
        phase: event.ok ? 'completed' : 'failed',
        resultText: event.text,
      }
      break
    }
    case 'plan/changed':
      state.planActive = event.active
      break
    case 'todo/changed':
      state.todos = event.todos.map(todo => ({ content: todo.content, status: todo.status }))
      break
    case 'artifact/created':
      state.artifacts.push({ id: event.id, kind: event.kind, title: event.title, status: 'pending' })
      break
    case 'artifact/status': {
      const index = state.artifacts.findIndex(artifact => artifact.id === event.id)
      const target = index === -1 ? undefined : state.artifacts[index]
      if (target === undefined) break
      state.artifacts[index] = { ...target, status: event.status }
      break
    }
    case 'provider/error':
      state.errors.push({ kind: 'provider', code: event.code, message: event.message })
      state.streaming = { active: false, partialText: '', partialReasoning: '' }
      state.lastTurnEnd = 'provider-error'
      break
    case 'network/error':
      // A dropped transport keeps the delivered prefix for resume; the
      // stream is no longer live.
      state.streaming.active = false
      state.errors.push({ kind: 'network', code: event.kind, message: event.kind })
      state.lastTurnEnd = 'network-error'
      break
    case 'handoff/requested':
      state.pendingHandoff = event.capability
      break
  }
}

/**
 * Fold a complete Lite event sequence into the state the generator emits
 * as each scenario's expected value.
 * @param events - ordered Lite lifecycle events.
 * @returns the derived Lite domain state.
 */
export function foldLiteDomain(events: readonly LiteEvent[]): LiteDomainState {
  const state: LiteFoldState = {
    conversation: [], streaming: { active: false, partialText: '', partialReasoning: '' },
    interrupted: false, toolCalls: [], planActive: false, todos: [], artifacts: [],
    lastTurnEnd: null, errors: [], pendingHandoff: null,
  }
  for (const event of events) foldLiteEvent(state, event)
  return state
}

/** One golden Lite scenario: its ordered events and the artifact id. */
export interface LiteScenario {
  readonly id: string
  /** The chapter-63 verification points this scenario covers. */
  readonly covers: readonly string[]
  readonly events: readonly LiteEvent[]
}

/** The golden Lite scenarios; ids name the emitted `lite-conformance/<id>.json` artifacts. */
export const LITE_SCENARIOS: readonly LiteScenario[] = [
  {
    id: 'prompt-and-streaming',
    covers: ['Prompt', 'Streaming'],
    events: [
      { type: 'prompt/accepted', requestId: 'r1', content: '总结这份报告' },
      { type: 'stream/reasoning', text: '先找要点…' },
      { type: 'stream/delta', text: '报告要点' },
      { type: 'stream/delta', text: '共三项。' },
      { type: 'message/completed', text: '报告要点共三项。', usage: { inputTokens: 512, outputTokens: 48 } },
      { type: 'turn/completed' },
    ],
  },
  {
    id: 'cancel-preserves-prefix',
    covers: ['Cancel'],
    events: [
      { type: 'prompt/accepted', requestId: 'r2', content: '重构成 SwiftUI' },
      { type: 'stream/delta', text: '第一步' },
      { type: 'stream/delta', text: '：拆分视图。' },
      { type: 'turn/cancelled', reason: 'user' },
    ],
  },
  {
    id: 'tool-call-and-result',
    covers: ['Tool Call', 'Tool Result'],
    events: [
      { type: 'prompt/accepted', requestId: 'r3', content: '搜索契约文档' },
      { type: 'tool/call', id: 'c1', name: 'web_search', arguments: '{"query":"lite spec"}' },
      { type: 'tool/result', id: 'c1', ok: true, text: '找到 3 篇。' },
      { type: 'tool/call', id: 'c2', name: 'url_fetch', arguments: '{"url":"https://example.invalid/a"}' },
      { type: 'tool/result', id: 'c2', ok: false, text: 'DNS 解析失败' },
      { type: 'message/completed', text: '搜索完成，一篇无法抓取。' },
      { type: 'turn/completed' },
    ],
  },
  {
    id: 'plan-todo-artifact',
    covers: ['Plan', 'Todo', 'Artifact'],
    events: [
      { type: 'plan/changed', active: true },
      { type: 'todo/changed', todos: [
        { content: '写 Lite 行为规范', status: 'in_progress' },
        { content: '生成 golden fixtures', status: 'pending' },
      ] },
      { type: 'artifact/created', id: 'a1', kind: 'markdown', title: 'lite-behavior-spec.md' },
      { type: 'artifact/status', id: 'a1', status: 'ready' },
      { type: 'todo/changed', todos: [
        { content: '写 Lite 行为规范', status: 'completed' },
        { content: '生成 golden fixtures', status: 'in_progress' },
      ] },
      { type: 'turn/completed' },
    ],
  },
  {
    id: 'provider-and-network-errors',
    covers: ['Provider Error', 'Network Error'],
    events: [
      { type: 'prompt/accepted', requestId: 'r4', content: '继续' },
      { type: 'stream/delta', text: '好的' },
      { type: 'network/error', kind: 'dropped' },
      { type: 'prompt/accepted', requestId: 'r5', content: '重试' },
      { type: 'provider/error', code: 'RATE_LIMITED', message: '并发超限' },
      { type: 'prompt/rejected', requestId: 'r6', reason: '运行中不可插入' },
    ],
  },
  {
    id: 'handoff-request',
    covers: ['Handoff Request'],
    events: [
      { type: 'prompt/accepted', requestId: 'r7', content: '跑完整测试套件' },
      { type: 'tool/call', id: 'c3', name: 'run_tests', arguments: '{}' },
      { type: 'handoff/requested', capability: 'requiresFullRuntime' },
    ],
  },
]

/** One emitted Lite conformance artifact. */
export interface LiteConformanceArtifact {
  readonly id: string
  /** The exact JSON text the drift gate compares, ending in one newline. */
  readonly json: string
}

/**
 * Emit every Lite scenario's fixture: the events plus the reference fold's
 * expected domain state.
 * @param scenarios - the golden scenarios; defaults to the exported set.
 * @returns one artifact per scenario.
 */
export function generateLiteConformance(
  scenarios: readonly LiteScenario[] = LITE_SCENARIOS,
): LiteConformanceArtifact[] {
  return scenarios.map((scenario) => {
    const value = {
      covers: scenario.covers,
      events: scenario.events,
      expected: foldLiteDomain(scenario.events),
    }
    return { id: scenario.id, json: `${JSON.stringify(value, undefined, 2)}\n` }
  })
}

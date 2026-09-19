/** Distinct model steps may reuse a provider-issued ToolCallId. */
import { expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '../src/client/contract/snapshot.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'

function createAssembler(entries: readonly SessionEventLikeEntry[] = [], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(
    { entries: () => [toolDefinition], fallbackEntry: () => unknownFallbackDefinition },
    { entries: () => [chatViewDefinition] },
  )
  value.replaceWindow(entries, hasMore)
  value.activateTarget('chat')
  return value
}

function toolNodes(value: ConversationNodeAssembler) {
  value.flush()
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return snapshot.order.map(key => snapshot.nodes.get(key)!).filter(node => node.kind === 'tool-call')
}

function event(seq: number, type: string, data: unknown): SessionEventLikeEntry {
  return { type: 'event', event: {
    seq, time: seq, type, data, ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
  } as SessionEvent }
}

function result(turn: number, step: number, text: string) {
  return { turn, step, message: {
    id: `result-${turn}-${step}`, role: 'user', source: { kind: 'tool', callId: 'reused' },
    content: [{ type: 'tool-result', toolCallId: 'reused', content: [{ type: 'text', text }] }],
  } }
}

it.each([{ turn: 1, step: 2 }, { turn: 2, step: 1 }])('keeps repeated tool ids separate at $turn/$step', ({ turn, step }) => {
  const entries = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'step/start', { turn: 1, step: 1 }),
    event(2, 'tool/call', { turn: 1, step: 1, callId: 'reused', name: 'first', arguments: '{}' }),
    event(3, 'tool/result', result(1, 1, 'first result')),
    event(4, 'step/end', { turn: 1, step: 1 }),
    ...(turn === 2 ? [event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }), event(6, 'turn/start', { turn })] : []),
    event(7, 'step/start', { turn, step }),
    event(8, 'tool/call', { turn, step, callId: 'reused', name: 'second', arguments: '{}' }),
    event(9, 'tool/result', result(turn, step, 'second result')),
  ]
  const assembler = createAssembler(entries)
  const nodes = toolNodes(assembler)
  expect(nodes).toHaveLength(2)
  expect(nodes.map(node => node.data)).toMatchObject([
    { root: { call: { name: 'first' }, content: [{ text: 'first result' }] } },
    { root: { call: { name: 'second' }, content: [{ text: 'second result' }] } },
  ])
})

function nestedTurn(turn: number, firstSeq: number): SessionEventLikeEntry[] {
  const dispatch = { rootCallId: 'reused', parentCallId: 'reused', subCallId: 'same-child', name: `child-${turn}`, arguments: {} }
  return [
    event(firstSeq, 'turn/start', { turn }),
    event(firstSeq + 1, 'step/start', { turn, step: 1 }),
    event(firstSeq + 2, 'tool/call', { turn, step: 1, callId: 'reused', name: `root-${turn}`, arguments: '{}' }),
    event(firstSeq + 3, 'tool/ptc-dispatch-start', dispatch),
    event(firstSeq + 4, 'tool/ptc-dispatch', { ...dispatch, isError: false, content: [{ type: 'text', text: `child result ${turn}` }] }),
    event(firstSeq + 5, 'tool/result', result(turn, 1, `root result ${turn}`)),
    event(firstSeq + 6, 'step/end', { turn, step: 1 }),
    event(firstSeq + 7, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

it.each(['replace', 'append', 'prepend'] as const)('keeps repeated PTC ids inside their root occurrence during %s', (mode) => {
  const first = nestedTurn(1, 0)
  const second = nestedTurn(2, 8)
  const value = createAssembler(mode === 'replace' ? [...first, ...second] : mode === 'append' ? first : second.slice(4), mode === 'prepend')
  const beforeKey = mode === 'prepend' ? toolNodes(value)[0]!.key : undefined
  if (mode === 'append') for (const entry of second) value.append(entry)
  if (mode === 'prepend') {
    value.prepend(second.slice(0, 4), true)
    expect(toolNodes(value)[0]!.key).toBe(beforeKey)
    value.prepend(first, false)
  }
  const nodes = toolNodes(value)
  expect(nodes).toHaveLength(2)
  expect(nodes.map(node => node.data)).toMatchObject([1, 2].map(turn => ({ root: {
    call: { name: `root-${turn}` }, content: [{ text: `root result ${turn}` }],
    subCalls: [{ call: { name: `child-${turn}` }, content: [{ text: `child result ${turn}` }] }],
  } })))
  if (beforeKey !== undefined) expect(nodes[1]!.key).toBe(beforeKey)
})

it('waits for a Step anchor before publishing a PTC-only prefix and retains its identity on prepend', () => {
  const entries = nestedTurn(1, 0)
  const value = createAssembler(entries.slice(3, 5), true)
  expect(toolNodes(value)).toHaveLength(0)
  value.append(entries[5]!)
  const before = toolNodes(value)[0]!
  expect(before.data).toMatchObject({ root: { subCalls: [{ call: { name: 'child-1' } }] } })
  value.prepend(entries.slice(0, 3), false)
  const after = toolNodes(value)[0]!
  expect(after.key).toBe(before.key)
  expect(after.data).toMatchObject({ root: { call: { name: 'root-1' }, subCalls: [{ call: { name: 'child-1' } }] } })
})

it('does not attach an older unlocated dispatch across a later Step opening', () => {
  const first = nestedTurn(1, 0)
  const second = nestedTurn(2, 8)
  const value = createAssembler([first[3]!, first[6]!, first[7]!, ...second.slice(0, 3)], true)
  expect(toolNodes(value)).toHaveLength(1)
  expect(toolNodes(value)[0]!.data).toMatchObject({ root: { name: 'root-2', subCalls: [] } })
})

it('still rejects two starts with the same id in the same Step', () => {
  const entries = nestedTurn(1, 0)
  const value = createAssembler(entries.slice(0, 3))
  expect(() => value.append(event(3, 'tool/call', { turn: 1, step: 1, callId: 'reused', name: 'duplicate', arguments: '{}' })))
    .toThrow('received more than one start Match')
})

it('rejects a transient start before deferring an unresolved Step identity', () => {
  const value = new ConversationNodeAssembler(
    { entries: () => [{ ...toolDefinition, match: () => ({ id: 'invalid', role: 'start' as const }) }],
      fallbackEntry: () => undefined },
    { entries: () => [chatViewDefinition] },
  )
  const entry = { type: 'transient', event: { seq: 1, time: 1, type: 'assistant/live-chunk', data: {} } }
  expect(() => value.replaceWindow([entry as SessionEventLikeEntry], true)).toThrow('received a transient start Match')
})

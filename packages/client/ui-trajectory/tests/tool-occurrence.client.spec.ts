/** Trajectory retains separate root and nested Tool executions when provider ids repeat. */
import type { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { registerTrajectoryToolDefinition } from '../src/client/trajectory-tool-definition.ts'
import { registerTrajectoryAssistantDefinition } from '../src/client/trajectory-assistant-definition.ts'
import { trajectoryViewDefinition } from '../src/client/trajectory-snapshot-builder.ts'
import { deriveTrajectoryLayout } from '../src/client/layout.ts'
import { trajectoryRecordId } from '../src/client/trajectory-record.ts'
import { t } from './locale.client.ts'

function row(seq: number, type: string, data: unknown): SessionEventLikeEntry {
  return { type: 'event', event: { seq, time: seq, type, data,
    ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
  } as SessionEvent }
}

function turnEvents(turn: number, seq: number): SessionEventLikeEntry[] {
  const child = { rootCallId: 'same-root', parentCallId: 'same-root', subCallId: 'same-child', name: `nested-${turn}`, arguments: {} }
  return [
    row(seq, 'turn/start', { turn }),
    row(seq + 1, 'step/start', { turn, step: 1 }),
    row(seq + 2, 'tool/call', { turn, step: 1, callId: 'same-root', name: `root-${turn}`, arguments: '{}' }),
    row(seq + 3, 'tool/ptc-dispatch-start', child),
    row(seq + 4, 'tool/ptc-dispatch', { ...child, isError: false, content: [{ type: 'text', text: `nested result ${turn}` }] }),
    row(seq + 5, 'tool/result', { turn, step: 1, message: {
      id: `result-${turn}`, role: 'user', source: { kind: 'tool', callId: 'same-root' },
      content: [{ type: 'tool-result', toolCallId: 'same-root', content: [{ type: 'text', text: `result ${turn}` }] }],
    } }),
    row(seq + 6, 'step/end', { turn, step: 1 }),
    row(seq + 7, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

it.each([[1, 2], [2, 1]])('pairs reused results and timing for turn %i step %i', (turn, step) => {
  const definitions: ConversationNodeDefinition[] = []
  const ctx = { uiConversation: { events: { register: (definition: ConversationNodeDefinition) => {
    definitions.push(definition)
    return () => {}
  } } } } as unknown as Context
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  const assembler = new ConversationNodeAssembler(
    { entries: () => definitions, fallbackEntry: () => undefined },
    { entries: () => [trajectoryViewDefinition] },
  )
  const events: SessionEventLikeEntry[] = []
  for (const [at, position] of [{ turn: 1, step: 1 }, { turn, step }].entries()) {
    const seq = at * 10
    events.push(
      row(seq, 'turn/start', { turn: position.turn }),
      row(seq + 1, 'step/start', position),
      row(seq + 2, 'assistant/message', { ...position, message: {
        id: `assistant-${at}`, role: 'assistant', source: { provider: 'test', model: 'test' }, content: [
          { type: 'tool-call', id: 'reused', name: 'read', arguments: '{}' },
        ],
      } }),
      row(seq + 3, 'tool/call', { ...position, callId: 'reused', name: 'read', arguments: '{}' }),
      row(seq + 4 + at, 'tool/result', { ...position, message: {
        id: `result-${at}`, role: 'user', source: { kind: 'tool', callId: 'reused' },
        content: [{ type: 'tool-result', toolCallId: 'reused', content: [{ type: 'text', text: `output-${at}` }] }],
      } }),
      row(seq + 6, 'step/end', position),
      row(seq + 7, 'turn/end', { turn: position.turn, reason: { kind: 'completed' } }),
    )
  }
  // One Turn contains both Steps in the first case.
  const entries = turn === 1 ? events.filter(entry => entry.event.seq !== 7 && entry.event.seq !== 10) : events
  assembler.replaceWindow(entries, false)
  assembler.activateTarget('trajectory')
  assembler.flush()
  const snapshot = assembler.get('trajectory')!
  const schemas = [{ name: 'read', description: 'first', parameters: {} }, { name: 'read', description: 'second', parameters: {} }]
  const callSchemas = new Map([
    [JSON.stringify([1, 1, 'reused']), schemas[0]!],
    [JSON.stringify([turn, step, 'reused']), schemas[1]!],
  ])
  const layout = deriveTrajectoryLayout({ ...snapshot, nodes: snapshot.eventNodes, callSchemas }, t)
  const calls = layout.flatMap(value => value.groups.flatMap(group => group.cells)).filter(cell => cell.kind === 'tool')
  expect(calls).toHaveLength(2)
  expect(calls.map(cell => cell.outputDetail)).toEqual(['output-0', 'output-1'])
  expect(calls.map(cell => cell.startedAt)).toEqual([3, 13])
  expect(calls.map(cell => cell.timeSeconds)).toEqual([0.001, 0.002])
  expect(calls.map(cell => cell.schemaDetail)).toEqual(schemas.map(schema => JSON.stringify(schema, null, 2)))
  expect(new Set(calls.map(trajectoryRecordId)).size).toBe(2)
})

it.each(['replace', 'append', 'prepend'] as const)('isolates reused Tool and PTC ids during %s', (mode) => {
  const definitions: ConversationNodeDefinition[] = []
  registerTrajectoryToolDefinition({ uiConversation: { events: { register: (definition: ConversationNodeDefinition) => {
    definitions.push(definition)
    return () => {}
  } } } } as unknown as Context)
  const value = new ConversationNodeAssembler(
    { entries: () => definitions, fallbackEntry: () => undefined },
    { entries: () => [trajectoryViewDefinition] },
  )
  const first = turnEvents(1, 0)
  const second = turnEvents(2, 8)
  value.replaceWindow(mode === 'replace' ? [...first, ...second] : mode === 'append' ? first : second.slice(4), mode === 'prepend')
  value.activateTarget('trajectory')
  if (mode === 'append') for (const entry of second) value.append(entry)
  if (mode === 'prepend') {
    value.prepend(second.slice(0, 4), true)
    value.flush()
    value.prepend(first, false)
  }
  value.flush()
  const roots = value.get('trajectory')!.eventNodes.filter(node => node.kind === 'tool-result')
  expect(roots).toHaveLength(2)
  expect(roots).toMatchObject([1, 2].map(turn => ({
    call: { name: `root-${turn}` }, content: [{ text: `result ${turn}` }],
    subCalls: [{ call: { name: `nested-${turn}` }, content: [{ text: `nested result ${turn}` }] }],
  })))
  const snapshot = value.get('trajectory')!
  const turns = deriveTrajectoryLayout({ ...snapshot, nodes: snapshot.eventNodes }, t)
  expect(turns.map(turn => turn.turn)).toEqual([1, 2])
  const cells = turns.flatMap(turn => turn.groups.flatMap(group => group.cells))
  expect(cells.map(cell => cell.outputDetail)).toEqual([
    'result 1', 'nested result 1', 'result 2', 'nested result 2',
  ])
  expect(new Set(cells.map(trajectoryRecordId)).size).toBe(4)
})

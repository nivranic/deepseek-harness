/** Durable command receipts retain exact settlements across checkpoint recovery. */
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { expect, it, onTestFinished } from 'vitest'
import { CommandDefinitionId, CommandId, CommandMutationId } from '../src/brand.ts'
import { findCommandReceipt, registerCommandReceiptProjection } from '../src/receipt-projection.ts'

it('folds success and failure settlements, replaces repeated identities, and restores optional fields', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  let registered: ReturnType<typeof registerCommandReceiptProjection> | undefined
  await ctx.plugin({
    inject: ['sessionProjections'],
    apply(inner) { registered = registerCommandReceiptProjection(inner) },
  })
  const receipts = await registered
  if (receipts === undefined) throw new Error('receipt projection registration did not start')
  const session = ctx.sessions.create(SessionId('command-receipt-fold'))
  const initial = receipts.stateOf(session)
  expect(CommandDefinitionId('fixture/command')).toBe('fixture/command')
  expect(initial).toEqual([])
  session.append('turn/start', { turn: 1 })
  expect(receipts.stateOf(session)).toBe(initial)
  session.append('command/done', { commandId: CommandId('untracked'), kind: 'success' })
  expect(receipts.stateOf(session)).toBe(initial)
  session.append('command/done', {
    commandId: CommandId('first'), clientMutationId: CommandMutationId('a'), kind: 'success',
  })
  session.append('command/done', {
    commandId: CommandId('second'), clientMutationId: CommandMutationId('b'), kind: 'success',
    text: 'completed', sourceEventSeq: SessionSeq(0),
  })
  session.append('command/done', {
    commandId: CommandId('third'), clientMutationId: CommandMutationId('c'), kind: 'error', text: 'failed',
  })
  session.append('command/done', {
    commandId: CommandId('replacement'), clientMutationId: CommandMutationId('a'), kind: 'error',
  })
  const rows = receipts.stateOf(session)
  expect(rows).toEqual([
    { commandId: 'second', clientMutationId: 'b', kind: 'success', text: 'completed', sourceEventSeq: 0 },
    { commandId: 'third', clientMutationId: 'c', kind: 'error', text: 'failed' },
    { commandId: 'replacement', clientMutationId: 'a', kind: 'error', text: '' },
  ])
  expect(findCommandReceipt(rows, 'b')).toBe(rows[0])
  expect(findCommandReceipt(rows, 'absent')).toBeUndefined()
  const checkpoint = ctx.sessionProjections.checkpoint(session)
  const recovered = ctx.sessionProjections.restore(checkpoint, [], session.seq, session.header, SessionLogOffset(0))
  expect(recovered.checkpoint.commandReceipts?.val).toEqual(rows)
  const success = { commandId: 'without-text', clientMutationId: 'd', kind: 'success' }
  const withOptional = { commandId: 'with-text', clientMutationId: 'e', kind: 'success', text: 'done', sourceEventSeq: 0 }
  const restored = ctx.sessionProjections.restore({
    ...checkpoint,
    commandReceipts: { ...checkpoint.commandReceipts!, val: [...rows, success, withOptional] },
  }, [], session.seq, session.header, SessionLogOffset(0))
  expect(restored.checkpoint.commandReceipts?.val).toEqual([...rows, success, withOptional])
})

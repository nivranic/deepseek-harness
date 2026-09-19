import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionCheckpoint } from '@deepseek-ai/dsh-session-projection'
import type { SubagentPromptRequestId } from '../src/control-types.ts'
import { findPromptReceipt, subagentPromptReceiptsProjectionDefinition as definition } from '../src/prompt-receipts.ts'

function insertion(seq: number, message: UserMessage): SessionEvent<'agent/inbox/spliced'> {
  return { type: 'agent/inbox/spliced', seq: SessionSeq(seq), time: 0,
    data: { target: 'next-turn', start: 0, removedCount: 0, inserted: [message] } }
}

describe('subagent prompt receipts', () => {
  it('restores only child-owned acceptance and keeps receipts out of wire snapshots', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      const owner = ctx.plugin({
        name: 'prompt-receipts', inject: ['sessionProjections'],
        apply(context) { context.sessionProjections.register(definition) },
      })
      await owner
      const parent = ctx.sessions.create(SessionId('receipt-parent'))
      const requestId = '__proto__' as SubagentPromptRequestId
      const inherited = createUserMessage({ content: [{ type: 'text', text: 'parent request' }], source: { kind: 'user', rpcId: requestId } })
      const own = createUserMessage({ content: [{ type: 'text', text: 'child request' }], source: { kind: 'user', rpcId: requestId } })
      const header = { ...parent.header, id: SessionId('receipt-child'), isSeeded: true, parentSession: parent.id }
      const events = [insertion(0, inherited), insertion(1, own)]
      const restored = ctx.sessionProjections.restore({}, events, SessionLogOffset(0), header, SessionLogOffset(1))
      const state = definition.stateSchema.parse(restored.checkpoint.subagentPromptReceipts!.val)
      expect(findPromptReceipt(state, requestId)).toBe(own.id)
      expect(restored.snapshot.values).not.toHaveProperty('subagentPromptReceipts')
      const roundtrip = JSON.parse(JSON.stringify(restored.checkpoint)) as ProjectionCheckpoint
      const reread = ctx.sessionProjections.restore(roundtrip, events, SessionLogOffset(0), header, SessionLogOffset(1))
      expect(findPromptReceipt(definition.stateSchema.parse(reread.checkpoint.subagentPromptReceipts!.val), requestId)).toBe(own.id)
      roundtrip.subagentPromptReceipts = {
        ...roundtrip.subagentPromptReceipts!,
        val: { inheritedEventCount: 1, head: { values: [{ requestId, messageId: '' }] } },
      }
      expect(() => ctx.sessionProjections.restore(roundtrip, events, SessionLogOffset(0), header, SessionLogOffset(1))).toThrow()
      await owner.dispose()
      expect(ctx.sessionProjections.stateOf(parent, 'subagentPromptReceipts')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

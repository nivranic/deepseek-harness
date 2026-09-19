/** Host-only reconstruction of accepted human prompts in a continuable child's own log. */

import { z } from 'zod'
import { appendChunkedList, chunkedListSchema, iterateChunkedList } from '@deepseek-ai/dsh-chunked-list'
import type { ChunkedList } from '@deepseek-ai/dsh-chunked-list'
import type { MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SubagentPromptRequestId } from './control-types.ts'

interface PromptReceipt {
  readonly requestId: SubagentPromptRequestId
  readonly messageId: MessageId
}

/** Accepted identities exclude inherited events and survive inbox removal or message consumption. */
export interface SubagentPromptReceiptsState {
  readonly inheritedEventCount: SessionLogOffset
  readonly head?: ChunkedList<PromptReceipt> | undefined
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentPromptReceipts: SubagentPromptReceiptsState
  }
}

const receiptSchema = z.object({
  requestId: z.string().min(1) as unknown as z.ZodType<SubagentPromptRequestId>,
  messageId: z.string().min(1) as unknown as z.ZodType<MessageId>,
}).strict()
const stateSchema: z.ZodType<SubagentPromptReceiptsState> = z.object({
  inheritedEventCount: z.number().int().nonnegative() as unknown as z.ZodType<SessionLogOffset>,
  head: chunkedListSchema(receiptSchema).optional(),
}).strict()

/** Accepted human request identities, retained only on the Host and rebuilt from existing events. */
export const subagentPromptReceiptsProjectionDefinition = {
  key: 'subagentPromptReceipts',
  stateSchema,
  stateVersion: 1,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset): SubagentPromptReceiptsState => ({ inheritedEventCount }),
  apply: (state, event: SessionEvent): SubagentPromptReceiptsState => {
    if (event.seq < state.inheritedEventCount) return state
    const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted
      : event.type === 'user/message' ? [event.data] : []
    let head = state.head
    for (const message of messages) {
      const requestId = promptRequestId(message.source)
      if (requestId !== undefined) head = appendChunkedList(head, { requestId, messageId: message.id })
    }
    return head === state.head ? state : { ...state, head }
  },
} satisfies ProjectionDefinition<'subagentPromptReceipts', SubagentPromptReceiptsState>

/**
 * Identify a browser-authored request while leaving model messages and uncorrelated human input distinct.
 * @param source - durable message attribution.
 * @returns the recorded request identity, if present.
 */
export function promptRequestId(source: MessageSource | undefined): SubagentPromptRequestId | undefined {
  return source?.kind === 'user' && 'rpcId' in source && typeof source.rpcId === 'string'
    ? source.rpcId as SubagentPromptRequestId : undefined
}

/**
 * Recover the first accepted message for one request without repeating its side effects.
 * @param state - child's receipt projection, excluding inherited history.
 * @param requestId - browser-minted request identity.
 * @returns original message identity, including after consumption or removal; otherwise undefined.
 */
export function findPromptReceipt(state: SubagentPromptReceiptsState, requestId: SubagentPromptRequestId): MessageId | undefined {
  for (const receipt of iterateChunkedList(state.head)) {
    if (receipt.requestId === requestId) return receipt.messageId
  }
  return undefined
}

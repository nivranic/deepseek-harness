/**
 * Durable `clientMutationId` receipt projection: the command registry's
 * replay table for id-carrying submissions, folded from `command/done`
 * events by the session-projection drive (specification §17).
 *
 * @module @deepseek-ai/dsh-commands/receipt-projection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

/**
 * Upper bound on retained receipts per session; the oldest row is evicted
 * beyond it. A resend of an evicted id re-runs as a fresh request.
 */
const RECEIPT_LIMIT = 1024

/**
 * One settled execution's replay material, read from a `command/done` event
 * carrying a `clientMutationId`. Fields are the plain JSON form — brands
 * are re-applied when the registry rebuilds the `CommandExecution`.
 */
export type CommandReceiptRow =
  | {
    readonly clientMutationId: string
    readonly commandId: string
    readonly kind: 'success'
    readonly text?: string
    readonly sourceEventSeq?: number
  }
  | {
    readonly clientMutationId: string
    readonly commandId: string
    readonly kind: 'error'
    readonly text: string
  }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Rebuild material for recently settled id-carrying command executions, oldest first. */
    commandReceipts: CommandReceiptRow[]
  }
}

// The cast bridges only the optional success arms: Zod's optional output
// includes explicit `undefined`, which exactOptionalPropertyTypes excludes
// from the row interface. The runtime object never carries an explicit
// `undefined` member — the spread omits absent keys — so the persisted state
// survives JSON losslessly.
const receiptRowSchema = z.discriminatedUnion('kind', [
  z.object({
    clientMutationId: z.string().min(1).max(128),
    commandId: z.string().min(1),
    kind: z.literal('success'),
    text: z.string().optional(),
    sourceEventSeq: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    clientMutationId: z.string().min(1).max(128),
    commandId: z.string().min(1),
    kind: z.literal('error'),
    text: z.string(),
  }).strict(),
]) as unknown as z.ZodType<CommandReceiptRow>

/** Host-only receipt fold: `command/done` settlements carrying a retry identity. */
const commandReceiptProjection = {
  key: 'commandReceipts',
  stateSchema: receiptRowSchema.array(),
  init: (): CommandReceiptRow[] => [],
  apply: applyReceiptEvent,
  stateVersion: 1,
} satisfies ProjectionDefinition<'commandReceipts'>

/**
 * One-event receipt-state transition. Only a `command/done` carrying a
 * `clientMutationId` is a receipt — the settlement event is
 * self-sufficient, so the paired `command/run` is never consulted.
 * Unrelated events return the same reference (the registry's change gate).
 * @param state - the folded receipt rows before `event`, oldest first.
 * @param event - one committed session event.
 * @returns the next receipt rows; the same reference when the event is unrelated.
 */
function applyReceiptEvent(state: CommandReceiptRow[], event: SessionEvent): CommandReceiptRow[] {
  if (event.type !== 'command/done') return state
  const { clientMutationId, commandId, kind, text, sourceEventSeq } = event.data
  if (clientMutationId === undefined) return state
  // A repeated id keeps one row — the latest settlement — so the replay
  // window stays bounded per distinct intent.
  const rows = state.filter(row => row.clientMutationId !== clientMutationId)
  rows.push(kind === 'success'
    ? {
      clientMutationId,
      commandId,
      kind,
      ...text === undefined ? {} : { text },
      ...sourceEventSeq === undefined ? {} : { sourceEventSeq },
    }
    : { clientMutationId, commandId, kind, text: text ?? '' })
  /* v8 ignore next 2 -- exercising eviction needs 1025 settled id-carrying executions; the bound keeps the replay window finite */
  if (rows.length > RECEIPT_LIMIT) {
    rows.splice(0, rows.length - RECEIPT_LIMIT)
  }
  return rows
}

/**
 * Find the newest receipt row for one mutation id.
 * @param rows - the folded receipt rows, oldest first.
 * @param clientMutationId - the resent submission identity.
 * @returns the newest row carrying the id, or `undefined` when no settled receipt covers it.
 */
export function findCommandReceipt(
  rows: readonly CommandReceiptRow[],
  clientMutationId: string,
): CommandReceiptRow | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row?.clientMutationId === clientMutationId) return row
  }
  return undefined
}

/**
 * Register the command receipt projection in the session-projection
 * registry. The registration is an effect on the calling fiber.
 * @param ctx - context whose `sessionProjections` service is available.
 * @returns the exact disposer that unregisters the unit.
 */
export function registerCommandReceiptProjection(ctx: Context): () => void {
  return ctx.sessionProjections.register(commandReceiptProjection)
}

/** Cancellation targets derived from the authoritative Session turn boundaries. */
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

const activeTurnStartSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()

const activeTurnProjection = {
  key: 'activeTurnStart',
  stateSchema: activeTurnStartSchema,
  init: (): number | null => null,
  apply: (state, event) => {
    if (event.type === 'turn/start') return event.seq
    return event.type === 'turn/end' ? null : state
  },
  wire: { viewSchema: activeTurnStartSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'activeTurnStart', number | null>

/**
 * Register the current-turn target in the existing projection registry.
 * @param ctx - Session Controller context owning registration and withdrawal.
 */
export function installActiveTurnProjection(ctx: Context): void {
  ctx.sessionProjections.register(activeTurnProjection)
}

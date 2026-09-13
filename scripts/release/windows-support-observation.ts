/** Independent admission of the actual desktop renderer request captured by the native smoke. */
import type { ConnectionDiagnosticSnapshot } from '@deepseek-ai/dsh-client-connection'
import { z } from 'zod'

const requestSchema = z.strictObject({
  type: z.literal('client-request'),
  rpcId: z.string().min(1).max(128),
  method: z.literal('desktopSupport/export'),
  payload: z.strictObject({ args: z.strictObject({ connection: z.strictObject({
    state: z.enum(['idle', 'opening', 'connected', 'reconnecting', 'stopping', 'stopped']),
    attempts: z.number().int().min(0).max(0xffff_ffff),
    interruptions: z.number().int().min(0).max(0xffff_ffff),
    countsSaturated: z.boolean(),
  }) }) }),
})

/**
 * Select only the fixed Connection facts from the actual Settings request.
 * @param value - parsed outgoing RPC JSON captured by Playwright, before saved-document comparison.
 * @returns a fresh diagnostic value without the request's correlation id or other wire metadata.
 */
export function readConnectionObservation(value: unknown): ConnectionDiagnosticSnapshot {
  const parsed = requestSchema.safeParse(value)
  if (!parsed.success) throw new Error('Windows renderer connection observation was not accepted')
  const connection = parsed.data.payload.args.connection
  if (connection.interruptions > connection.attempts || connection.countsSaturated !== (connection.attempts === 0xffff_ffff)) {
    throw new Error('Windows renderer connection observation was not accepted')
  }
  return connection
}

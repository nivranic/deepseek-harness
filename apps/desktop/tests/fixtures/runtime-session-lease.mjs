/** Verify native Session write exclusion through the shipped persistence service. */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

/**
 * Check exclusion, concurrent reading, and reacquisition across independent backends.
 * @param {string} root - Private fixture storage directory.
 * @returns {Promise<void>} Completion after every backend has disposed its handles.
 */
export async function verifySessionLease(root) {
  const contexts = [new Context(), new Context()]
  try {
    for (const ctx of contexts) await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const first = contexts[0].sessionPersistence
    const second = contexts[1].sessionPersistence
    const id = SessionId('desktop-native-lease')
    const holder = await first.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 1_000, cwd: root, isSeeded: false })
    await holder.flush()
    await assert.rejects(second.open(id, 'write'), SessionAlreadyOwnedError)
    const reader = await second.open(id, 'read')
    assert.deepEqual((await reader.read()).events, [])
    await reader.close()
    await holder.close()
    const successor = await second.open(id, 'write')
    await successor.close()
  } finally {
    const results = await Promise.allSettled(contexts.map(ctx => ctx.fiber.dispose()))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'Desktop Session lease smoke cleanup failed')
  }
}

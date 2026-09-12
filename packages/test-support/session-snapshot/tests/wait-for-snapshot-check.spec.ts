import { describe, expect, it, vi } from 'vitest'
import { waitForSnapshotCheck } from '../src/wait-for-snapshot-check.ts'

describe('snapshot persistence checks', () => {
  it('retries a missing record until the assertion succeeds', async () => {
    const missing = new Error('session did not persist the requested event')
    const check = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(missing)
      .mockResolvedValue(undefined)
    await waitForSnapshotCheck(check, missing, { interval: 1, timeout: 1000 })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('names the requested record when the first asynchronous read outlives the deadline', async () => {
    const pending = Promise.withResolvers<undefined>()
    const missing = new Error('session did not persist user/message after turn/end within 20ms')
    const check = vi.fn(() => pending.promise)
    const outcome = waitForSnapshotCheck(check, missing, { interval: 1, timeout: 20 })
    try {
      await expect(outcome).rejects.toMatchObject({
        message: missing.message,
        cause: { message: 'Timed out in waitFor!' },
      })
      expect(check).toHaveBeenCalledTimes(1)
    } finally {
      pending.resolve(undefined)
      await pending.promise
    }
    await expect(outcome).rejects.toThrow(missing.message)
  })

  it.each([
    { label: 'the record assertion error', failure: new Error('requested record is absent') },
    { label: 'the log parse error', failure: new SyntaxError('malformed persisted record') },
    { label: 'an error with the framework timeout text', failure: new Error('Timed out in waitFor!') },
  ])('preserves $label', async ({ failure }) => {
    await expect(waitForSnapshotCheck(
      () => Promise.reject(failure), new Error('unobserved deadline'), { interval: 1, timeout: 20 },
    )).rejects.toBe(failure)
  })
})

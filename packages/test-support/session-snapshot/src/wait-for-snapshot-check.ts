/** Scenario-specific diagnostics for asynchronous persistence waits. */
import { vi } from 'vitest'

/**
 * Wait for a persistence assertion with a scenario-owned timeout diagnostic.
 * @param check - Asynchronous assertion retried at the requested interval.
 * @param timeoutError - Deadline message when no assertion failure has been observed.
 * @param options - Poll interval and total deadline in milliseconds.
 * @returns Resolves on success; the deadline preserves the last observed assertion failure,
 * or reports the scenario message with the waiter's original failure as its cause.
 */
export async function waitForSnapshotCheck(
  check: () => Promise<void>,
  timeoutError: Error,
  options: Readonly<{ interval: number; timeout: number }>,
): Promise<void> {
  const checkState = { observedFailure: false }
  try {
    await vi.waitFor(async () => {
      try {
        await check()
      } catch (error) {
        checkState.observedFailure = true
        throw error
      }
    }, options)
  } catch (error) {
    if (checkState.observedFailure) throw error
    throw new Error(timeoutError.message, { cause: error })
  }
}

/** Preserve candidate operation failures when disposal also fails. */

/**
 * Run owned cleanup once on either outcome without losing the operation's failure.
 * @param operation - candidate work that owns resources until it settles.
 * @param cleanup - disposal and directory cleanup; rejection remains a failed run.
 * @returns the operation's value after successful cleanup; simultaneous failures are aggregated in that order.
 */
export async function withRcCleanup<T>(operation: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let failure: { error: unknown } | undefined
  try {
    return await operation()
  } catch (error) {
    failure = { error }
    throw error
  } finally {
    try {
      await cleanup()
    } catch (cleanupError) {
      if (failure !== undefined) {
        throw new AggregateError([failure.error, cleanupError], 'Windows candidate operation and cleanup both failed')
      }
      throw cleanupError
    }
  }
}

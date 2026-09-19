/** Feedback operation authority observed through the existing Connection generation. */
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Current supported operations and an origin check for retained callbacks. */
export interface FeedbackAccess {
  readonly generation: number
  readonly read: boolean
  readonly put: boolean
  readonly delete: boolean
  readonly record: boolean
  readonly current: () => boolean
}

/**
 * Bind feedback gestures to their originating admitted Host.
 * @param host - current connection facts.
 * @param alive - registration lifetime.
 * @param subscribe - Connection generation observer.
 * @returns stable supported-operation snapshots, replaced on withdrawal.
 */
export function createFeedbackAccess(
  host: () => RemoteHostFacts,
  alive: () => boolean,
  subscribe: (listener: () => void) => () => void,
): HostObservable<FeedbackAccess> {
  let previous: RemoteHostFacts | undefined
  let snapshot: FeedbackAccess | undefined
  let generation = 0
  const getSnapshot = (): FeedbackAccess => {
    const next = alive() ? host() : undefined
    if (snapshot !== undefined && next === previous) return snapshot
    previous = next
    const supports = (id: string): boolean => next?.capabilities?.includes(id) === true
    snapshot = {
      generation: ++generation,
      read: supports('feedback.message.read.v1'),
      put: supports('feedback.message.put.v1'),
      delete: supports('feedback.message.delete.v1'),
      record: supports('feedback.session.record.v1'),
      current: () => alive() && host() === next,
    }
    return snapshot
  }
  return { getSnapshot, subscribe: listener => subscribe(() => { getSnapshot(); listener() }) }
}

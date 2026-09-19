/** Connection-owned Goal actions; durable Goal state remains in Session projections. */
import type { GOAL_REMOTE_CAPABILITIES, RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalRef } from '@deepseek-ai/dsh-goal/client'
import type { GoalAccessSnapshot, GoalActionResult } from './slots.ts'

type Capability = typeof GOAL_REMOTE_CAPABILITIES[number]['id']

/** Inputs supplied by the Goal dock registration. */
export interface GoalAccessDeps {
  readonly host: () => RemoteHostFacts
  readonly alive: () => boolean
  readonly subscribeGeneration: (listener: () => void) => () => void
  readonly ref: () => GoalRef | undefined
  readonly edit: (ref: GoalRef, objective: string) => Promise<GoalActionResult>
  readonly pause: (ref: GoalRef) => Promise<GoalActionResult>
  readonly resume: (ref: GoalRef) => Promise<GoalActionResult>
  readonly clear: (ref: GoalRef) => Promise<GoalActionResult>
  readonly connectionChanged: () => string
  readonly requestFailed: () => string
}

/**
 * Bind visible mutation callbacks to their originating Host snapshot.
 * @param deps - current Host, projection ref, lifecycle, Remote methods and localized errors.
 * @returns stable snapshots with only supported actions; stale calls and replies settle as local failures.
 */
export function createGoalAccessSource(deps: GoalAccessDeps): HostObservable<GoalAccessSnapshot> {
  let snapshot: GoalAccessSnapshot | undefined
  let cachedHost: RemoteHostFacts | undefined
  let generation = 0
  const supports = (host: RemoteHostFacts, capability: Capability): boolean => host.capabilities?.includes(capability) === true
  const current = (host: RemoteHostFacts): boolean => deps.alive() && deps.host() === host
  const changed = (): GoalActionResult => ({
    ok: false, error: { code: 'goal-context-changed', message: deps.connectionChanged() },
  })
  const mutate = async (
    host: RemoteHostFacts,
    capability: Capability,
    invoke: (ref: GoalRef) => Promise<GoalActionResult>,
  ): Promise<GoalActionResult> => {
    if (!current(host) || !supports(host, 'goal.read.v1') || !supports(host, capability)) return changed()
    const ref = deps.ref()
    if (ref === undefined) return { ok: false, error: { code: 'no-current-goal', message: 'no current goal to mutate' } }
    let result: GoalActionResult
    try {
      result = await invoke(ref)
    } catch (_requestFailure) {
      return current(host)
        ? { ok: false, error: { code: 'goal-request-failed', message: deps.requestFailed() } }
        : changed()
    }
    return current(host) ? result : changed()
  }
  const getSnapshot = (): GoalAccessSnapshot => {
    const host = deps.alive() ? deps.host() : undefined
    if (snapshot !== undefined && host === cachedHost) return snapshot
    cachedHost = host
    const readable = host !== undefined && supports(host, 'goal.read.v1')
    snapshot = {
      generation: ++generation,
      readable,
      actions: !readable ? {} : {
        ...(supports(host, 'goal.edit.v1') ? { onEdit: (objective: string) => mutate(host, 'goal.edit.v1', ref => deps.edit(ref, objective)) } : {}),
        ...(supports(host, 'goal.pause.v1') ? { onPause: () => mutate(host, 'goal.pause.v1', deps.pause) } : {}),
        ...(supports(host, 'goal.resume.v1') ? { onResume: () => mutate(host, 'goal.resume.v1', deps.resume) } : {}),
        ...(supports(host, 'goal.clear.v1') ? { onClear: () => mutate(host, 'goal.clear.v1', deps.clear) } : {}),
      },
    }
    return snapshot
  }
  return {
    getSnapshot,
    subscribe: listener => deps.subscribeGeneration(() => {
      getSnapshot()
      listener()
    }),
  }
}

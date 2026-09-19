import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GoalActivationChanged, GoalId, GoalProjection, GoalView } from '@deepseek-ai/dsh-goal/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createGoalActivationSource } from '../src/client/activation-source.ts'

const GOAL_ID = 'g-1' as GoalId

function projection(): GoalProjection {
  return {
    goal: {
      id: GOAL_ID,
      revision: 1,
      objective: 'ship it',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function goalView(activation: 'armed' | 'disarmed'): GoalView {
  return { ...projection().goal, roundsStarted: 0, createdAt: 1, updatedAt: 1, activation }
}

describe('goal activation source', () => {
  it('does not let a stale read overwrite a later activation event', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    let resolveRead!: (value: RemoteResult<GoalView | undefined>) => void
    const getGoal = vi.fn(() => new Promise<RemoteResult<GoalView | undefined>>((resolve) => {
      resolveRead = resolve
    }))
    let activationListener: ((goal: GoalActivationChanged['goal']) => void) | undefined
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal,
      subscribeActivation: (listener) => {
        activationListener = listener
        return () => { activationListener = undefined }
      },
      canRead: () => true,
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})

    activationListener?.({ id: GOAL_ID, revision: 1, activation: 'disarmed' })
    resolveRead({ ok: true, value: goalView('armed') })
    await Promise.resolve()

    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1, activation: 'disarmed' })
    dispose()
  })

  it('refreshes on the running edge without clearing the last activation', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const getGoal = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: goalView('disarmed') })
      .mockImplementationOnce(() => new Promise<RemoteResult<GoalView | undefined>>(() => {}))
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal,
      subscribeActivation: () => () => {},
      canRead: () => true,
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot().activation).toBe('disarmed')

    session.set({ running: true })
    expect(source.getSnapshot().activation).toBe('disarmed')
    dispose()
  })

  it('merges lifecycle edges and releases subscriptions with the last observer', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const getGoal = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: goalView('armed'),
    }))
    let emitActivation: ((goal: GoalActivationChanged['goal']) => void) | undefined
    let emitReset: (() => void) | undefined
    const disposeProjection: Array<() => void> = []
    const disposeSession: Array<() => void> = []
    const source = createGoalActivationSource({
      projection: {
        getSnapshot: () => projectionStore.getSnapshot(),
        subscribe: (listener) => {
          disposeProjection.push(listener)
          return projectionStore.subscribe(listener)
        },
      },
      session: {
        getSnapshot: () => session.getSnapshot(),
        subscribe: (listener) => {
          disposeSession.push(listener)
          return session.subscribe(listener)
        },
      },
      getGoal,
      subscribeActivation: (listener) => {
        emitActivation = listener
        return () => { emitActivation = undefined }
      },
      canRead: () => true,
      subscribeReset: (listener) => {
        emitReset = listener
        return () => { emitReset = undefined }
      },
    })

    const first = source.subscribe(() => {})
    const second = source.subscribe(() => {})
    emitActivation?.({ id: GOAL_ID, revision: 1, activation: 'disarmed' })
    emitActivation?.({ id: GOAL_ID, revision: 1, activation: 'disarmed' })
    emitActivation?.(undefined)
    emitActivation?.({ id: GOAL_ID, revision: 1, activation: 'armed' })
    projectionStore.set(null)
    session.set({ running: false })
    session.set({ running: true })
    await Promise.resolve()
    emitReset?.()
    await Promise.resolve()
    projectionStore.set(projection())
    await Promise.resolve()

    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1, activation: 'armed' })
    expect(disposeProjection.length).toBeGreaterThan(0)
    expect(disposeSession.length).toBeGreaterThan(0)
    first()
    expect(emitActivation).toBeDefined()
    second()
    expect(emitActivation).toBeUndefined()
    expect(emitReset).toBeUndefined()
  })

  it('leaves the ref unarmed when an authoritative read fails', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal: () => Promise.resolve({
        ok: false,
        error: new RemoteError('gateway/internal', 'no', {}),
      }),
      subscribeActivation: () => () => {},
      canRead: () => true,
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1 })
    expect(source.getSnapshot().activation).toBeUndefined()
    dispose()
  })

  it('does not republish an unchanged active ref or an already-empty projection', async () => {
    const emptyProjection = createSnapshotStore<GoalProjection | null | undefined>(null)
    const emptySession = createSnapshotStore({ running: false })
    const emptySource = createGoalActivationSource({
      projection: emptyProjection,
      session: emptySession,
      getGoal: () => Promise.resolve({ ok: true, value: undefined }),
      subscribeActivation: () => () => {},
      canRead: () => true,
      subscribeReset: () => () => {},
    })
    const emptyDispose = emptySource.subscribe(() => {})
    expect(emptySource.getSnapshot()).toEqual({})
    emptyDispose()

    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal: () => Promise.resolve({ ok: true, value: goalView('armed') }),
      subscribeActivation: () => () => {},
      canRead: () => true,
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    let notifications = 0
    const disposeObserver = source.subscribe(() => { notifications++ })
    projectionStore.set(projection())
    await Promise.resolve()
    expect(notifications).toBe(0)
    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1, activation: 'armed' })
    disposeObserver()
    dispose()
  })
})

it('withdraws activation without unsupported probes and rejects late reads or activation events', async () => {
  let readable = true
  let reset!: () => void
  let event!: (goal: GoalActivationChanged['goal']) => void
  const old = Promise.withResolvers<RemoteResult<GoalView | undefined>>()
  const getGoal = vi.fn().mockImplementationOnce(() => old.promise)
    .mockResolvedValue({ ok: true, value: goalView('disarmed') })
  const source = createGoalActivationSource({
    projection: createSnapshotStore<GoalProjection | null | undefined>(projection()),
    session: createSnapshotStore({ running: false }),
    canRead: () => readable,
    getGoal,
    subscribeReset: (listener) => { reset = listener; return () => {} },
    subscribeActivation: (listener) => { event = listener; return () => {} },
  })
  const dispose = source.subscribe(() => {})
  event({ id: GOAL_ID, revision: 1, activation: 'armed' })
  expect(source.getSnapshot().activation).toBe('armed')
  readable = false
  reset()
  expect(source.getSnapshot().activation).toBeUndefined()
  expect(getGoal).toHaveBeenCalledTimes(1)
  event({ id: GOAL_ID, revision: 1, activation: 'armed' })
  old.resolve({ ok: true, value: goalView('armed') })
  await Promise.resolve()
  expect(source.getSnapshot().activation).toBeUndefined()
  readable = true
  reset()
  await Promise.resolve()
  expect(source.getSnapshot().activation).toBe('disarmed')
  expect(getGoal).toHaveBeenCalledTimes(2)
  dispose()
})

it('contains a rejected transport read without publishing activation', async () => {
  const source = createGoalActivationSource({
    projection: createSnapshotStore<GoalProjection | null | undefined>(projection()),
    session: createSnapshotStore({ running: false }),
    canRead: () => true,
    getGoal: () => Promise.reject(new Error('transport rejected')),
    subscribeReset: () => () => {}, subscribeActivation: () => () => {},
  })
  const dispose = source.subscribe(() => {})
  await Promise.resolve()
  expect(source.getSnapshot().activation).toBeUndefined()
  dispose()
})

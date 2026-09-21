import { describe, expect, it, vi } from 'vitest'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { GoalRef } from '@deepseek-ai/dsh-goal/client'
import type { GoalActionResult } from '../src/client/slots.ts'
import { createGoalAccessSource } from '../src/client/access-source.ts'

const CAPABILITIES = ['goal.read.v1', 'goal.edit.v1', 'goal.pause.v1', 'goal.resume.v1', 'goal.clear.v1']
const REF = { id: 'goal-1' as GoalRef['id'], revision: 3 }

function bench(capabilities: readonly string[] = CAPABILITIES) {
  let host: RemoteHostFacts = { home: undefined, platform: undefined, isLoopback: true, capabilities }
  let alive = true
  const listeners = new Set<() => void>()
  const request = vi.fn<() => Promise<GoalActionResult>>(() => Promise.resolve({ ok: true, value: undefined }))
  const ref = vi.fn(() => REF)
  const source = createGoalAccessSource({
    host: () => host,
    alive: () => alive,
    subscribeGeneration: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    ref,
    edit: request, pause: request, resume: request, clear: request,
    connectionChanged: () => 'connection changed', requestFailed: () => 'request failed',
  })
  const replace = (next: readonly string[] = CAPABILITIES) => {
    host = { ...host, capabilities: next }
    for (const listener of listeners) listener()
  }
  return { source, request, ref, replace, listeners, dispose: () => { alive = false } }
}

describe('Goal access snapshots', () => {
  it('withholds all actions without a read capability and keeps a stable snapshot', () => {
    const b = bench(CAPABILITIES.filter(id => id !== 'goal.read.v1'))
    const snapshot = b.source.getSnapshot()
    expect(snapshot).toMatchObject({ readable: false, actions: {} })
    expect(b.source.getSnapshot()).toBe(snapshot)
    expect(b.request).not.toHaveBeenCalled()
  })

  it.each([
    ['goal.edit.v1', 'onEdit'], ['goal.pause.v1', 'onPause'], ['goal.resume.v1', 'onResume'], ['goal.clear.v1', 'onClear'],
  ] as const)('withholds only %s when the other actions remain supported', (capability, action) => {
    const b = bench(CAPABILITIES.filter(id => id !== capability))
    const snapshot = b.source.getSnapshot()
    expect(snapshot.readable).toBe(true)
    expect(snapshot.actions[action]).toBeUndefined()
    expect(Object.keys(snapshot.actions)).toHaveLength(3)
    expect(b.request).not.toHaveBeenCalled()
  })

  it('withdraws subscribed authority and rejects a retained callback on an equally capable replacement', async () => {
    const b = bench()
    const old = b.source.getSnapshot()
    const listener = vi.fn()
    const dispose = b.source.subscribe(listener)
    b.replace()
    const current = b.source.getSnapshot()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(current.generation).not.toBe(old.generation)
    await expect(old.actions.onClear!()).resolves.toMatchObject({ ok: false, error: { code: 'goal-context-changed' } })
    expect(b.request).not.toHaveBeenCalled()
    expect(b.ref).not.toHaveBeenCalled()
    await expect(current.actions.onClear!()).resolves.toMatchObject({ ok: true })
    expect(b.request).toHaveBeenCalledExactlyOnceWith(REF)
    dispose()
    expect(b.listeners.size).toBe(0)
  })

  it.each(['success', 'failure'] as const)('does not accept old %s while a new-generation action can finish', async (outcome) => {
    const b = bench()
    const pending = Promise.withResolvers<GoalActionResult>()
    b.request.mockImplementationOnce(() => pending.promise)
    const old = b.source.getSnapshot().actions.onClear!()
    b.replace()
    await expect(b.source.getSnapshot().actions.onPause!()).resolves.toMatchObject({ ok: true })
    pending.resolve(outcome === 'success' ? { ok: true, value: undefined } : {
      ok: false, error: { code: 'no-current-goal', message: 'old failure' },
    })
    await expect(old).resolves.toMatchObject({ ok: false, error: { code: 'goal-context-changed' } })
    expect(b.request).toHaveBeenCalledTimes(2)
  })

  it('contains transport rejection, permits explicit retry, and rejects retained callbacks after disposal', async () => {
    const b = bench()
    const actions = b.source.getSnapshot().actions
    b.request.mockRejectedValueOnce(new Error('transport rejected'))
    await expect(actions.onPause!()).resolves.toMatchObject({ ok: false, error: { code: 'goal-request-failed' } })
    await expect(actions.onPause!()).resolves.toMatchObject({ ok: true })
    b.dispose()
    await expect(actions.onPause!()).resolves.toMatchObject({ ok: false, error: { code: 'goal-context-changed' } })
    expect(b.source.getSnapshot().actions).toEqual({})
    expect(b.request).toHaveBeenCalledTimes(2)
  })
})

/** Cancellation uses the target observed at the click, without retargeting pending requests. */
import { expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Session } from '../src/client/sessions/session.ts'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

it('keeps a pending cancellation bound to its original projection and captures the next click separately', async () => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  api.admission = ['session.cancel-turn.v1']
  const session = new Session(SessionId('cancel-target'), remote, { hostAdmission: () => api.admission })
  session.projections.apply('activeTurnStart', 4, SessionSeq(4))
  const receipt = deferred<ReturnType<typeof ok<{ accepted: true }>>>()
  api.onCancel = () => receipt.promise
  const cancelling = session.cancel()
  session.projections.apply('activeTurnStart', 12, SessionSeq(12))
  expect(api.callsOf('session.cancelTurn')).toEqual([{ sessionId: session.sessionId, turnStartSeq: 4 }])
  receipt.resolve(ok({ accepted: true }))
  await expect(cancelling).resolves.toEqual(ok({ accepted: true }))
  await session.cancel()
  expect(api.callsOf('session.cancelTurn')).toEqual([
    { sessionId: session.sessionId, turnStartSeq: 4 }, { sessionId: session.sessionId, turnStartSeq: 12 },
  ])
  expect(api.callsOf('session.cancel')).toEqual([])
  await session.dispose()
})

it('distinguishes an unavailable target from an explicitly idle projection', async () => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  api.admission = ['session.cancel-turn.v1']
  const session = new Session(SessionId('cancel-unready'), remote, { hostAdmission: () => api.admission })
  await expect(session.cancel()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
  expect(api.callsOf('session.cancelTurn')).toEqual([])
  expect(api.callsOf('session.cancel')).toEqual([])
  session.projections.apply('activeTurnStart', null, SessionSeq(7))
  await expect(session.cancel()).resolves.toEqual(ok({ accepted: true }))
  expect(api.callsOf('session.cancelTurn')).toEqual([{ sessionId: session.sessionId, turnStartSeq: null }])
  await session.dispose()
})

it('uses the legacy request only when the Host does not advertise targeted cancellation', async () => {
  const api = new FakeApiClient()
  const session = new Session(SessionId('cancel-legacy'), api.sessionRemotes(), { hostAdmission: () => api.admission })
  session.projections.apply('activeTurnStart', 4, SessionSeq(4))
  await expect(session.cancel()).resolves.toEqual(ok({ accepted: true }))
  expect(api.callsOf('session.cancel')).toEqual([{ sessionId: session.sessionId }])
  expect(api.callsOf('session.cancelTurn')).toEqual([])
  await session.dispose()
})

it('binds subagent interruption to the observed child turn without requiring parent availability', async () => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  api.admission = ['subagent.interrupt-turn.v1']
  const session = new Session(SessionId('child-target'), remote, { hostAdmission: () => api.admission })
  const address = { parentSessionId: SessionId('offline-parent'), childSessionId: session.sessionId, mode: 'continuable' as const }
  session.configureSubagent(address, false)
  session.projections.apply('subagentTiming', { settledMs: 0, active: { since: 10, through: 20, startSeq: SessionSeq(4) } }, SessionSeq(5))
  const receipt = deferred<ReturnType<typeof ok<{ accepted: true }>>>()
  api.onSubagentInterrupt = () => receipt.promise
  const cancelling = session.cancel()
  session.projections.apply('subagentTiming', { settledMs: 10, active: { since: 30, through: 30, startSeq: SessionSeq(12) } }, SessionSeq(12))
  expect(api.callsOf('subagents.interruptTurnByParent')).toEqual([{ ...address, turnStartSeq: 4 }])
  expect(api.callsOf('subagents.interruptByParent')).toEqual([])
  receipt.resolve(ok({ accepted: true }))
  await expect(cancelling).resolves.toEqual(ok({ accepted: true }))
  await session.cancel()
  expect(api.callsOf('subagents.interruptTurnByParent').at(-1)).toEqual({ ...address, turnStartSeq: 12 })
  await session.dispose()
})

it('does not replace missing subagent target facts with legacy interruption', async () => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  api.admission = ['subagent.interrupt-turn.v1', 'subagent.interrupt.v1']
  const session = new Session(SessionId('child-unready'), remote, { hostAdmission: () => api.admission })
  const address = { parentSessionId: SessionId('parent'), childSessionId: session.sessionId, mode: 'continuable' as const }
  session.configureSubagent(address, false)
  await expect(session.cancel()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
  session.projections.apply('subagentTiming', { settledMs: 0, active: { since: 1, through: 2 } }, SessionSeq(2))
  await expect(session.cancel()).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
  expect(api.callsOf('subagents.interruptTurnByParent')).toEqual([])
  expect(api.callsOf('subagents.interruptByParent')).toEqual([])
  session.projections.apply('subagentTiming', { settledMs: 1 }, SessionSeq(3))
  await expect(session.cancel()).resolves.toEqual(ok({ accepted: true }))
  expect(api.callsOf('subagents.interruptTurnByParent')).toEqual([{ ...address, turnStartSeq: null }])
  await session.dispose()
})

it('shares the newest discovery admission with resident Sessions and clears it on failure', async ({ onTestFinished }) => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  const manager = new SessionManager(remote)
  onTestFinished(() => manager.dispose())
  const session = manager.get(SessionId('cancel-discovery'))
  session.projections.apply('activeTurnStart', 4, SessionSeq(4))
  const stale = deferred<Awaited<ReturnType<typeof remote.host.describe>>>()
  remote.host.describe = () => stale.promise
  const refreshing = manager.refreshHostAdmission()

  api.admission = ['session.cancel-turn.v1']
  remote.host.describe = () => Promise.resolve(ok({ capabilities: api.admission }))
  await manager.refreshHostAdmission()
  stale.resolve(ok({ capabilities: [] }))
  await refreshing
  await session.cancel()
  expect(api.callsOf('session.cancelTurn')).toEqual([{ sessionId: session.sessionId, turnStartSeq: 4 }])
  expect(api.callsOf('session.cancel')).toEqual([])

  remote.host.describe = () => Promise.resolve(err(new RemoteError(
    'gateway/connection-unavailable', 'Host unavailable', { endpoint: 'host/describe' },
  )))
  await manager.refreshHostAdmission()
  await session.cancel()
  expect(api.callsOf('session.cancel')).toEqual([{ sessionId: session.sessionId }])
  expect(api.callsOf('session.cancelTurn')).toHaveLength(1)
})

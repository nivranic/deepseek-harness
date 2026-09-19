/** Subagent catalog and delivery state cannot adopt replies from a withdrawn Host. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { FakeApiClient, deferred, fakeRemote, ok } from './fake-api.client.ts'

const PARENT = 'catalog-parent' as SessionId
const CHILD = 'catalog-child' as SessionId
const ADDRESS = { parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable' as const }

describe('Subagent catalog generations', () => {
  it('does not probe an unsupported catalog and suppresses a withdrawn response', async () => {
    const api = new FakeApiClient()
    const reply = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    api.onSubagentList = () => reply.promise
    const manager = new SessionManager(fakeRemote(api))
    const pending = manager.refreshSubagents(PARENT)
    api.host = { ...api.host, capabilities: [] }
    manager.handleSubagentGenerationChanged()
    expect(manager.getListSnapshot().subagentsByParent).toEqual({})
    await manager.refreshSubagents(PARENT)
    expect(api.callsOf('subagents.list')).toHaveLength(1)
    reply.resolve(ok({ entries: [], parentAvailable: true }))
    await pending
    expect(manager.getListSnapshot().subagentsByParent).toEqual({})
    await manager.dispose()
  })

  it('does not let an old completion remove the replacement in-flight request', async () => {
    const api = new FakeApiClient()
    const first = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    const second = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    api.onSubagentList = () => first.promise
    const manager = new SessionManager(fakeRemote(api))
    const old = manager.refreshSubagents(PARENT)
    api.host = { ...api.host }
    manager.handleSubagentGenerationChanged()
    api.onSubagentList = () => second.promise
    const current = manager.refreshSubagents(PARENT)
    first.resolve(ok({ entries: [], parentAvailable: true }))
    await old
    expect(manager.refreshSubagents(PARENT)).toBe(current)
    expect(manager.getListSnapshot().subagentsByParent[PARENT]?.state).toBe('loading')
    second.resolve(ok({ entries: [], parentAvailable: false }))
    await current
    expect(manager.getListSnapshot().subagentsByParent[PARENT]?.parentAvailable).toBe(false)
    expect(api.callsOf('subagents.list')).toHaveLength(2)
    await manager.dispose()
  })

  it('retains a selected child and its Session while withdrawing its parent availability hint', async () => {
    const api = new FakeApiClient()
    api.onSubagentList = () => Promise.resolve(ok({ entries: [], parentAvailable: true }))
    const manager = new SessionManager(fakeRemote(api), CHILD, ADDRESS)
    const session = manager.get(CHILD)
    await manager.refreshSubagents(PARENT)
    expect(session.getSnapshot().subagent?.parentAvailable).toBe(true)
    api.host = { ...api.host, capabilities: [] }
    manager.handleSubagentGenerationChanged()
    expect(manager.get(CHILD)).toBe(session)
    expect(manager.getListSnapshot().currentAddress).toEqual(ADDRESS)
    expect(session.getSnapshot().subagent).toEqual({ address: ADDRESS })
    await manager.dispose()
  })

  it('does not publish a catalog after manager disposal', async () => {
    const api = new FakeApiClient()
    const reply = deferred<Awaited<ReturnType<FakeApiClient['onSubagentList']>>>()
    api.onSubagentList = () => reply.promise
    const manager = new SessionManager(fakeRemote(api))
    const pending = manager.refreshSubagents(PARENT)
    await manager.dispose()
    reply.resolve(ok({ entries: [], parentAvailable: true }))
    await pending
    expect(manager.getListSnapshot().subagentsByParent).toEqual({})
    await manager.refreshSubagents(PARENT)
    expect(api.callsOf('subagents.list')).toHaveLength(1)
  })
})

it('drops old addressed prompt and interrupt acknowledgments without publishing promptError', async () => {
  const api = new FakeApiClient()
  const prompt = deferred<Awaited<ReturnType<FakeApiClient['onSubagentPrompt']>>>()
  const interrupt = deferred<Awaited<ReturnType<FakeApiClient['onSubagentInterrupt']>>>()
  api.onSubagentPrompt = () => prompt.promise
  api.onSubagentInterrupt = () => interrupt.promise
  const manager = new SessionManager(fakeRemote(api), CHILD, ADDRESS)
  const session = manager.get(CHILD)
  const sending = session.prompt([{ type: 'text', text: 'keep the draft' }], 'queue')
  const stopping = session.cancel()
  api.host = { ...api.host }
  manager.handleSubagentGenerationChanged()
  prompt.resolve(ok({ messageId: 'accepted-old' as never }))
  interrupt.resolve(ok({ accepted: true }))
  await expect(sending).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
  await expect(stopping).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
  expect(session.getSnapshot().promptError).toBeNull()
  await manager.dispose()
})

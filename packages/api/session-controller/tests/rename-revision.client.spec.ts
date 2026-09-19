/** Editing callbacks retain their title revision through changes and retries. */
import { expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { Session } from '../src/client/sessions/session.ts'
import { FakeApiClient, ok } from './fake-api.client.ts'

it('retains the editing baseline after later title updates and uses a fresh revision for a new editor', async () => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  Object.assign(remote.$host, { capabilities: ['session.rename-at.v1'] })
  const session = new Session(SessionId('rename-baseline'), remote)
  session.projections.seed({ asOfSeq: SessionSeq(30), values: { titleRevision: 4, title: 'Original' } })
  const submit = session.prepareRename()
  session.projections.apply('titleRevision', 40, SessionSeq(40))
  session.projections.apply('title', 'Other editor', SessionSeq(40))
  api.onRename = () => Promise.resolve(ok({ title: 'Accepted', seq: 5 }))
  await submit('Accepted')
  await submit('Accepted')
  expect(api.callsOf('session.renameAt')).toEqual(Array.from({ length: 2 }, () => ({
    sessionId: session.sessionId, title: 'Accepted', expectedRevision: 4,
  })))
  expect(session.projections.values().title).toBe('Other editor')
  expect(session.projections.values().titleRevision).toBe(40)
  await session.prepareRename()('Next')
  expect(api.callsOf('session.renameAt').at(-1)).toMatchObject({ expectedRevision: 40 })
  expect(api.callsOf('session.rename')).toEqual([])
  await session.dispose()
})

it('keeps missing revision distinct from null and never silently upgrades an unready editor', async () => {
  const api = new FakeApiClient()
  const remote = api.sessionRemotes()
  Object.assign(remote.$host, { capabilities: ['session.rename-at.v1'] })
  const session = new Session(SessionId('rename-unready'), remote)
  const submit = session.prepareRename()
  session.projections.apply('titleRevision', null, SessionSeq(0))
  await expect(submit('Title')).resolves.toMatchObject({ ok: false, error: { code: 'gateway/connection-unavailable' } })
  expect(api.callsOf('session.renameAt')).toEqual([])
  await session.prepareRename()('Title')
  expect(api.callsOf('session.renameAt')).toEqual([{ sessionId: session.sessionId, title: 'Title', expectedRevision: null }])
  await session.dispose()
})

it('uses the legacy method for Hosts without conditional rename', async () => {
  const api = new FakeApiClient()
  const session = new Session(SessionId('rename-legacy'), api.sessionRemotes())
  await session.prepareRename()('Title')
  expect(api.callsOf('session.rename')).toEqual([{ sessionId: session.sessionId, title: 'Title' }])
  expect(api.callsOf('session.renameAt')).toEqual([])
  await session.dispose()
})

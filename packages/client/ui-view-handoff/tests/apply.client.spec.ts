/** Registered handoff operations retain the addressed Session before publishing navigation. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createScope, MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionBinding, SessionReference, SessionRetainOptions, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { HostDescriptor, HostId } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-chat/src/client/contract/snapshot.ts'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Session } from '../../../api/session-controller/src/client/sessions/session.ts'
import { FakeApiClient } from '../../../api/session-controller/tests/fake-api.client.ts'
import { apply, inject, type HandoffActionInjected } from '../src/client/index.ts'
import type { HandoffNoticeInjected } from '../src/client/HandoffNotice.tsx'
import { encodeSessionViewLocation } from '../src/client/view-location.ts'

const SID = SessionId('received-session')
const HOST: HostDescriptor = {
  hostId: 'handoff-host' as HostId, displayName: 'Fixture Host', productVersion: 'fixture',
  apiProtocolVersion: 1, sessionFormatVersion: 4, platform: 'linux', arch: 'x64',
  runtimeMode: 'full', capabilities: [], transports: ['http'], serverTime: 0,
}

it.each(['matching', 'missing-turn', 'missing-chat'] as const)
('registers capture and receive operations with a %s conversation', async (mode) => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); vi.unstubAllGlobals() })
  const writeText = vi.fn(async (_text: string) => {})
  const location = { origin: 'https://host.example', pathname: '/app',
    hash: `#dsh-view=${encodeSessionViewLocation({ hostId: HOST.hostId, sessionId: SID, anchorSeq: SessionSeq(41) })}` }
  vi.stubGlobal('location', location)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await ctx.plugin(SlotRegistry)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const generations = createSnapshotStore<ConnectionGeneration | undefined>({ id: 1, host: { home: '/fixture' } })
  ctx.provide('connection', { generation: generations })
  new TestRemote(ctx, { host: { describe: async () => ({ ok: true, value: HOST }) } })
  const session = new Session(SID, new FakeApiClient().sessionRemotes())
  onTestFinished(() => session.dispose())
  const loadThrough = vi.spyOn(session, 'loadThrough')
  const binding: SessionBinding = {
    sessionId: SID, session, ctx: createScope(ctx, SID).ctx, eventSource: new MutableSessionEventSource(),
  }
  const reference: SessionReference = {
    sessionId: SID, binding, ready: Promise.resolve(binding), release() {}, [Symbol.dispose]() {},
  }
  const retained: SessionRetainOptions[] = []
  const refresh = vi.fn(async () => {})
  const using = async <T>(target: SessionTarget, options: SessionRetainOptions,
    operation: (reference: SessionReference) => T | Promise<T>): Promise<T> => {
    expect(target).toBe(SID)
    retained.push(options)
    return await operation(reference)
  }
  ctx.provide('sessions', { refresh, using })
  const turn: TurnLocation = {
    turn: 3, status: 'open', steps: [],
    start: { type: 'turn/start', seq: SessionSeq(mode === 'matching' ? 41 : 42), time: 0, data: { turn: 3 } },
    end: undefined, data: { get: () => undefined, source: () => createSnapshotStore(undefined) },
  }
  const chat = {
    ...EMPTY_CHAT_SNAPSHOT,
    timeline: { turnOrder: [3], turns: new Map([[3, turn], [4, { ...turn, turn: 4, start: undefined }]]) },
  }
  const activate = vi.fn()
  const openView = vi.fn()
  const openSession = vi.fn()
  ctx.provide('uiWorkspace', { openSession })
  ctx.provide('uiConversation', {
    binding: () => ({ activate, snapshot: createSnapshotStore({ views: { get: () => mode === 'missing-chat' ? undefined : chat } }) }),
    openView,
  })
  const slots = ctx.slots
  slots.register({ name: 'root', children: {
    'conversation.session.header.actions': { kind: 'list', scope: 'agent' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const owner = await ctx.plugin({ inject, apply })
  const capture = slots.entries('conversation.session.header.actions')[0]!.inject!() as HandoffActionInjected & Record<string, unknown>
  const notice = slots.entries('shell.overlay')[0]!.inject!() as HandoffNoticeInjected & Record<string, unknown>
  if (mode === 'matching') {
    await vi.waitFor(() => { expect(openSession).toHaveBeenCalledWith(SID) })
    expect(openView).toHaveBeenCalledWith(binding, 'chat', 'turn:3')
  } else {
    await vi.waitFor(() => { expect(notice.hooks.failure.getSnapshot()).toBe('openFailed') })
    expect(openSession).not.toHaveBeenCalled()
    expect(openView).not.toHaveBeenCalled()
    notice.dismiss()
    expect(notice.hooks.failure.getSnapshot()).toBeUndefined()
  }
  expect(refresh).toHaveBeenCalledOnce()
  expect(loadThrough).toHaveBeenCalledWith(41)
  expect(activate).toHaveBeenCalledWith('chat')
  expect(retained).toHaveLength(1)
  expect(retained[0]?.source).toBe('viewHandoff')
  expect(retained[0]?.signal).toBeInstanceOf(AbortSignal)
  const payload = capture.encode(SID, SessionSeq(41))!
  const link = capture.buildLink(payload)
  expect(link).toBe(`https://host.example/app#dsh-view=${payload}`)
  await expect(capture.copy(link)).resolves.toBe(true)
  expect(writeText).toHaveBeenCalledWith(link)
  await owner.dispose()
  expect(slots.entries('shell.overlay')).toHaveLength(0)
  expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
})

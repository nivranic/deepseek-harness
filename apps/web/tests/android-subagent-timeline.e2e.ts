/** Installed native child history uses the selected parent's durable address without activating child Agents. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type { SessionFollowRequest, SessionPageRequest } from '@deepseek-ai/dsh-api-session-controller'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { compareOrRefreshGolden, launchWebScaffold, readPersistedEvents, seedSession, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android reads selected-parent cold child history and retires its view', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const calls: string[] = []
  const catalogs: unknown[] = []
  const follows: SessionFollowRequest[] = []
  const pages: SessionPageRequest[] = []
  let refuseCatalog = false
  let refusePage = false
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const unarySpy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
    const endpoint = `${request.namespace}/${request.method}`
    calls.push(endpoint)
    if (endpoint === 'subagents/list') {
      catalogs.push(request.args.parentSessionId)
      if (refuseCatalog) throw new RemoteError('gateway/internal', 'fixture catalog unavailable', {})
    }
    if (endpoint === 'session/page') {
      pages.push(request.args.request as SessionPageRequest)
      if (refusePage) throw new RemoteError('gateway/internal', 'fixture page unavailable', {})
    }
    return invoke(request)
  })
  const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
  const streamSpy = vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation((request) => {
    if (request.namespace === 'session' && request.method === 'follow') follows.push(request.args.request as SessionFollowRequest)
    return stream(request)
  })
  const activationSpy = vi.spyOn(scaffold.ctx.sessionController, 'resolveAgent')
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'CHILD_PARENT', title: 'Native child parent', turns: 1 })
    const firstParent = await seedSession(scaffold, fixture.log, 'native-first-parent', undefined, { createdAt: Date.now() - 10_000 })
    const selectedParent = await seedSession(scaffold, fixture.log, 'native-selected-parent', undefined, { createdAt: Date.now() - 90_000 })
    const seedChild = async (parent: SessionId, id: string, messages: number) => {
      const header: SessionHeader = {
        version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: Date.now() - 120_000,
        isSeeded: false, cwd: scaffold.workspaceCwd, parentSession: parent, origin: 'subagent', delegationDepth: 1,
      }
      const events: SessionEvent[] = [
        { type: 'subagent/descriptor', seq: SessionSeq(0), time: header.createdAt, data: snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn', label: id }) },
        { type: 'turn/start', seq: SessionSeq(1), time: header.createdAt + 1, data: { turn: 1 } },
      ]
      for (let index = 0; index < messages; index++) events.push({
        type: 'user/message', seq: SessionSeq(events.length), time: header.createdAt + events.length,
        data: createUserMessage({ content: [{ type: 'text', text: `${id} saved message ${index}` }], source: { kind: 'user' } }), surfaceOp: 'append',
      })
      events.push({ type: 'turn/end', seq: SessionSeq(events.length), time: header.createdAt + events.length, data: { turn: 1, reason: { kind: 'completed' } } })
      const handle = await scaffold.ctx.sessionPersistence.create(header)
      try { await handle.append(events) } finally { await handle.close() }
      scaffold.ctx.sessionProjectionCache.coldSnapshot(header, SessionLogOffset(0), events)
      await expect.poll(() => scaffold.ctx.sessionProjectionCache.cachedSnapshot(header, SessionLogOffset(0)), {
        timeout: 10_000,
      }).toBeDefined()
      return header.id
    }
    const firstChild = await seedChild(firstParent, 'native-other-child', 3)
    const child = await seedChild(selectedParent, 'native-cold-child', 75)
    const secondChild = await seedChild(selectedParent, 'native-second-child', 3)
    const persisted = await readPersistedEvents(scaffold, child)
    const listing = await scaffold.ctx.sessionController.list({}, new AbortController().signal)
    expect(listing.items[0]?.sessionId).toBe(firstParent)
    expect(scaffold.ctx.agents.get(selectedParent)).toBeUndefined()
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, stage).toMatchObject({ type: 'ok' })
      return result.value
    }
    const capture = async (name: string) => {
      const value = await command({ op: 'screenshot' })
      if (typeof value !== 'string') throw new Error('Native screenshot must be base64 text')
      const directory = fileURLToPath(new URL('../../../.artifacts/android-subagent-timeline-ui/', import.meta.url))
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, name), Buffer.from(value, 'base64'))
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'subagentCatalog', state: 'no-parent' })
    expect(catalogs).toEqual([])
    await command({ op: 'openSession', sessionId: selectedParent })
    await expect.poll(() => scaffold.ctx.agents.get(selectedParent), { timeout: 10_000 }).toBeDefined()
    stage = 'selected-parent-catalog'
    expect(await command({ op: 'subagentCatalog', state: 'ready', rows: [child, secondChild] })).toEqual({
      parent: selectedParent, parentAvailable: true, rows: [child, secondChild],
    })
    expect(catalogs).toEqual([selectedParent])
    await capture('selected-parent.png')
    stage = 'cold-child-read'
    await command({ op: 'openSubagent', child, text: `${child} saved message 74` })
    await capture('cold-child.png')
    refusePage = true
    await command({ op: 'childPageFailure' })
    await capture('child-page-failure.png')
    refusePage = false
    await command({ op: 'childReconnect' })
    expect(await command({ op: 'childLoadOlder' })).toBe(0)
    expect(pages).toHaveLength(2)
    expect(pages[0]?.address).toEqual({ kind: 'subagent', parentSessionId: selectedParent, childSessionId: child, mode: 'one-shot' })
    expect(pages[0]?.throughSeq).toBe(persisted.at(-1)?.seq)
    await command({ op: 'childBack' })
    stage = 'catalog-failure-and-recovery'
    refuseCatalog = true
    expect(await command({ op: 'subagentCatalog', state: 'failed', refresh: true })).toEqual({
      parent: selectedParent, parentAvailable: true, rows: [child, secondChild],
    })
    await capture('catalog-failure.png')
    refuseCatalog = false
    await command({ op: 'subagentCatalog', state: 'ready', refresh: true })
    await command({ op: 'openSubagent', child: secondChild, text: `${secondChild} saved message 2` })
    stage = 'parent-switch'
    await command({ op: 'openSession', sessionId: firstParent })
    await expect.poll(() => scaffold.ctx.agents.get(firstParent), { timeout: 10_000 }).toBeDefined()
    expect(await command({ op: 'subagentCatalog', state: 'ready', rows: [firstChild] })).toEqual({ parent: firstParent, parentAvailable: true, rows: [firstChild] })
    await command({ op: 'openSubagent', child: firstChild, text: `${firstChild} saved message 2` })
    await capture('other-parent-child.png')
    await command({ op: 'childBack' })
    expect(follows.filter(request => request.address.kind === 'subagent').map(request => request.address)).toEqual([
      { kind: 'subagent', parentSessionId: selectedParent, childSessionId: child, mode: 'one-shot' },
      { kind: 'subagent', parentSessionId: selectedParent, childSessionId: child, mode: 'one-shot' },
      { kind: 'subagent', parentSessionId: selectedParent, childSessionId: secondChild, mode: 'one-shot' },
      { kind: 'subagent', parentSessionId: firstParent, childSessionId: firstChild, mode: 'one-shot' },
    ])
    expect(activationSpy.mock.calls.every(([id]) => id === firstParent || id === selectedParent)).toBe(true)
    expect([child, secondChild, firstChild].map(id => scaffold.ctx.agents.get(id))).toEqual(Array.from({ length: 3 }, () => undefined))
    expect(await readPersistedEvents(scaffold, child)).toEqual(persisted)
    expect(calls.filter(endpoint => ['prompt', 'cancel', 'create', 'handoff', 'interrupt', 'reply'].includes(endpoint.split('/')[1]!))).toEqual([])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-subagent-timeline.expected.md', import.meta.url)), [
      '# Android selected-parent child history', '',
      '- No selected Session means no catalog request.',
      '- The selected parent differs from the first Session row; only its stored children appear.',
      '- Ordinary parent follows retain Host promotion policy; direct child histories remain cold.',
      '- The child view displays persisted messages with no composer or cancellation controls.',
      '- Backward paging retains the child address and original log cut.',
      '- Failed paging retains visible history; explicit reconnect and a new page recover.',
      '- Catalog failure preserves the selected parent rows; explicit refresh recovers.',
      '- Returning, opening another child and switching parents display only the selected history.',
      '- No child Agent activates, no business mutation dispatches and persisted child events stay unchanged.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android subagent stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    activationSpy.mockRestore(); unarySpy.mockRestore(); streamSpy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android subagent timeline acceptance failed')
}, 180_000)

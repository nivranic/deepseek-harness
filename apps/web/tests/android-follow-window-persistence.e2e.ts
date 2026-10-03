/** The persisted follow window survives process death and reopens with its resume cursor. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type { SessionFollowFrame, SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android reopens a persisted follow window after process death', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const snapshots: Extract<SessionFollowFrame, { type: 'snapshot' }>[] = []
  const requests: SessionFollowRequest[] = []
  const mutations: string[] = []
  const stream = scaffold.ctx.typertGateway.stream.bind(scaffold.ctx.typertGateway)
  const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
  const followSpy = vi.spyOn(scaffold.ctx.typertGateway, 'stream').mockImplementation(async (request) => {
    if (request.namespace !== 'session' || request.method !== 'follow') return stream(request)
    requests.push(request.args.request as SessionFollowRequest)
    return (async function* () {
      for await (const frame of await stream(request)) {
        const snapshot = frame as SessionFollowFrame
        if (snapshot.type === 'snapshot') snapshots.push(snapshot)
        yield frame
      }
    })()
  })
  const invokeSpy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation((request) => {
    if (['prompt', 'create', 'handoff', 'cancel', 'reply'].includes(request.method)) mutations.push(`${request.namespace}/${request.method}`)
    return invoke(request)
  })
  let stage = 'seed'
  const lastOp = { name: 'none' }
  const command = async (request: object) => {
    lastOp.name = (request as { op?: string }).op ?? 'unknown'
    const result = await driver!.request(request)
    expect(result, `${stage}/${lastOp.name}: ${JSON.stringify(result)}`).toMatchObject({ type: 'ok' })
    return result.value
  }
  /** A restored process starts its list at the top, so the first window assertion scrolls
   * the whole retained window; the driver's per-request timer can drop that slow response
   * while the operation still completes server-side — one retry then observes the settled list. */
  const windowWithRetry = async (args: { first: unknown; last: unknown; attempts: unknown }) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return await command({ op: 'assertSessionWindow', ...args }) } catch (error) {
        if (attempt === 2 || !String(error).includes('timed out')) throw error
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
    }
    throw new Error('unreachable')
  }
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_WINDOW', title: 'Native persisted window', turns: 30 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-follow-window')
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    const session = scaffold.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('native window fixture has no live Session')
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text: 'Unsent across process death' })
    const first = await command({ op: 'loadOlderHistory' })
    expect(snapshots).toHaveLength(1)
    expect(requests[0]?.fromSeq).toBeUndefined()
    const cursor = snapshots[0]!.cursor
    stage = 'appends-during-interruption'
    const appended = 3
    for (let index = 0; index < appended; index++) {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `RESTARTED_${index}` }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }
    await scaffold.ctx.sessions.flush(session)
    stage = 'process-death'
    await driver.kill()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, false)
    await command({ op: 'assertRestored' })
    stage = 'reopened-window'
    await command({ op: 'openSession', sessionId })
    await expect.poll(() => snapshots.length, { timeout: 20_000 }).toBe(2)
    expect(requests[1]?.fromSeq).toBe(cursor)
    const resumed = snapshots[1]!
    expect(resumed.records.length).toBe(appended)
    expect(resumed.records[0]!.event.seq).toBe(cursor + 1)
    expect(resumed.cursor).toBe(cursor + appended)
    await windowWithRetry({ first, last: resumed.cursor, attempts: 1 })
    await command({ op: 'assertPromptDraft', text: 'Unsent across process death' })
    expect(mutations).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-follow-window/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/restarted.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-follow-window.expected.md', import.meta.url)), [
      '# Android persisted follow window across process death', '',
      '- A real Host serves a seeded Session; Android loads one older history page before the process is killed.',
      '- The first request has no cursor; after process death the reopened request carries the persisted durable sequence.',
      '- The Host returns only the three records appended during the interruption; the persisted older page folds back without a gap or duplicate.',
      '- Unsent input, the single device grant, and the displayed first row survive the restart.',
      '- Reopening sends no prompt, creation, cancellation, reply, or runtime Handoff mutation.',
      '- This scenario qualifies process-death persistence, not physical network loss or foreground recovery.',
    ].join('\n'), MODE)
  } catch (error) {
    console.info('Android persisted window stage', stage, 'lastOp', lastOp.name,
      'requests', JSON.stringify(requests.map((request, index) => ({ index, fromSeq: request.fromSeq ?? null }))),
      'snapshots', JSON.stringify(snapshots.map((snapshot, index) => ({ index, cursor: snapshot.cursor, first: snapshot.records[0]?.event.seq ?? null, length: snapshot.records.length }))))
    failures.push(error)
  }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    followSpy.mockRestore(); invokeSpy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android persisted window failed')
}, 300_000)

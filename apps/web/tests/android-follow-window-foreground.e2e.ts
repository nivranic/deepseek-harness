/** The persisted follow window survives a backgrounded carrier loss and presents intact on foreground return. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { symbols } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type { SessionFollowFrame, SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

/** Host-plane carrier-hygiene surface used by this lane to destroy the device's transport. */
interface GatewayHostPlane {
  terminateDeviceConnections(request: { deviceId: string }): { terminated: number }
}

/** Foreground snapshot fields read while the application is backgrounded. */
interface ForegroundSnapshot {
  lifecycle: string
  focused: boolean
  windowPackage: string | null
}

const MODE = webSnapshotMode()
const APPLICATION = 'com.deepseek.harness.companion.nativeacceptance'
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android presents the persisted follow window intact after a backgrounded carrier loss', async () => {
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
  const receiver = scaffold.ctx.typertGateway as unknown as GatewayHostPlane & { [symbols.original]?: GatewayHostPlane }
  const gateway = receiver[symbols.original] ?? receiver
  let stage = 'seed'
  const lastOp = { name: 'none' }
  const command = async (request: object) => {
    lastOp.name = (request as { op?: string }).op ?? 'unknown'
    const result = await driver!.request(request)
    expect(result, `${stage}/${lastOp.name}: ${JSON.stringify(result)}`).toMatchObject({ type: 'ok' })
    return result.value
  }
  /** A whole-window assertion scrolls the retained list; the driver's per-request timer can drop
   * that slow response while the operation still completes server-side, and on deeper windows the
   * Compose scroll verifier itself can bail after the window facts already match — both are
   * re-observation classes, so a bounded retry ladder settles them (process-death lane lesson). */
  const windowWithRetry = async (args: { first: unknown; last: unknown; attempts: unknown }) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await command({ op: 'assertSessionWindow', ...args }) } catch (error) {
        const text = String(error)
        if (attempt === 3 || (!text.includes('timed out') && !text.includes('session-window-scroll'))) throw error
        await new Promise(resolve => setTimeout(resolve, 3_000 * attempt))
      }
    }
    throw new Error('unreachable')
  }
  const foreground = async (): Promise<ForegroundSnapshot> => await command({ op: 'foregroundSnapshot' }) as ForegroundSnapshot
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_FOREGROUND', title: 'Native foreground window', turns: 30 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-follow-foreground')
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    const session = scaffold.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('native foreground fixture has no live Session')
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
    const deviceId = scaffold.ctx.deviceTrust.listDevices()[0]!.deviceId
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text: 'Unsent across a backgrounded carrier loss' })
    const first = await command({ op: 'loadOlderHistory' })
    expect(snapshots).toHaveLength(1)
    expect(requests[0]?.fromSeq).toBeUndefined()
    const cursor = snapshots[0]!.cursor
    const appendRecords = async (marker: string, count: number) => {
      for (let index = 0; index < count; index++) {
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: `${marker}_${index}` }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
      }
      await scaffold.ctx.sessions.flush(session)
    }
    stage = 'pre-background-appends'
    await appendRecords('BEFORE_BACKGROUND', 3)
    stage = 'pre-background-window'
    await windowWithRetry({ first, last: cursor + 3, attempts: 1 })
    stage = 'background'
    await command({ op: 'systemHome' })
    await expect.poll(async () => (await foreground()).lifecycle, { timeout: 20_000 }).toBe('CREATED')
    const backgrounded = await foreground()
    expect(backgrounded.focused, 'the application lost window focus').toBe(false)
    expect(backgrounded.windowPackage, 'another package owns the window').not.toBe(APPLICATION)
    stage = 'backgrounded-carrier-loss'
    const terminated = gateway.terminateDeviceConnections({ deviceId })
    expect(terminated.terminated, 'the Host destroyed the device carrier while backgrounded').toBeGreaterThanOrEqual(1)
    stage = 'backgrounded-reopen'
    await expect.poll(() => requests.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
    expect(requests[1]?.fromSeq, 'the backgrounded process re-opened follow with its durable cursor').toBe(cursor + 3)
    stage = 'backgrounded-appends'
    await appendRecords('WHILE_BACKGROUND', 3)
    stage = 'foreground-return'
    await driver.bringToFront()
    await expect.poll(async () => {
      const current = await foreground()
      return current.lifecycle === 'RESUMED' && current.focused && current.windowPackage === APPLICATION
    }, { timeout: 20_000 }).toBe(true)
    stage = 'foreground-window'
    await windowWithRetry({ first, last: cursor + 6, attempts: 2 })
    await command({ op: 'assertPromptDraft', text: 'Unsent across a backgrounded carrier loss' })
    expect(mutations).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-follow-window/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/foreground.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-follow-window-foreground.expected.md', import.meta.url)), [
      '# Android persisted follow window across a backgrounded carrier loss', '',
      '- A real Host serves a seeded Session; Android loads one older history page and three further records before backgrounding.',
      '- While the application holds no window focus, the Host-side terminateDeviceConnections primitive destroys its stream carrier; the backgrounded process re-opens follow on its own with the last applied durable sequence.',
      '- Three records appended while backgrounded are consumed by the re-attached background follower, so the cursor advances without the UI; a plain launcher return brings the same singleTask application back without routing any intent.',
      '- On foreground return the merged window keeps the retained older page and all six appended records contiguously — no full Session re-download; unsent input and the single device grant survive; no prompt, creation, cancellation, reply, or runtime Handoff mutation is sent.',
      '- This scenario qualifies backgrounded reconnect and foreground presentation for the persisted window; a healthy background round-trip by design produces no new follow request, OS background-kill behaviors, FCM delivery, and real devices remain unqualified.',
    ].join('\n'), MODE)
  } catch (error) {
    console.info('Android foreground window stage', stage, 'lastOp', lastOp.name,
      'requests', JSON.stringify(requests.map((request, index) => ({ index, fromSeq: request.fromSeq ?? null }))),
      'snapshots', JSON.stringify(snapshots.map((snapshot, index) => ({ index, cursor: snapshot.cursor, first: snapshot.records[0]?.event.seq ?? null, length: snapshot.records.length }))))
    failures.push(error)
  }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    followSpy.mockRestore(); invokeSpy.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android foreground window failed')
}, 300_000)

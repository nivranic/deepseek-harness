/** Real system notification entry resumes an ended Push observation without changing the current intent. */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { symbols } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-user-approval'
import { expect, it, vi } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const execute = promisify(execFile)
const APPLICATION = 'com.deepseek.harness.companion.nativeacceptance'

interface ForegroundSnapshot {
  pid: number
  lifecycle: string
  focused: boolean
  windowPackage: string | null
  generation: number
  hostId: string | null
  hostKey: string | null
  pushOwner: number
  sessionOwner: number
  sessionId: string | null
  input: { drafts: Record<string, unknown>; pending: Record<string, unknown>; answerCount: number; lastSessionId: string | null }
  push: { state: string; attempts: number; interruptions: number; lastFailure: string | null; received: number }
}

interface NotificationSnapshot {
  enabled: boolean
  permission: boolean
  count: number
  titles: string[]
  bodies: string[]
  postTimes: number[]
}

/** The native adapter captures a public arrow before tests run; that arrow calls these methods on its original receiver. */
interface GatewayWireHarness {
  openWireStream(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<AsyncIterable<unknown>>
  dispatchRpc(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<unknown>
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android resumes Push once after a real notification click and retains unsent input', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const approvals: { abort: AbortController; settled: Promise<unknown> }[] = []
  const restore: (() => void)[] = []
  const endFirst = new AbortController()
  const firstFinished = Promise.withResolvers<undefined>()
  let firstStarted = false
  let signedEventStreams = 0
  let finishTurn: (() => Promise<void>) | undefined
  let shadeOpen = false
  let closeShade: (() => Promise<void>) | undefined
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_PUSH_FOREGROUND', title: 'Push foreground', turns: 3 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-push-foreground')
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    const agent = scaffold.ctx.agents.get(sessionId)
    if (!agent) throw new Error('Native Push fixture has no live Agent')
    const outcomes: string[] = []
    let asked = 0
    scaffold.ctx.on('session/event', (session, event) => {
      if (session.id !== sessionId) return
      if (event.type === 'approval/asked') asked++
      if (event.type === 'approval/decided') outcomes.push(event.data.outcome)
    })
    agent.session.append('turn/start', { turn: 4 })
    finishTurn = async () => {
      agent.session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
      await scaffold.ctx.sessions.flush(agent.session)
    }
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    // Unwrap Cordis so the native adapter's captured arrow reaches this fixture's actual receiver.
    const receiver = scaffold.ctx.get('typertGateway') as unknown as GatewayWireHarness & { [symbols.original]?: GatewayWireHarness }
    const gateway = receiver[symbols.original] ?? receiver
    const open = gateway.openWireStream.bind(gateway)
    const openSpy = vi.spyOn(gateway, 'openWireStream').mockImplementation(async (endpoint, payload, signal, requireDevice) => {
      if (endpoint !== '$events' || requireDevice !== true) return open(endpoint, payload, signal, requireDevice)
      const ordinal = ++signedEventStreams
      if (ordinal !== 1) return open(endpoint, payload, signal, requireDevice)
      const source = await open(endpoint, payload, AbortSignal.any([signal, endFirst.signal]), requireDevice)
      return (async function* () {
        firstStarted = true
        try { yield* source }
        finally { firstFinished.resolve(undefined) }
      })()
    })
    restore.push(() => { openSpy.mockRestore() })
    const signedCalls: string[] = []
    const invoke = gateway.dispatchRpc.bind(gateway)
    const rpcSpy = vi.spyOn(gateway, 'dispatchRpc').mockImplementation((endpoint, payload, signal, requireDevice) => {
      if (requireDevice) signedCalls.push(endpoint)
      return invoke(endpoint, payload, signal, requireDevice)
    })
    restore.push(() => { rpcSpy.mockRestore() })
    let refusePrompt = true
    const businessInvoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
    const businessSpy = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation((request) => {
      if (refusePrompt && request.namespace === 'session' && request.method === 'prompt') {
        refusePrompt = false
        throw new RemoteError('gateway/internal', 'fixture retains a pending prompt', {})
      }
      return businessInvoke(request)
    })
    restore.push(() => { businessSpy.mockRestore() })
    const adb = process.env.DSH_ANDROID_ADB!
    const serial = process.env.DSH_ANDROID_SERIAL ?? ''
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port)
    closeShade = async () => {
      await execute(adb, ['-s', serial, 'shell', 'input', 'keyevent', '4'], { windowsHide: true, timeout: 30_000 })
    }
    const folder = fileURLToPath(new URL('../../../.artifacts/android-push-foreground-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/installed-apks.json`, JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, `${stage}: ${JSON.stringify(result)}`).toMatchObject({ type: 'ok' })
      return result.value
    }
    const state = async () => await command({ op: 'foregroundSnapshot' }) as ForegroundSnapshot
    const notification = async () => await command({ op: 'pushNotificationSnapshot' }) as NotificationSnapshot
    const screenshot = async (name: string) => {
      const result = await execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 30_000, encoding: 'buffer' })
      await writeFile(`${folder}/${name}.png`, result.stdout)
    }
    const awaitForeground = async () => {
      await expect.poll(async () => {
        const current = await state()
        return current.lifecycle === 'RESUMED' && current.focused && current.windowPackage === APPLICATION
      }, { timeout: 20_000 }).toBe(true)
    }
    const home = async () => {
      await command({ op: 'systemHome' })
      await expect.poll(async () => {
        const current = await state()
        return current.lifecycle === 'CREATED' && !current.focused && current.windowPackage !== APPLICATION
      }, { timeout: 20_000 }).toBe(true)
    }
    const awaitNotification = async () => {
      await expect.poll(async () => (await notification()).count, { timeout: 20_000 }).toBe(1)
      expect(await notification()).toMatchObject({ enabled: true, permission: true,
        titles: ['宿主等待审批'], bodies: ['打开应用，经安全连接查看详情。'] })
    }
    const clickNotification = async (capture: string) => {
      await command({ op: 'openNotificationShade' })
      shadeOpen = true
      await expect.poll(() => command({ op: 'notificationShadeReady' }), { timeout: 20_000 }).toBe(true)
      await screenshot(capture)
      await command({ op: 'clickPushNotification' })
      await awaitForeground()
      shadeOpen = false
      await expect.poll(async () => (await notification()).count, { timeout: 10_000 }).toBe(0)
    }
    const requestApproval = () => {
      const abort = new AbortController()
      const settled = scaffold.ctx.approval.request({ agent, toolName: 'foreground_fixture', reason: 'Native notification entry', signal: abort.signal })
        .then(value => ({ value }), (error: unknown) => ({ error }))
      const owned = { abort, settled }
      approvals.push(owned)
      return owned
    }
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair-and-retain-pending-intent'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text: 'Unsent while returning from a notification' })
    await command({ op: 'failPromptDraft', text: 'Unsent while returning from a notification' })
    expect(refusePrompt).toBe(false)
    await command({ op: 'clearPushNotification' })
    await awaitForeground()
    await expect.poll(async () => (await state()).push.state, { timeout: 20_000 }).toBe('open')
    const initial = await state()
    expect(initial.push.attempts).toBe(1)
    expect(firstStarted).toBe(true)
    expect(signedEventStreams).toBe(1) // The Session page has not started a separate Interaction observer.
    expect(Object.keys(initial.input.pending)).toHaveLength(1)
    const callBaseline = signedCalls.length
    const identity = (value: ForegroundSnapshot) => ({ pid: value.pid, generation: value.generation, hostId: value.hostId,
      hostKey: value.hostKey, pushOwner: value.pushOwner, sessionOwner: value.sessionOwner,
      sessionId: value.sessionId, input: value.input })

    stage = 'home-and-live-host-notification'
    await home()
    expect(identity(await state())).toEqual(identity(initial))
    const first = requestApproval()
    await awaitNotification()
    first.abort.abort()
    expect(await first.settled).toEqual({ value: 'cancelled' })
    await expect.poll(async () => (await state()).push.received, { timeout: 20_000 }).toBe(1)
    endFirst.abort()
    await firstFinished.promise
    await expect.poll(async () => (await state()).push.state, { timeout: 20_000 }).toBe('ended')
    expect((await state()).push.attempts).toBe(1)
    expect(signedEventStreams).toBe(1)

    stage = 'system-notification-click-recovers-once'
    await clickNotification('ended-stream-notification')
    await expect.poll(async () => (await state()).push.state, { timeout: 20_000 }).toBe('open')
    const resumed = await state()
    expect(resumed.push).toMatchObject({ attempts: 2, interruptions: 1, received: 1, lastFailure: null })
    expect(signedEventStreams).toBe(2)
    expect(identity(resumed)).toEqual(identity(initial))
    await command({ op: 'assertPromptDraft', text: 'Unsent while returning from a notification' })
    await screenshot('recovered-session')

    stage = 'healthy-background-notification-and-rotation'
    await home()
    const second = requestApproval()
    await awaitNotification()
    second.abort.abort()
    expect(await second.settled).toEqual({ value: 'cancelled' })
    await expect.poll(async () => (await state()).push.received, { timeout: 20_000 }).toBe(2)
    await clickNotification('healthy-stream-notification')
    expect((await state()).push).toMatchObject({ state: 'open', attempts: 2, interruptions: 1, received: 2 })
    await command({ op: 'recreate' })
    await awaitForeground()
    const rotated = await state()
    expect(identity(rotated)).toEqual(identity(initial))
    expect(rotated.push).toMatchObject({ state: 'open', attempts: 2, interruptions: 1, received: 2 })
    expect(signedEventStreams).toBe(2)
    expect((await notification()).count).toBe(0)
    await screenshot('rotated-without-notification-replay')
    expect(signedCalls.slice(callBaseline).filter(endpoint => ['$events/result', 'session/prompt', 'session/create', 'session/handoff',
      'session/cancel', 'fileUploads/upload', 'fileUploads/uploadImage', 'deviceTrust/redeemPairing'].includes(endpoint))).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    expect(asked).toBe(2)
    expect(outcomes).toEqual(['cancelled', 'cancelled'])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-push-foreground.expected.md', import.meta.url)), [
      '# Android foreground Push recovery', '',
      '- Installed acceptance APK hashes match the current build artifacts.',
      '- A real Host approval produces a minimized local notification while the same process remains behind HOME.',
      '- Only the first signed Push $events iterator ends; the Session page has no competing Interaction observer.',
      '- A real SystemUI notification-row click returns to the same PID, Host, Session, complete draft and pending prompt.',
      '- Foreground entry reopens the ended observation exactly once and receives the next real Host notification.',
      '- A healthy background round trip keeps its producer, and Activity recreation neither replaces it nor re-posts consumed notifications.',
      '- Recovery adds no prompt, reply, cancellation, upload, Session creation, runtime migration or pairing redemption.',
      '- Evidence covers granted notification permission and one logical event-stream EOF on the tested emulator.',
      '- Physical network or mux loss, FCM/APNs, process death, Recents and precise notification targets remain separate qualification work.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android foreground Push stage', stage); failures.push(error) }
  finally {
    endFirst.abort()
    for (const approval of approvals) approval.abort.abort()
    await Promise.all(approvals.map(approval => approval.settled))
    if (firstStarted) await firstFinished.promise
    if (shadeOpen) await closeShade?.().catch((error: unknown) => { failures.push(error) })
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const dispose of restore.reverse()) dispose()
    await finishTurn?.().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android foreground Push acceptance failed')
}, 240_000)

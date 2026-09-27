/** Real notification denial and app settings recovery retain the Host's read-only observation and local input. */
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
  push: { state: string; attempts: number; interruptions: number; received: number }
}

interface PermissionSnapshot {
  pid: number
  controller: number
  systemEnabled: boolean
  permission: boolean
  projectedEnabled: boolean
  requested: boolean
  lastAnswer: boolean | null
  dialog: boolean
  allow: boolean
  deny: boolean
  settings: boolean
  settingsEnabled: boolean | null
}

interface NotificationSnapshot { enabled: boolean; permission: boolean; count: number; titles: string[]; bodies: string[] }

/** Native entry points call these methods on the original Cordis receiver captured at startup. */
interface GatewayWireHarness {
  openWireStream(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<AsyncIterable<unknown>>
  dispatchRpc(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<unknown>
}

it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android recovers denied notifications through the real app settings switch without replaying consumed Push', async () => {
  const adb = process.env.DSH_ANDROID_ADB!
  const serial = process.env.DSH_ANDROID_SERIAL ?? ''
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  const approvals: { abort: AbortController; settled: Promise<unknown> }[] = []
  const restore: (() => void)[] = []
  let finishTurn: (() => Promise<void>) | undefined
  let systemOverlayOpen = false
  let stage = 'seed'
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'NATIVE_NOTIFICATION_PERMISSION', title: 'Notification permission', turns: 3 })
    const sessionId = await seedSession(scaffold, fixture.log, 'native-notification-permission')
    await scaffold.ctx.sessionController.resolveAgent(sessionId)
    const agent = scaffold.ctx.agents.get(sessionId)
    if (!agent) throw new Error('Native notification permission fixture has no live Agent')
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
    const receiver = scaffold.ctx.get('typertGateway') as unknown as GatewayWireHarness & { [symbols.original]?: GatewayWireHarness }
    const gateway = receiver[symbols.original] ?? receiver
    let signedEventStreams = 0
    const open = gateway.openWireStream.bind(gateway)
    const openSpy = vi.spyOn(gateway, 'openWireStream').mockImplementation((endpoint, payload, signal, requireDevice) => {
      if (endpoint === '$events' && requireDevice === true) signedEventStreams++
      return open(endpoint, payload, signal, requireDevice)
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
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    driver = await startAndroidCompanionUiDriver(adb, serial, info.port, true, [], undefined, 'runtime')
    const folder = fileURLToPath(new URL('../../../.artifacts/android-notification-permission-ui/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/installed-apks.json`, JSON.stringify(driver.installedApks, null, 2) + '\n')
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, `${stage}: ${JSON.stringify(result)}`).toMatchObject({ type: 'ok' })
      return result.value
    }
    const permission = async () => await command({ op: 'notificationPermissionSnapshot' }) as PermissionSnapshot
    const state = async () => await command({ op: 'foregroundSnapshot' }) as ForegroundSnapshot
    const notification = async () => await command({ op: 'pushNotificationSnapshot' }) as NotificationSnapshot
    const screenshot = async (name: string) => {
      const result = await execute(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { windowsHide: true, timeout: 30_000, encoding: 'buffer' })
      await writeFile(`${folder}/${name}.png`, result.stdout)
    }
    const awaitForeground = async () => {
      await expect.poll(async () => {
        const value = await state()
        return value.lifecycle === 'RESUMED' && value.focused && value.windowPackage === APPLICATION
      }, { timeout: 20_000 }).toBe(true)
    }
    const requestApproval = () => {
      const abort = new AbortController()
      const settled = scaffold.ctx.approval.request({ agent, toolName: 'notification_permission_fixture', reason: 'Notification permission recovery', signal: abort.signal })
        .then(value => ({ value }), (error: unknown) => ({ error }))
      const owned = { abort, settled }
      approvals.push(owned)
      return owned
    }

    stage = 'real-initial-denial'
    systemOverlayOpen = true
    await expect.poll(permission, { timeout: 20_000 }).toMatchObject({
      permission: false, requested: true, lastAnswer: null, dialog: true, allow: true, deny: true,
    })
    await screenshot('initial-permission-dialog')
    await command({ op: 'answerNotificationPermission', answer: 'deny' })
    await expect.poll(permission, { timeout: 20_000 }).toMatchObject({
      systemEnabled: false, permission: false, projectedEnabled: false, requested: true, lastAnswer: false, dialog: false,
    })
    await awaitForeground()
    systemOverlayOpen = false
    const denied = await permission()
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    stage = 'pair-and-retain-input'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'fillPromptDraft', text: 'Unsent while enabling notifications' })
    await command({ op: 'failPromptDraft', text: 'Unsent while enabling notifications' })
    expect(refusePrompt).toBe(false)
    const pending = await command({ op: 'pendingPrompt', text: 'Unsent while enabling notifications' })
    const newerDraft = 'New draft edited after notification denial'
    await command({ op: 'replacePromptDraft', text: newerDraft })
    await command({ op: 'recreate' })
    await awaitForeground()
    expect(await permission()).toMatchObject({
      pid: denied.pid, controller: denied.controller, requested: true, lastAnswer: false, dialog: false,
    })
    await command({ op: 'assertPromptDraft', text: newerDraft })
    expect(await command({ op: 'pendingPrompt', text: 'Unsent while enabling notifications' })).toEqual(pending)
    await expect.poll(async () => (await state()).push.state, { timeout: 20_000 }).toBe('open')
    const initial = await state()
    expect(Object.keys(initial.input.pending)).toHaveLength(1)
    expect(signedEventStreams).toBe(1)
    expect(initial.push).toMatchObject({ attempts: 1, received: 0 })
    const callBaseline = signedCalls.length
    const identity = (value: ForegroundSnapshot) => ({ pid: value.pid, generation: value.generation, hostId: value.hostId,
      hostKey: value.hostKey, pushOwner: value.pushOwner, sessionOwner: value.sessionOwner,
      sessionId: value.sessionId, input: value.input })
    await screenshot('denied-after-rotation')

    stage = 'disabled-notification-behind-app-settings'
    systemOverlayOpen = true
    await command({ op: 'openNotificationSettings' })
    await expect.poll(permission, { timeout: 20_000 }).toMatchObject({ settings: true, settingsEnabled: false, permission: false })
    await screenshot('app-notifications-disabled')
    const first = requestApproval()
    await expect.poll(async () => (await state()).push.received, { timeout: 20_000 }).toBe(1)
    expect(await notification()).toMatchObject({ enabled: false, permission: false, count: 0 })
    first.abort.abort()
    expect(await first.settled).toEqual({ value: 'cancelled' })

    stage = 'real-settings-grant-and-back'
    await command({ op: 'enableNotificationsInSettings' })
    await expect.poll(permission, { timeout: 20_000 }).toMatchObject({
      settings: true, settingsEnabled: true, permission: true, systemEnabled: true,
    })
    await screenshot('app-notifications-enabled')
    await command({ op: 'dismissSystemOverlay' })
    await awaitForeground()
    systemOverlayOpen = false
    await command({ op: 'assertNotificationEnabled' })
    expect(await permission()).toMatchObject({
      pid: denied.pid, controller: denied.controller, projectedEnabled: true, requested: true, lastAnswer: false, dialog: false,
    })
    expect(identity(await state())).toEqual(identity(initial))
    expect(await notification()).toMatchObject({ enabled: true, permission: true, count: 0 })
    await command({ op: 'recreate' })
    await awaitForeground()
    expect(await notification()).toMatchObject({ count: 0 })
    const second = requestApproval()
    await expect.poll(async () => (await state()).push.received, { timeout: 20_000 }).toBe(2)
    await expect.poll(notification, { timeout: 20_000 }).toMatchObject({ enabled: true, permission: true, count: 1,
      titles: ['宿主等待审批'], bodies: ['打开应用，经安全连接查看详情。'] })
    second.abort.abort()
    expect(await second.settled).toEqual({ value: 'cancelled' })
    systemOverlayOpen = true
    await command({ op: 'openNotificationShade' })
    await expect.poll(() => command({ op: 'notificationShadeReady' }), { timeout: 20_000 }).toBe(true)
    await screenshot('new-host-notification')
    await command({ op: 'clickPushNotification' })
    await awaitForeground()
    systemOverlayOpen = false
    await screenshot('returned-session')
    expect(identity(await state())).toEqual(identity(initial))
    expect((await state()).push).toMatchObject({ state: 'open', attempts: 1, interruptions: 0, received: 2 })
    expect(signedEventStreams).toBe(1)
    expect(signedCalls.slice(callBaseline).filter(endpoint => ['$events/result', 'session/prompt', 'session/create', 'session/handoff',
      'session/cancel', 'fileUploads/upload', 'fileUploads/uploadImage', 'deviceTrust/redeemPairing'].includes(endpoint))).toEqual([])
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    expect(asked).toBe(2)
    expect(outcomes).toEqual(['cancelled', 'cancelled'])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-notification-permission.expected.md', import.meta.url)), [
      '# Android notification permission recovery', '',
      '- Current installed APKs start without a notification grant or retained user-set/user-fixed permission flags.',
      '- The real permission dialog is denied; Activity recreation retains the Application-owned request history.',
      '- The application opens its own notification settings, and a real Host event is consumed while notifications are disabled.',
      '- The actual application-level switch grants notifications; a real Back action refreshes the visible application state.',
      '- The same PID, controller, Host, Session, models, complete draft and pending prompt survive settings and rotation.',
      '- The consumed disabled event is not posted after grant or rotation; the next Host event produces a minimized notification.',
      '- The healthy Push subscription stays single, and recovery adds no prompt, reply, cancel, upload, creation, handoff or pairing redemption.',
      '- Both Host approval waits are cancelled by the fixture and normal instrumentation teardown succeeds.',
      '- Evidence is limited to this emulator and application-level grant; channel enablement, settings revocation, process death and physical devices remain unqualified.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android notification permission stage', stage); failures.push(error) }
  finally {
    for (const approval of approvals) approval.abort.abort()
    await Promise.all(approvals.map(approval => approval.settled))
    if (systemOverlayOpen) await execute(adb, ['-s', serial, 'shell', 'input', 'keyevent', '4'], { windowsHide: true, timeout: 30_000 })
      .catch((error: unknown) => { failures.push(error) })
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    for (const dispose of restore.reverse()) dispose()
    await finishTurn?.().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android notification permission acceptance failed')
}, 240_000)

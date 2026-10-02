/** A Host-side carrier kill drives the §29 outage state word and reconnect cycle on the device. */
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { symbols } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

/** Host-plane connection-hygiene surface used by this lane to produce a deterministic outage. */
interface GatewayHostPlane {
  terminateDeviceConnections(request: { deviceId: string }): { terminated: number }
}

interface GatewayWireHarness {
  openWireStream(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    requireDevice?: boolean,
    connection?: unknown,
  ): Promise<AsyncIterable<unknown>>
}

const MODE = webSnapshotMode()
// The outage leg reads settled facts and drives no model call, so the replay Host boots
// providers-only over a header-only fixture exactly like the location-facts lane.
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/plan-narrow-viewport/session.v3.jsonl', import.meta.url))
const PRESET_WORDS: Record<string, string> = {
  'read-only': '仅可查看',
  'workspace-write': '工作区内修改',
  'danger-full-access': '完全权限',
  'custom': '自定义',
}
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android publishes the outage state word through a Host-terminated carrier', async () => {
  const options = {
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  }
  const a = await launchWebScaffold(options)
  let b: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  let stage = 'second-host'
  try {
    b = await launchWebScaffold({ ...options, replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false, replayProvidersOnly: true })
    let preset: string | undefined
    b.ctx.on('session/event', (_session, event) => {
      if (event.type === 'permission/preset') preset = event.data.preset
    })
    const { sessionId } = await a.ctx.sessionController.create({ cwd: a.workspaceCwd })
    await b.ctx.sessionController.create({ cwd: b.workspaceCwd, sessionId })
    const infoA = a.ctx.nativeRemote.describe()
    const infoB = b.ctx.nativeRemote.describe()
    const hostB = b.ctx.hostDescription.describe()
    const issued = b.ctx.deviceTrust.issuePairing('collaborator')
    const receiver = b.ctx.get('typertGateway') as unknown as GatewayHostPlane & GatewayWireHarness & { [symbols.original]?: GatewayHostPlane & GatewayWireHarness }
    const gateway = receiver[symbols.original] ?? receiver
    const openStream = gateway.openWireStream.bind(gateway)
    const followOpens: number[] = []
    vi.spyOn(gateway, 'openWireStream').mockImplementation((endpoint, payload, signal, requireDevice, connection) => {
      if (endpoint === 'session/follow') followOpens.push(followOpens.length)
      return openStream(endpoint, payload, signal, requireDevice, connection)
    })
    driver = await startAndroidCompanionUiDriver(
      process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', infoB.port, true, [infoA.port],
    )
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, stage).toMatchObject({ type: 'ok' })
      return result.value
    }
    const readFacts = async (): Promise<string> => String(await command({ op: 'assertLocationFacts' }))
    /** Poll the facts line until it matches, bounded; reconnect settles asynchronously. */
    const untilFacts = async (matches: (text: string) => boolean): Promise<string> => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const text = await readFacts()
        if (matches(text)) return text
        await delay(500)
      }
      throw new Error(`session location facts never matched within the polling window (stage ${stage})`)
    }
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${infoB.port}`,
      hostId: hostB.hostId, displayName: hostB.displayName, spkiFingerprint: infoB.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 1 })
    const roster = b.ctx.deviceTrust.listDevices()
    expect(roster, 'the paired device appears on the Host roster').toHaveLength(1)
    const deviceId = roster[0]!.deviceId
    stage = 'open-session'
    await command({ op: 'openSession', sessionId })
    stage = 'settled-before'
    expect(preset, 'Host published a permission preset').toBeDefined()
    const presetWord = PRESET_WORDS[preset!] ?? preset!
    const workspaceBase = basename(b.workspaceCwd)
    const settled = `${hostB.displayName} · ${workspaceBase} · ${presetWord}`
    await untilFacts(text => text === settled)
    expect(followOpens.length, 'the follow stream opened once before the outage').toBe(1)
    stage = 'outage'
    const terminated = gateway.terminateDeviceConnections({ deviceId })
    expect(terminated.terminated, 'the Host destroyed the device carrier').toBeGreaterThanOrEqual(1)
    stage = 'state-word'
    await command({ op: 'waitLocationFactsContains', text: '重连中' })
    stage = 'settled-after'
    await untilFacts(text => text === settled)
    expect(followOpens.length, 'the device re-opened its follow stream after the outage').toBeGreaterThanOrEqual(2)
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-connection-outage.expected.md', import.meta.url)), [
      '# Android connection outage (§29)', '',
      '- The Host-side terminateDeviceConnections primitive destroys the paired device\'s physical stream carrier, which the device reads as carrier loss: the location-facts line leaves its settled form and publishes the reconnecting state word.',
      '- After the reconnect delay the follow stream re-opens, the state word clears, and the settled facts line (Host · workspace basename · preset word) returns unchanged; the device admission itself was never revoked.',
      '- The outage is deterministic — no adb-reverse removal is involved — closing the gap the location-facts lane documented (an idle follow stream cannot detect a removed reverse tunnel).',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android connection outage stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android connection outage acceptance failed')
}, 300_000)

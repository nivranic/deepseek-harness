/** Steer submissions render by capability and reach the Host with their exact mode. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { symbols } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

/** Native entry points call these methods on the original Cordis receiver captured at startup. */
interface GatewayWireHarness {
  openWireStream(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<AsyncIterable<unknown>>
  dispatchRpc(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<unknown>
}

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android submits steer-mode prompts only when the Host advertises model.steer.v1', async () => {
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
    b = await launchWebScaffold({ ...options, replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false })
    const { sessionId } = await a.ctx.sessionController.create({ cwd: a.workspaceCwd })
    await b.ctx.sessionController.create({ cwd: b.workspaceCwd, sessionId })
    const infoA = a.ctx.nativeRemote.describe()
    const infoB = b.ctx.nativeRemote.describe()
    const hostB = b.ctx.hostDescription.describe()
    expect(hostB.capabilities ?? []).toContain('model.steer.v1')
    const receiver = b.ctx.get('typertGateway') as unknown as GatewayWireHarness & { [symbols.original]?: GatewayWireHarness }
    const gateway = receiver[symbols.original] ?? receiver
    const dispatched: { endpoint: string; mode: string }[] = []
    const dispatch = gateway.dispatchRpc.bind(gateway)
    vi.spyOn(gateway, 'dispatchRpc').mockImplementation((endpoint, payload, signal, requireDevice) => {
      if (requireDevice === true && endpoint === 'session/prompt') {
        const args = (payload as { args?: { request?: { mode?: string } } }).args
        dispatched.push({ endpoint, mode: String(args?.request?.mode) })
      }
      return dispatch(endpoint, payload, signal, requireDevice)
    })
    const issued = b.ctx.deviceTrust.issuePairing('collaborator')
    driver = await startAndroidCompanionUiDriver(
      process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', infoB.port, true, [infoA.port],
    )
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, stage).toMatchObject({ type: 'ok' })
      return result.value
    }
    stage = 'pair'
    await command({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${infoB.port}`,
      hostId: hostB.hostId, displayName: hostB.displayName, spkiFingerprint: infoB.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 1 })
    stage = 'open-session'
    await command({ op: 'openSession', sessionId })
    stage = 'steer-submission'
    const text = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    await command({ op: 'fillPromptDraft', text })
    const settled = b.whenTurnSettled(60_000)
    await command({ op: 'submitPromptSteer' })
    expect(await settled).toBe(sessionId)
    stage = 'host-saw-steer'
    expect(dispatched).toEqual([{ endpoint: 'session/prompt', mode: 'steer' }])
    await command({ op: 'assertNoPendingPrompt' })
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-steer.expected.md', import.meta.url)), [
      '# Android steer submission (§30)', '',
      '- A Host advertising model.steer.v1 renders the explicit steer submission beside the queue send.',
      '- One steer-mode prompt reaches the Host over the device-signed session/prompt dispatch and completes the recorded turn.',
      '- The steer entry stays hidden only for Hosts that do not advertise the capability.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android steer stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android steer acceptance failed')
}, 240_000)

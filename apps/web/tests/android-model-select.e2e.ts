/** Model selection renders by capability and reaches the Host as one signed selectModel intent. */
import { fileURLToPath } from 'node:url'
import { symbols } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

/** Native entry points call these methods on the original Cordis receiver captured at startup. */
interface GatewayWireHarness {
  openWireStream(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<AsyncIterable<unknown>>
  dispatchRpc(endpoint: string, payload: unknown, signal: AbortSignal, requireDevice?: boolean): Promise<unknown>
}

const MODE = webSnapshotMode()
// Selection drives no model call, so the replay Host boots providers-only over a
// header-only fixture: the scaffold still mounts the replay provider catalog
// (session/modelCatalog stays answerable) while the fixture records no scripts.
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/plan-narrow-viewport/session.v3.jsonl', import.meta.url))
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android composes a Session-local model selection only when the Host advertises model.select.v1', async () => {
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
    // Selection drives no model call, so the replay Host boots providers-only: the
    // fixture is validated call-free at boot instead of asserted consumed at teardown.
    b = await launchWebScaffold({ ...options, replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false, replayProvidersOnly: true })
    const { sessionId } = await a.ctx.sessionController.create({ cwd: a.workspaceCwd })
    await b.ctx.sessionController.create({ cwd: b.workspaceCwd, sessionId })
    const infoA = a.ctx.nativeRemote.describe()
    const infoB = b.ctx.nativeRemote.describe()
    const hostB = b.ctx.hostDescription.describe()
    expect(hostB.capabilities ?? []).toContain('model.select.v1')
    expect(hostB.capabilities ?? []).toContain('model.catalog.v1')
    const receiver = b.ctx.get('typertGateway') as unknown as GatewayWireHarness & { [symbols.original]?: GatewayWireHarness }
    const gateway = receiver[symbols.original] ?? receiver
    const dispatched: { endpoint: string; provider: string; model: string }[] = []
    const dispatch = gateway.dispatchRpc.bind(gateway)
    vi.spyOn(gateway, 'dispatchRpc').mockImplementation((endpoint, payload, signal, requireDevice) => {
      if (requireDevice === true && endpoint === 'session/selectModel') {
        const request = (payload as { args?: { request?: { provider?: string; model?: string } } }).args?.request
        dispatched.push({ endpoint, provider: String(request?.provider), model: String(request?.model) })
      }
      return dispatch(endpoint, payload, signal, requireDevice)
    })
    const selections: { provider: string; model: string }[] = []
    b.ctx.on('session/event', (_session, event) => {
      if (event.type === 'model/selection') selections.push({ provider: event.data.provider, model: event.data.model })
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
    stage = 'picker'
    await command({ op: 'openModelPicker', model: 'deepseek-v4-flash' })
    stage = 'select'
    await command({ op: 'selectModelFromPicker', model: 'deepseek-v4-flash' })
    const selectedText = await command({ op: 'assertModelSelected' })
    expect(String(selectedText), 'selected confirmation text').toContain('DeepSeek-V4-Flash')
    expect(dispatched).toEqual([{ endpoint: 'session/selectModel', provider: 'deepseek-official', model: 'deepseek-v4-flash' }])
    expect(selections).toEqual([{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }])
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-model-select.expected.md', import.meta.url)), [
      '# Android model selection (§30)', '',
      '- A Host advertising model.select.v1 renders the composition picker entry for an open Session.',
      '- The picker lists the Host model catalog (provider groups with routable models); tapping one model sends exactly one device-signed session/selectModel dispatch.',
      '- The Host appends the model/selection event and the device confirms the chosen model by name; no prompt or turn is involved.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android model selection stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android model selection acceptance failed')
}, 240_000)

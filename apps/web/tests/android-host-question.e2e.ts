/** A pending Host Question stays scoped to its own Host across selection, restart, and reply. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/question-composer/session.v3.jsonl', import.meta.url))
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android isolates a pending Question between saved Hosts and answers only its own Host', async () => {
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
    const hostA = a.ctx.hostDescription.describe()
    const hostB = b.ctx.hostDescription.describe()
    expect(hostA.hostId).not.toBe(hostB.hostId)
    const answersA: string[] = []
    const answersB: string[] = []
    const promptsA: string[] = []
    const promptsB: string[] = []
    for (const [scaffold, answers, prompts] of [[a, answersA, promptsA], [b, answersB, promptsB]] as const) {
      const receiver = scaffold.ctx.get('typertGateway') as unknown as GatewayWireHarness & { [symbols.original]?: GatewayWireHarness }
      const gateway = receiver[symbols.original] ?? receiver
      const dispatch = gateway.dispatchRpc.bind(gateway)
      vi.spyOn(gateway, 'dispatchRpc').mockImplementation((endpoint, payload, signal, requireDevice) => {
        if (requireDevice === true && endpoint === '$events/result') answers.push(endpoint)
        return dispatch(endpoint, payload, signal, requireDevice)
      })
      const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
      vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
        if (request.namespace === 'session' && request.method === 'prompt') prompts.push('prompt')
        return invoke(request)
      })
    }
    const payload = (scaffold: typeof a) => {
      const info = scaffold.ctx.nativeRemote.describe()
      const host = scaffold.ctx.hostDescription.describe()
      const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
      return {
        kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
        hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
        code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
      }
    }
    const start = (reset: boolean) => startAndroidCompanionUiDriver(
      process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', infoA.port, reset, [infoB.port],
    )
    driver = await start(true)
    const command = async (request: object) => {
      const result = await driver!.request(request)
      expect(result, stage).toMatchObject({ type: 'ok' })
      return result.value
    }
    stage = 'pair-a-no-question'
    await command({ op: 'pair', payload: payload(a) })
    await command({ op: 'assertCurrentHost', hostId: hostA.hostId, count: 1 })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'assertNoQuestion', absent: 'Blue' })
    stage = 'raise-question-on-b'
    await command({ op: 'repair', payload: payload(b) })
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 2 })
    await command({ op: 'openSession', sessionId })
    const textB = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    await command({ op: 'fillPromptDraft', text: textB })
    const settled = b.whenTurnSettled(120_000)
    await command({ op: 'submitPromptDraft' })
    await command({ op: 'watchInteractions' })
    const draftB = 'Host B answer draft 中文'
    await command({ op: 'fillQuestionDraft', custom: draftB })
    stage = 'hidden-on-a'
    await command({ op: 'selectHost', hostId: hostA.hostId })
    await command({ op: 'assertNoQuestion', absent: 'Blue' })
    stage = 'draft-retained-on-b'
    await command({ op: 'selectHost', hostId: hostB.hostId })
    await command({ op: 'assertQuestionDraft', custom: draftB })
    const pid = await command({ op: 'inputCheckpoint' })
    await driver.kill()
    driver = await start(false)
    stage = 'restart-retains-draft'
    expect(await command({ op: 'assertRestored' })).not.toBe(pid)
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 2 })
    await command({ op: 'assertQuestionDraft', custom: draftB })
    stage = 'answer-only-b'
    expect(await command({ op: 'submitQuestionDraft' })).toBe(null)
    expect(await settled).toBe(sessionId)
    expect(answersA).toEqual([])
    expect(answersB).toEqual(['$events/result'])
    expect(promptsA).toEqual([])
    expect(promptsB).toEqual(['prompt'])
    stage = 'answered-question-never-on-a'
    await command({ op: 'selectHost', hostId: hostA.hostId })
    await command({ op: 'assertNoQuestion', absent: 'Blue' })
    expect(a.ctx.deviceTrust.listDevices()).toHaveLength(1)
    expect(b.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-host-question/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/host-a-no-question.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-host-question.expected.md', import.meta.url)), [
      '# Android saved Host Question isolation', '',
      '- A plain Host exposes no pending interaction while the same Session id on another Host raises a Question.',
      '- Switching to the questioning Host never surfaces its Question card, options, or answer draft.',
      '- Returning to the questioning Host restores its Question and the retained draft; a different process restores both.',
      '- The draft submits exactly once through the questioning Host and completes its recorded turn.',
      '- The plain Host receives no prompt and no interaction reply; each Host retains exactly one device grant.',
      '- After the answer the retired Question never appears on the other Host.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android Host Question stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android Host Question isolation acceptance failed')
}, 240_000)

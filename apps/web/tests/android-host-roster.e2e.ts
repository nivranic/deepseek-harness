/** Saved Android Hosts isolate identical Session ids and dispatch only through the selected grant. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android switches saved Hosts without crossing input or mutation ownership', async () => {
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
    const promptsA: string[] = []
    const promptsB: string[] = []
    for (const [scaffold, prompts] of [[a, promptsA], [b, promptsB]] as const) {
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
    stage = 'pair-a'
    await command({ op: 'pair', payload: payload(a) })
    await command({ op: 'assertCurrentHost', hostId: hostA.hostId, count: 1 })
    await command({ op: 'openSession', sessionId })
    const draftA = 'Host A retained draft 中文'
    await command({ op: 'fillPromptDraft', text: draftA })
    stage = 'pair-b'
    await command({ op: 'repair', payload: payload(b) })
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 2 })
    await command({ op: 'openSession', sessionId })
    await command({ op: 'assertEmptyPromptDraft' })
    const textB = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!
    await command({ op: 'fillPromptDraft', text: textB })
    stage = 'switch-back-a'
    await command({ op: 'selectHost', hostId: hostA.hostId })
    await command({ op: 'assertPromptDraft', text: draftA })
    expect(promptsA).toEqual([])
    expect(promptsB).toEqual([])
    stage = 'switch-back-b'
    await command({ op: 'selectHost', hostId: hostB.hostId })
    await command({ op: 'assertPromptDraft', text: textB })
    const pid = await command({ op: 'inputCheckpoint' })
    await driver.kill()
    driver = await start(false)
    stage = 'restart-b'
    expect(await command({ op: 'assertRestored' })).not.toBe(pid)
    await command({ op: 'assertCurrentHost', hostId: hostB.hostId, count: 2 })
    await command({ op: 'assertPromptDraft', text: textB })
    expect(promptsA).toEqual([])
    expect(promptsB).toEqual([])
    stage = 'submit-only-b'
    const settled = b.whenTurnSettled(60_000)
    await command({ op: 'submitPromptDraft' })
    expect(await settled).toBe(sessionId)
    await command({ op: 'assertNoPendingPrompt' })
    expect(promptsA).toEqual([])
    expect(promptsB).toEqual(['prompt'])
    stage = 'preserved-a-after-b-submit'
    await command({ op: 'selectHost', hostId: hostA.hostId })
    await command({ op: 'assertPromptDraft', text: draftA })
    await command({ op: 'recreate' })
    await command({ op: 'assertCurrentHost', hostId: hostA.hostId, count: 2 })
    await command({ op: 'assertPromptDraft', text: draftA })
    expect(a.ctx.deviceTrust.listDevices()).toHaveLength(1)
    expect(b.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-host-roster/', import.meta.url))
    await mkdir(folder, { recursive: true })
    await writeFile(`${folder}/host-a-restored.png`, Buffer.from(await command({ op: 'screenshot' }) as string, 'base64'))
    await command({ op: 'close' })
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-host-roster.expected.md', import.meta.url)), [
      '# Android saved Host selection', '',
      '- Two real Hosts store distinct grants and expose the same Session id.',
      '- Pairing Host B keeps Host A saved; returning to either Host restores only its own draft.',
      '- The current Host label follows the selected saved identity.',
      '- A different process restores Host B and its draft without submitting a prompt or redeeming a grant.',
      '- Explicit submission reaches Host B once; Host A receives no prompt and retains its own draft.',
      '- Switching back and Activity recreation preserve Host A input; each Host retains exactly one device grant.',
    ].join('\n'), MODE)
  } catch (error) { console.info('Android Host roster stage', stage); failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await b?.close().catch((error: unknown) => { failures.push(error) })
    await a.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android saved Host acceptance failed')
}, 240_000)

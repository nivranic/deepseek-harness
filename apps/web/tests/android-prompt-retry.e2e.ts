/** Native process death after Host admission preserves explicit retry identity and receipt reconciliation. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))

for (const recovery of ['explicit-retry', 'recorded-receipt'] as const) {
  it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')(`Android restores an admitted prompt through ${recovery}`, async () => {
    const scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
      extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
    })
    let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
    const failures: unknown[] = []
    const events: SessionEvent[] = []
    let stepClaimed = false
    const releaseResponse = Promise.withResolvers<undefined>()
    const releaseStep = Promise.withResolvers<undefined>()
    const requests: string[] = []
    const invoke = scaffold.ctx.typertGateway.invoke.bind(scaffold.ctx.typertGateway)
    // The real Gateway completes admission; only the first HTTP result is held until the client process dies.
    const holdResponse = vi.spyOn(scaffold.ctx.typertGateway, 'invoke').mockImplementation(async (request) => {
      const result = await invoke(request)
      if (request.namespace === 'session' && request.method === 'prompt') {
        const requestId = (request.args.request as { requestId: string }).requestId
        requests.push(requestId)
        if (requests.length === 1) {
          await releaseResponse.promise
        }
      }
      return result
    })
    const stopHolding = scaffold.ctx.on('agent/pre-step', async (_payload, next) => {
      stepClaimed = true
      await releaseStep.promise
      return next()
    })
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    let stage = 'create-session'
    try {
      const { sessionId } = await scaffold.ctx.sessionController.create({ cwd: scaffold.workspaceCwd })
      const info = scaffold.ctx.nativeRemote.describe()
      const host = scaffold.ctx.hostDescription.describe()
      const start = (resetData: boolean) => startAndroidCompanionUiDriver(
        process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, resetData,
      )
      const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
      stage = 'start-instrumentation'
      driver = await start(true)
      stage = 'pair'
      const paired = await driver.request({ op: 'pair', payload: {
        kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
        hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
        code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
      } })
      expect(paired.type).toBe('ok')
      stage = 'open-session'
      expect((await driver.request({ op: 'openSession', sessionId })).type).toBe('ok')
      const prompts = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))
      expect(prompts).toHaveLength(1)
      const text = prompts[0]!
      expect((await driver.request({ op: 'fillPromptDraft', text })).type).toBe('ok')
      stage = 'submit-prompt'
      expect((await driver.request({ op: 'submitPromptDraft' })).type).toBe('ok')
      stage = 'host-admitted-and-claimed'
      await vi.waitFor(() => {
        expect(requests).toHaveLength(1)
        expect(stepClaimed).toBe(true)
      }, { timeout: 30_000 })
      expect(requests).toHaveLength(1)
      const pending = await driver.request({ op: 'pendingPrompt', text })
      expect(pending).toMatchObject({ type: 'ok', value: requests[0] })
      const newer = 'Keep my newer unsent draft 中文'
      expect((await driver.request({ op: 'replacePromptDraft', text: newer })).type).toBe('ok')
      expect((await driver.request({ op: 'inputCheckpoint' })).type).toBe('ok')
      expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(0)
      stage = 'kill-before-acknowledgement'
      await driver.kill()
      releaseResponse.resolve(undefined)

      if (recovery === 'recorded-receipt') {
        stage = 'wait-for-turn'
        const settled = scaffold.whenTurnSettled(60_000)
        releaseStep.resolve(undefined)
        expect(await settled).toBe(sessionId)
      }
      stage = 'restart-instrumentation'
      driver = await start(false)
      const restored = await driver.request({ op: 'assertRestored' })
      expect(restored.type).toBe('ok')
      expect(restored.value).not.toBe(paired.value)
      expect((await driver.request({ op: 'assertPromptDraft', text: newer })).type).toBe('ok')
      expect(requests).toHaveLength(1)
      if (recovery === 'explicit-retry') {
        expect(await driver.request({ op: 'pendingPrompt', text })).toMatchObject({ type: 'ok', value: requests[0] })
        stage = 'explicit-retry'
        expect((await driver.request({ op: 'retryPendingPrompt', requestId: requests[0] })).type).toBe('ok')
        expect(requests).toEqual([pending.value, pending.value])
        stage = 'wait-for-turn'
        const settled = scaffold.whenTurnSettled(60_000)
        releaseStep.resolve(undefined)
        expect(await settled).toBe(sessionId)
      }
      expect((await driver.request({ op: 'assertNoPendingPrompt' })).type).toBe('ok')
      expect((await driver.request({ op: 'assertPromptDraft', text: newer })).type).toBe('ok')
      const messages = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
      expect(messages).toHaveLength(1)
      expect(messages[0]?.data.source).toMatchObject({ kind: 'user', rpcId: pending.value })
      expect(events.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])).toHaveLength(1)
      expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
      expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
      const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-prompt-retry/', import.meta.url))
      await mkdir(folder, { recursive: true })
      const screenshot = await driver.request({ op: 'screenshot' })
      expect(screenshot.type).toBe('ok')
      await writeFile(`${folder}/${recovery}.png`, Buffer.from(screenshot.value as string, 'base64'))
      expect((await driver.request({ op: 'close' })).type).toBe('ok')
      expect(await driver.stop()).toBe(0)
      stage = 'restart-instrumentation'
      driver = await start(false)
      const reopened = await driver.request({ op: 'assertRestored' })
      expect(reopened.type).toBe('ok')
      expect(reopened.value).not.toBe(restored.value)
      expect((await driver.request({ op: 'assertPromptDraft', text: newer })).type).toBe('ok')
      expect((await driver.request({ op: 'assertNoPendingPrompt' })).type).toBe('ok')
      expect(requests).toHaveLength(recovery === 'explicit-retry' ? 2 : 1)
      expect((await driver.request({ op: 'close' })).type).toBe('ok')
      expect(await driver.stop()).toBe(0)
      await compareOrRefreshGolden(fileURLToPath(new URL(`./expected/android-prompt-retry.${recovery}.expected.md`, import.meta.url)), [
        `# Android admitted prompt recovery: ${recovery}`, '',
        '- The real Host admits a signed prompt while its HTTP acknowledgement is held.',
        '- Android saves the original request identity and newer composer text before force-stop.',
        '- A different process restores input without automatic prompt submission or another device grant.',
        recovery === 'explicit-retry'
          ? '- Tapping retry uses the original request identity; the Host inserts and answers the prompt once.'
          : '- A recorded Host receipt clears the pending intent without a second prompt RPC.',
        '- Acknowledgement cleanup preserves newer text and remains saved across another process restart.',
      ].join('\n'), MODE)
    } catch (error) {
      console.info('Android admitted prompt recovery stage', { recovery, stage, promptRequests: requests.length, stepClaimed })
      failures.push(error)
    }
    finally {
      releaseResponse.resolve(undefined)
      releaseStep.resolve(undefined)
      stopHolding()
      holdResponse.mockRestore()
      await driver?.kill().catch((error: unknown) => { failures.push(error) })
      await scaffold.close().catch((error: unknown) => { failures.push(error) })
    }
    if (failures.length) throw new AggregateError(failures, `Android admitted prompt recovery failed: ${recovery}`)
  }, 180_000)
}

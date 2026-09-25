/** Current Kotlin companion models consume the same recorded Host session as the Web client. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'
import { startAndroidGatewayDriver } from './android-gateway-driver.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/question-composer/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/android-companion-question.expected.md', import.meta.url))
const MODE = webSnapshotMode()

for (const carrier of ['jvm', 'android'] as const) {
  it.skipIf(MODE === 'record' || (carrier === 'jvm' ? !process.env.DSH_ANDROID_JAVA : !process.env.DSH_ANDROID_ADB))(`Kotlin ${carrier} answers a recorded Question and reads its Session and files`, async () => {
    const scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
      extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
    })
    let browser: Browser | undefined
    let page: Page | undefined
    let driver: Pick<Awaited<ReturnType<typeof startAndroidGatewayDriver>>, 'request' | 'stop' | 'kill'> | undefined
    const failures: unknown[] = []
    const events: SessionEvent[] = []
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    try {
      const info = scaffold.ctx.nativeRemote.describe()
      driver = carrier === 'jvm' ? await startAndroidGatewayDriver(process.env.DSH_ANDROID_JAVA!)
        : await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
      const host = scaffold.ctx.hostDescription.describe()
      const issuance = scaffold.ctx.deviceTrust.issuePairing('collaborator')
      const paired = await driver.request({ op: 'pair', payload: {
        kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
        hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
        code: issuance.code, expiresAt: issuance.expiresAt, role: issuance.role,
      } })
      expect(paired.type).toBe('ok')
      if (carrier === 'android') {
        expect((await driver.request({ op: 'close' })).type).toBe('ok')
        expect(await driver.stop()).toBe(0)
        driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, false)
        const restored = await driver.request({ op: 'assertRestored' })
        expect(restored.type).toBe('ok')
        expect(restored.value).not.toBe(paired.value)
        expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
      }
      // Node closes idle HTTP keep-alive sockets before the human replies; signed mutations are never retried.
      if (carrier === 'jvm') await delay(8000)
      expect((await driver.request({ op: 'watchInteractions' })).type).toBe('ok')
      const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
      browser = await chromium.launch({ ...(executablePath === undefined ? {} : { executablePath }), headless: true })
      page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const prompt = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]
      expect(prompt).toBeDefined()
      const settled = scaffold.whenTurnSettled(60_000)
      const input = page.locator('[data-composer-input]').first()
      await writeComposerDraft(page, input, prompt as string)
      await input.press('Enter')
      await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })
      const answer = await driver.request({ op: 'answerQuestion', selected: ['Blue'], custom: 'Include accessibility notes' })
      expect(answer).toEqual({ id: answer.id, type: 'ok', value: null })
      const sessionId = await settled
      expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(await driver.request({ op: 'observeSession', sessionId })).toMatchObject({ type: 'ok', value: { done: true } })
      const content = Array.from({ length: 1001 }, (_, i) => `line ${i + 1} 中文`).join('\n')
      await writeFile(join(scaffold.workspaceCwd, 'workspace', 'native-lines-中文.txt'), content)
      expect(await driver.request({ op: 'readModelFile', sessionId, path: 'native-lines-中文.txt' })).toMatchObject({ type: 'ok', value: {
        lines: 1001, digest: createHash('sha256').update(content).digest('hex'),
      } })
      if (carrier === 'android') {
        const shot = await driver.request({ op: 'screenshot' })
        expect(shot.type).toBe('ok')
        const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-native-companion/', import.meta.url))
        await mkdir(folder, { recursive: true })
        await writeFile(join(folder, 'android-file-pagination.png'), Buffer.from(shot.value as string, 'base64'))
        await scaffold.ctx.deviceTrust.revokeDevice({ deviceId: scaffold.ctx.deviceTrust.listDevices()[0]!.deviceId })
        expect((await driver.request({ op: 'expectRefusal' })).type).toBe('ok')
        const refused = await driver.request({ op: 'screenshot' })
        expect(refused.type).toBe('ok')
        await writeFile(join(folder, 'android-revoked-observation.png'), Buffer.from(refused.value as string, 'base64'))
      }
      expect((await driver.request({ op: 'close' })).type).toBe('ok')
      expect(await driver.stop()).toBe(0)
      const expected = carrier === 'android'
        ? fileURLToPath(new URL('./expected/android-companion-restart.expected.md', import.meta.url)) : EXPECTED
      await compareOrRefreshGolden(expected, [
        '# Android companion models through Native Remote', '',
        '- Kotlin pairs as collaborator over pinned TLS and observes a protocol-2 event generation.',
        ...carrier === 'android' ? ['- A different application process restores the Keystore-encrypted identity without another pairing grant.'] : [],
        '- InteractionModel submits Blue and custom accessibility text with the delivered revision.',
        '- The Host settles exactly one Question tool result and completes the recorded turn.',
        '- SessionModel folds the durable snapshot and exposes the DONE assistant row.',
        '- FilesModel reads 1001 UTF-8 lines through the Session-derived scope without mixing file versions.',
        ...carrier === 'android' ? ['- Host revocation produces the classified refusal and an explicit reconnect control in the Activity.'] : [],
        '- Awaited model and transport retirement permits the JVM process to exit.',
      ].join('\n'), MODE)
    } catch (error) {
      const counts: Record<string, number> = {}
      for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
      console.info('Android model Host event counts', counts)
      if (page !== undefined) {
        const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-native-companion/', import.meta.url))
        await mkdir(folder, { recursive: true })
        await page.screenshot({ path: join(folder, 'host-question-failure.png') })
      }
      failures.push(error)
    }
    finally {
      await driver?.kill().catch((error: unknown) => { failures.push(error) })
      await browser?.close().catch((error: unknown) => { failures.push(error) })
      await scaffold.close().catch((error: unknown) => { failures.push(error) })
    }
    if (failures.length) throw new AggregateError(failures, 'Android companion model acceptance failed')
  }, 120_000)
}

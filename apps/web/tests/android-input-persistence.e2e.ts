/** Encrypted native input survives process death without automatic Host submission. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/question-composer/session.v3.jsonl', import.meta.url))
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android restores saved input in a different process without automatic submission', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  let browser: Browser | undefined
  const events: SessionEvent[] = []
  const failures: unknown[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  try {
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    const paired = await driver.request({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })
    expect(paired.type).toBe('ok')
    expect((await driver.request({ op: 'watchInteractions' })).type).toBe('ok')
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch({ ...(executablePath === undefined ? {} : { executablePath }), headless: true })
    const page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const prompt = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]
    expect(prompt).toBeDefined()
    const settled = scaffold.whenTurnSettled(120_000)
    const input = page.locator('[data-composer-input]').first()
    await writeComposerDraft(page, input, prompt as string)
    await input.press('Enter')
    await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })
    const custom = 'Include accessibility notes'
    expect(await driver.request({ op: 'fillQuestionDraft', custom })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'switchSessionTab' })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'assertQuestionDraft', custom })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'recreate' })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'assertQuestionDraft', custom })).toMatchObject({ type: 'ok', value: null })
    const questionCheckpoint = await driver.request({ op: 'inputCheckpoint' })
    expect(questionCheckpoint.type).toBe('ok')
    await driver.kill()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, false)
    const questionRestart = await driver.request({ op: 'assertRestored' })
    expect(questionRestart.type).toBe('ok')
    expect(questionRestart.value).not.toBe(questionCheckpoint.value)
    expect(await driver.request({ op: 'assertQuestionDraft', custom })).toMatchObject({ type: 'ok', value: null })
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(0)
    await driver.setHostReachable(false)
    expect(await driver.request({ op: 'failQuestionDraft', custom })).toMatchObject({ type: 'ok', value: null })
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(0)
    await driver.setHostReachable(true)
    expect(await driver.request({ op: 'assertQuestionDraft', custom })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'submitQuestionDraft' })).toMatchObject({ type: 'ok', value: null })
    const sessionId = await settled
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(await driver.request({ op: 'observeSession', sessionId })).toMatchObject({ type: 'ok', value: { done: true } })
    const text = 'Unsent native draft 中文'
    expect(await driver.request({ op: 'fillPromptDraft', text })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'watchInteractions' })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'assertPromptDraft', text })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'recreate' })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'assertPromptDraft', text })).toMatchObject({ type: 'ok', value: null })
    const promptCount = events.filter(event => event.type === 'user/message').length
    await driver.setHostReachable(false)
    expect(await driver.request({ op: 'failPromptDraft', text })).toMatchObject({ type: 'ok', value: null })
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(promptCount)
    const pending = await driver.request({ op: 'pendingPrompt', text })
    expect(pending.type).toBe('ok')
    const newer = 'Newer unsent text 中文'
    expect((await driver.request({ op: 'replacePromptDraft', text: newer })).type).toBe('ok')
    const checkpoint = await driver.request({ op: 'inputCheckpoint' })
    expect(checkpoint.type).toBe('ok')
    await driver.kill()
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, false)
    const restored = await driver.request({ op: 'assertRestored' })
    expect(restored.type).toBe('ok')
    expect(restored.value).not.toBe(checkpoint.value)
    expect(await driver.request({ op: 'assertPromptDraft', text: newer })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'pendingPrompt', text })).toMatchObject({ type: 'ok', value: pending.value })
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(promptCount)
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-input-persistence/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const screenshot = await driver.request({ op: 'screenshot' })
    expect(screenshot.type).toBe('ok')
    await writeFile(`${folder}/restored-input.png`, Buffer.from(screenshot.value as string, 'base64'))
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(promptCount)
    for (const damage of ['ciphertext', 'missing-key'] as const) {
      const damaged = await driver.request({ op: 'damageInputs', damage })
      expect(damaged.type).toBe('ok')
      await driver.kill()
      driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, false)
      expect((await driver.request({ op: 'assertRestored' })).type).toBe('ok')
      expect(await driver.request({ op: 'assertInputRecovery', damage, digest: damaged.value }))
        .toMatchObject({ type: 'ok', value: null })
      expect(events.filter(event => event.type === 'user/message')).toHaveLength(promptCount)
      expect(await driver.request({ op: 'recoverInputs', digest: damaged.value })).toMatchObject({ type: 'ok', value: null })
      expect(await driver.request({ op: 'observeSession', sessionId })).toMatchObject({ type: 'ok', value: { done: true } })
      expect((await driver.request({ op: 'fillPromptDraft', text: newer })).type).toBe('ok')
      expect((await driver.request({ op: 'inputCheckpoint' })).type).toBe('ok')
    }
    expect((await driver.request({ op: 'close' })).type).toBe('ok')
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-input-persistence.expected.md', import.meta.url)), [
      '# Android encrypted input persistence', '',
      '- A saved Question choice and custom answer survive force-stop and restoration in a different process.',
      '- Restoring input and transport does not answer the Host Question; explicit submission settles one result.',
      '- A failed explicit prompt saves its original request identity and text before dispatch.',
      '- Force-stop preserves the last selected Session, original pending prompt, and a newer composer draft.',
      '- A different process restores the same pending request identity without sending either retained text.',
      '- Process restoration uses the existing Host device grant.',
      '- Corrupt ciphertext and a missing input key preserve the original bytes and display explicit recovery.',
      '- Reading input does not recreate a missing key; explicit recovery preserves a byte-identical backup before saving empty input.',
    ].join('\n'), MODE)
  } catch (error) {
    const counts: Record<string, number> = {}
    for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
    console.info('Android input persistence Host event counts', counts)
    failures.push(error)
  }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android input persistence failed')
}, 300_000)

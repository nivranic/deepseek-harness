/** Native input survives UI replacement and failed explicit submissions against the real Host. */
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
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android retains explicit input across failed submissions and Activity recreation', async () => {
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
    expect((await driver.request({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })).type).toBe('ok')
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
    await driver.setHostReachable(true)
    expect(await driver.request({ op: 'assertPromptDraft', text })).toMatchObject({ type: 'ok', value: null })
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-input-retention/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const screenshot = await driver.request({ op: 'screenshot' })
    expect(screenshot.type).toBe('ok')
    await writeFile(`${folder}/unconfirmed-prompt.png`, Buffer.from(screenshot.value as string, 'base64'))
    expect(events.filter(event => event.type === 'user/message')).toHaveLength(promptCount)
    expect((await driver.request({ op: 'close' })).type).toBe('ok')
    expect(await driver.stop()).toBe(0)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-input-retention.expected.md', import.meta.url)), [
      '# Android explicit input retention', '',
      '- Question choices and custom text survive tab replacement and Activity recreation without submitting.',
      '- A failed explicit Question reply retains its inputs; restoring transport does not settle the interaction.',
      '- An explicit retry settles exactly one recorded Host Question result.',
      '- A Session draft survives tab replacement and Activity recreation.',
      '- A failed prompt submission keeps the exact text and displays a visible unconfirmed-send message.',
      '- Restoring transport does not submit the retained draft.',
      '- Input is currently model-owned; process-death persistence remains unqualified.',
    ].join('\n'), MODE)
  } catch (error) {
    const counts: Record<string, number> = {}
    for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
    console.info('Android input retention Host event counts', counts)
    failures.push(error)
  }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android input retention failed')
}, 200_000)

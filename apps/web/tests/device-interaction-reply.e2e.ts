/** Device-owned replies through the shipped Web profile and a recorded Question turn. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/question-composer/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/device-interaction-reply.expected.md', import.meta.url))

it.skipIf(MODE === 'record')('requires the stream device signature before a recorded Question can settle', async () => {
  const scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 15, compareReplaySession: true })
  let browser: Browser | undefined
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  const pair = async () => {
    const keys = generateKeyPairSync('ed25519')
    const code = scaffold.ctx.deviceTrust.issuePairing('controller').code
    const grant = await scaffold.ctx.deviceTrust.redeemPairing({
      code, deviceName: 'reply-test', devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    })
    return () => {
      const timestamp = Date.now()
      const nonce = randomUUID()
      const deviceId = grant.deviceId
      const signature = sign(null, Buffer.from(`${deviceId}\n${timestamp}\n${nonce}`), keys.privateKey).toString('base64')
      return { deviceId, timestamp, nonce, signature }
    }
  }
  try {
    const ownAdmission = await pair()
    const otherAdmission = await pair()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await newEnglishPage(browser)
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; endpoint?: string; payload?: { args: Record<string, unknown> } }
        if (frame.type === 'open' && frame.endpoint === '$events' && frame.payload !== undefined) {
          frame.payload.args.device = ownAdmission()
          server.send(JSON.stringify(frame))
        } else server.send(message)
      })
    })
    const checked = Promise.withResolvers<undefined>()
    const outcome = checked.promise.catch((error: unknown) => error)
    const rejections: string[] = []
    await page.route('**/api/$events/result', async (route) => {
      try {
        const request = route.request().postDataJSON() as { payload: { args: unknown; apiProtocolVersion: number } }
        const invalid = { ...ownAdmission(), signature: otherAdmission().signature }
        for (const [label, device, code] of [
          ['missing', undefined, 'gateway/permission-denied'],
          ['other-device', otherAdmission(), 'gateway/permission-denied'],
          ['wrong-signature', invalid, 'device/key-invalid'],
        ] as const) {
          const response = await route.fetch({ postData: JSON.stringify({
            ...request, payload: { ...request.payload, ...(device === undefined ? {} : { device }) },
          }) })
          expect(await response.json()).toMatchObject({ result: { ok: false, error: { code } } })
          expect(events.some(event => event.type === 'tool/result')).toBe(false)
          rejections.push(`${label}: ${code}; Question remains pending`)
        }
        const response = await route.fetch({ postData: JSON.stringify({
          ...request, payload: { ...request.payload, device: ownAdmission() },
        }) })
        expect(await response.json()).toMatchObject({ result: { ok: true } })
        await route.fulfill({ response })
        checked.resolve(undefined)
      } catch (error) {
        checked.reject(error)
        await route.abort()
      }
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const prompt = fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]
    expect(prompt).toBeDefined()
    const settled = scaffold.whenTurnSettled(60_000)
    const input = page.locator('[data-composer-input]').first()
    await writeComposerDraft(page, input, prompt as string)
    await input.press('Enter')
    const panel = page.locator('[data-question-key]')
    await panel.waitFor({ timeout: 30_000 })
    await panel.getByRole('checkbox', { name: 'Blue' }).click()
    await panel.getByRole('textbox').fill('Include accessibility notes')
    await panel.getByRole('textbox').press('Enter')
    expect(await outcome).toBeUndefined()
    await settled
    await expect.poll(() => page.getByText('DONE', { exact: true }).count()).toBeGreaterThanOrEqual(1)
    expect(await panel.count()).toBe(0)
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    await compareOrRefreshGolden(EXPECTED, [
      '# Device-owned Question reply', '', ...rejections.map(line => `- ${line}`),
      '- Matching device: accepted; exactly one Tool settlement; recorded turn completes with DONE',
    ].join('\n'), MODE)
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})

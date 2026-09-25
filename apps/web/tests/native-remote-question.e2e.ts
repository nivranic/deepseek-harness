/** Recorded Question over an opt-in profile TLS source, with a test-native client carrying the browser event bridge. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type { RedeemPairingResult } from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import { NativeTestClient } from './native-remote-support.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/question-composer/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/native-remote-question.expected.md', import.meta.url))

it.skipIf(MODE === 'record')('answers a recorded Question through the pinned TLS native source', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE, paceMs: 15, compareReplaySession: true,
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  const native = new NativeTestClient(scaffold.ctx.nativeRemote.describe())
  let browser: Browser | undefined
  const failures: unknown[] = []
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  const pair = async () => {
    const keys = generateKeyPairSync('ed25519')
    const code = scaffold.ctx.deviceTrust.issuePairing('controller').code
    const request = {
      code, deviceName: 'reply-test', devicePublicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    }
    const redeem = async () => {
      const response = await native.post('/api/deviceTrust/redeemPairing', JSON.stringify({
        type: 'client-request', rpcId: randomUUID(), method: 'deviceTrust/redeemPairing',
        payload: { apiProtocolVersion: 2, args: { request } },
      }))
      expect(response.status).toBe(200)
      return await response.json() as { result:
        { ok: true; value: RedeemPairingResult } | { ok: false; error: { code: string } } }
    }
    const replies = await Promise.all([redeem(), redeem()])
    const granted = replies.filter(reply => reply.result.ok)
    const rejected = replies.filter(reply => !reply.result.ok)
    expect(granted).toHaveLength(1)
    expect(rejected).toMatchObject([{ result: { ok: false, error: { code: 'device/pairing-invalid' } } }])
    const result = granted[0]?.result
    if (result?.ok !== true) throw new Error('pairing must produce one grant')
    const grant = result.value
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
    await page.routeWebSocket('**/api/remote.mux', async (socket) => {
      const server = await native.mux()
      server.on('message', (data) => {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
        socket.send(bytes.toString())
      })
      server.on('close', () => { void socket.close().catch((error: unknown) => { failures.push(error) }) })
      server.on('error', () => {
        void socket.close({ code: 1011, reason: 'native test carrier failed' }).catch((error: unknown) => { failures.push(error) })
      })
      socket.onClose(() => { server.close() })
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as {
          type?: string
          endpoint?: string
          payload?: { args: Record<string, unknown>; apiProtocolVersion?: number; device?: unknown }
        }
        if (frame.type === 'open' && frame.payload !== undefined) {
          frame.payload.apiProtocolVersion = 2
          if (frame.endpoint === '$events') frame.payload.args.device = ownAdmission()
          else frame.payload.device = ownAdmission()
        }
        server.send(JSON.stringify(frame))
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
          const response = await native.post('/api/$events/result', JSON.stringify({
            ...request, payload: { ...request.payload, ...(device === undefined ? {} : { device }) },
          }))
          expect(await response.json()).toMatchObject({ result: { ok: false, error: { code } } })
          expect(events.some(event => event.type === 'tool/result')).toBe(false)
          rejections.push(`${label}: ${code}; Question remains pending`)
        }
        const response = await native.post('/api/$events/result', JSON.stringify({
          ...request, payload: { ...request.payload, device: ownAdmission() },
        }))
        expect(await response.clone().json()).toMatchObject({ result: { ok: true } })
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
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
      '# Native TLS Question reply', '', ...rejections.map(line => `- ${line}`),
      '- Each code presented twice over Gateway RPC: exactly one device grant; the duplicate is rejected',
      '- Matching device: accepted; exactly one Tool settlement; recorded turn completes with DONE',
      '- Pairing, event stream, and reply cross the separately mounted TLS source after SPKI verification',
    ].join('\n'), MODE)
  } catch (error) {
    failures.push(error)
  } finally {
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await native.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Device pairing and reply scenario failed')
})

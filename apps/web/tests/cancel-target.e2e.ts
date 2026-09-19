/** Delayed cancellation retries across two real turns and two browser Clients. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { fixtureUserPrompts, launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('keeps a later turn running when a Client retries an earlier cancellation', async () => {
  const fixture = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  await mkdir('.artifacts/cancel-target-browser', { recursive: true })
  const run = await mkdtemp(resolve('.artifacts/cancel-target-browser/run-'))
  const ready = [join(run, 'first-ready'), join(run, 'second-ready')]
  const replayOverride = join(run, 'replay.override.json')
  await writeFile(replayOverride, JSON.stringify(ready.map(readyFile => ({ kind: 'hang', readyFile }))), { flag: 'wx' })
  const scaffold = await launchWebScaffold({ replayFixture: fixture, replayOverride, compareReplaySession: false })
  let browser: Browser | undefined
  const failures: unknown[] = []
  const releaseResponse = Promise.withResolvers<undefined>()
  const cancelled = Promise.withResolvers<ServerResponse>()
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  try {
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const first = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    let firstBody: string | null = null
    await first.route('**/api/session/cancelTurn', async (route) => {
      firstBody = route.request().postData()
      const response = await route.fetch()
      cancelled.resolve(await response.json() as ServerResponse)
      await releaseResponse.promise
      await route.fulfill({ response })
    })
    await first.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(first, scaffold.workspaceCwd)
    const input = first.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill(prompt)
    await input.press('Enter')
    await expect.poll(() => existsSync(ready[0]!)).toBe(true)
    const firstEnded = scaffold.whenTurnSettled()
    await first.getByRole('button', { name: 'Stop generating', exact: true }).click()
    expect((await cancelled.promise).result).toEqual({ ok: true, value: { accepted: true } })
    const sessionId = await firstEnded
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('cancelled Session has no Agent')
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Cancel target fixture' })

    const second = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await second.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await second.getByRole('treeitem').filter({ hasText: 'Cancel target fixture' }).click()
    const secondInput = second.locator('[data-composer-input][contenteditable="true"]').first()
    await secondInput.waitFor()
    await secondInput.fill(prompt)
    await secondInput.press('Enter')
    await expect.poll(() => existsSync(ready[1]!)).toBe(true)
    expect(agent.status).toBe('running')
    if (firstBody === null) throw new Error('Client did not use targeted cancellation')
    const retried = await scaffold.hostFetch('/api/session/cancelTurn', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: firstBody,
    })
    expect((await retried.json() as ServerResponse).result).toEqual({ ok: true, value: { accepted: true } })
    expect(agent.status).toBe('running')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    releaseResponse.resolve(undefined)

    const secondEnded = scaffold.whenTurnSettled()
    const secondRequest = second.waitForRequest('**/api/session/cancelTurn')
    await second.getByRole('button', { name: 'Stop generating', exact: true }).click()
    const latestBody = (await secondRequest).postDataJSON() as { payload: { args: { request: { turnStartSeq: number } } } }
    const originalBody = JSON.parse(firstBody) as typeof latestBody
    expect(latestBody.payload.args.request.turnStartSeq).toBeGreaterThan(originalBody.payload.args.request.turnStartSeq)
    expect(await secondEnded).toBe(sessionId)
    const outcomes = events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : [])
    expect(outcomes).toEqual(['aborted', 'aborted'])
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    await expect.poll(() => second.getByRole('button', { name: 'Stop generating', exact: true }).count()).toBe(0)
    await second.screenshot({ path: '.artifacts/cancel-target-browser/settled.png', fullPage: true })
  } catch (error) {
    failures.push(error)
  } finally {
    releaseResponse.resolve(undefined)
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Cancel target verification failed')
}, 120_000)

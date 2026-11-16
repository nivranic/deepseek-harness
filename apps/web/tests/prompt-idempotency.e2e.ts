/** Prompt retries through the real browser, Gateway, durable inbox and recorded model response. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, vi } from 'vitest'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { fixtureUserPrompts, launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('accepts concurrent and claimed Prompt retries once and reproduces the recorded Session', async () => {
  const fixture = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
  const prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
  expect(prompts).toHaveLength(1)
  const scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: true })
  let browser: Browser | undefined
  const failures: unknown[] = []
  const releaseAdmission = Promise.withResolvers<undefined>()
  const claimed = Promise.withResolvers<undefined>()
  const releaseStep = Promise.withResolvers<undefined>()
  const events: SessionEvent[] = []
  const admit = scaffold.ctx.attachments.admitPromptContent.bind(scaffold.ctx.attachments)
  let admissions = 0
  const admission = vi.spyOn(scaffold.ctx.attachments, 'admitPromptContent').mockImplementation(async (content) => {
    const result = await admit(content)
    if (++admissions === 2) releaseAdmission.resolve(undefined)
    await releaseAdmission.promise
    return result
  })
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  const stopHolding = scaffold.ctx.on('agent/pre-step', async (_payload, next) => {
    claimed.resolve(undefined)
    await releaseStep.promise
    return next()
  })
  try {
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const answered = Promise.withResolvers<readonly ServerResponse[]>()
    let requestBody: string | null = null
    await page.route('**/api/session/prompt', async (route) => {
      requestBody = route.request().postData()
      const responses = await Promise.all([route.fetch(), route.fetch()])
      answered.resolve(await Promise.all(responses.map(response => response.json() as Promise<ServerResponse>)))
      await route.fulfill({ response: responses[0] })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill(prompts[0]!)
    await input.press('Enter')
    const concurrent = await answered.promise
    expect(concurrent.map(response => response.result)).toEqual([
      { ok: true, value: { accepted: true } }, { ok: true, value: { accepted: true } },
    ])
    await claimed.promise
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(0)
    if (requestBody === null) throw new Error('browser did not submit a Prompt')
    const retry = await scaffold.hostFetch('/api/session/prompt', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody,
    })
    expect((await retry.json() as ServerResponse).result).toEqual({ ok: true, value: { accepted: true } })
    expect(admissions).toBe(2)
    releaseStep.resolve(undefined)
    const sessionId = await settled
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('settled Prompt has no Agent')
    const inserted = events.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
    expect(inserted).toHaveLength(1)
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(1)
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(agent.inbox.nextStep).toHaveLength(0)
    const response = events.find(event => event.type === 'assistant/message')
    if (response?.type !== 'assistant/message') throw new Error('recorded model did not answer')
    const answer = response.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    await expect.poll(() => page.getByText(answer, { exact: true }).count()).toBe(1)
    await mkdir('.artifacts/prompt-idempotency-browser', { recursive: true })
    await page.screenshot({ path: '.artifacts/prompt-idempotency-browser/settled.png', fullPage: true })
  } catch (error) {
    console.error('Prompt retry event sequence', JSON.stringify(events.map(event => ({
      type: event.type,
      ...(event.type === 'turn/end' ? { reason: event.data.reason } : {}),
    }))))
    failures.push(error)
  } finally {
    releaseAdmission.resolve(undefined)
    releaseStep.resolve(undefined)
    stopHolding()
    admission.mockRestore()
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Prompt retry verification failed')
}, 120_000)

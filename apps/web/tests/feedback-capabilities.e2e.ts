/** Real log-backed feedback refusals, retained drafts, and delayed mutation acknowledgements. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RemoteEventDownlinkFrame } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { launchWebScaffold } from './scaffold.ts'

it('retains Feedback drafts across reconnect and acknowledges a late success without closing a replacement draft', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let readyFrames = 0
  let refusePut = true
  let cancelledPuts = 0
  const held = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const output = '.artifacts/feedback-capability-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Feedback lifecycle')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Feedback fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Feedback lifecycle fixture' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'Feedback lifecycle answer' }], source: { provider: 'test', model: 'test' } }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Feedback lifecycle session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const feedbackEvents = () => agent.session.snapshotEvents().filter(event => event.type.startsWith('feedback/')).map(event => event.type)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/messageFeedback/') || endpoint.startsWith('/api/sessionFeedback/')) calls.push(endpoint)
    })
    page.on('requestfailed', (request) => { if (new URL(request.url()).pathname === '/api/messageFeedback/put') cancelledPuts++ })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/messageFeedback/put', async (route) => {
      if (refusePut) {
        const request = route.request().postDataJSON() as { rpcId: string }
        await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
          ok: false, error: { code: 'future/feedback-unavailable', message: 'Feedback storage unavailable', details: {} },
        } } })
        return
      }
      const response = await route.fetch()
      held.resolve(undefined)
      await release.promise
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').filter({ hasText: 'Feedback lifecycle session' }).click({ timeout: 30_000 })
    await page.getByText('Feedback lifecycle answer', { exact: true }).waitFor()
    await expect.poll(() => readyFrames).toBe(1)
    const input = page.locator('[data-composer-input]')
    await input.fill('retain message draft')
    const like = page.getByRole('button', { name: 'Good response', exact: true })
    const dislike = page.getByRole('button', { name: 'Bad response', exact: true })
    const remove = page.getByRole('button', { name: 'Remove rating', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Submit feedback' })
    const details = dialog.getByRole('textbox', { name: 'Feedback details' })
    const reconnect = async () => {
      const target = readyFrames + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => readyFrames, { timeout: 10_000 }).toBe(target)
    }
    await like.hover()
    await expect.poll(() => calls.filter(call => call === '/api/messageFeedback/list').length).toBeGreaterThan(0)
    await like.click()
    const draft = 'one real positive feedback'
    await details.fill(draft)
    await reconnect()
    expect(await details.inputValue()).toBe(draft)
    expect(await input.textContent()).toBe('retain message draft')
    expect(calls.filter(call => call.endsWith('/put'))).toEqual([])
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await page.getByText('Could not save feedback', { exact: true }).waitFor()
    expect(await details.inputValue()).toBe(draft)
    expect(feedbackEvents()).toEqual([])
    expect(await remove.count()).toBe(0)
    refusePut = false
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await held.promise
    expect(feedbackEvents()).toEqual(['feedback/message-put'])
    await reconnect()
    expect(await details.inputValue()).toBe(draft)
    expect(await details.getAttribute('readonly')).not.toBeNull()
    expect(calls.filter(call => call.endsWith('/put'))).toHaveLength(2)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await dislike.click()
    const replacementDraft = 'replacement feedback draft'
    await details.fill(replacementDraft)
    release.resolve(undefined)
    await page.getByText('Thanks for your feedback', { exact: true }).waitFor()
    expect(await details.inputValue()).toBe(replacementDraft)
    await expect.poll(() => remove.getAttribute('aria-pressed')).toBe('true')
    expect(calls.filter(call => call.endsWith('/put'))).toHaveLength(2)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await remove.click()
    await expect.poll(() => remove.count()).toBe(0)
    await like.waitFor()
    await dislike.waitFor()
    await input.fill('/feedback')
    await input.press('Enter')
    await details.fill('one real session feedback')
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    const events = feedbackEvents()
    expect(events).toEqual(['feedback/message-put', 'feedback/message-delete', 'feedback/record'])
    const mutations = calls.filter(call => !call.endsWith('/list'))
    expect(mutations).toEqual(['/api/messageFeedback/put', '/api/messageFeedback/put', '/api/messageFeedback/delete', '/api/sessionFeedback/record'])
    expect(cancelledPuts).toBe(0)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/recorded.png`, fullPage: true })
    const actual = { unsentDraftRetainedAcrossReconnect: true, refusalHasNoPersistedFeedback: true,
      draftRetainedAfterRefusal: true, composerDraftRetained: true, submittingDraftRetainedAcrossReconnect: true,
      replacementFeedbackDraftRetained: true, lateSuccessAcknowledged: true, cancelledPuts, events, mutations,
      noMutationReplay: true }
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/feedback.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } finally {
    release.resolve(undefined)
    await page?.unrouteAll({ behavior: 'wait' })
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

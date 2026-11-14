/** Real log-backed feedback with controlled discovery and delayed mutation acknowledgement. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'

it('separates Feedback operations and discards old dialogs and acknowledgements across reconnect', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const capabilities = ['feedback.message.read.v1', 'feedback.message.put.v1', 'feedback.message.delete.v1', 'feedback.session.record.v1']
  let supported: string[] = []
  let negotiations = 0
  let delayed = false
  let cancelledPuts = 0
  const release = Promise.withResolvers<undefined>()
  const delivered = Promise.withResolvers<undefined>()
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const output = '.artifacts/feedback-capability-browser'
  try {
    scaffold = await launchWebScaffold()
    const path = join(scaffold.workspaceCwd, 'Feedback capabilities')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Feedback fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Feedback capability fixture' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'Feedback capability answer' }], source: { provider: 'test', model: 'test' } }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Feedback capability session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/messageFeedback/') || endpoint.startsWith('/api/sessionFeedback/')) calls.push(endpoint)
    })
    page.on('requestfailed', (request) => { if (new URL(request.url()).pathname === '/api/messageFeedback/put') cancelledPuts++ })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Feedback discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining(capabilities))
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !capabilities.includes(id) || supported.includes(id)),
      } } } })
    })
    await page.route('**/api/messageFeedback/put', async (route) => {
      const response = await route.fetch()
      delayed = true
      await release.promise
      await route.fulfill({ response })
      delivered.resolve(undefined)
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').filter({ hasText: 'Feedback capability session' }).click({ timeout: 30_000 })
    await page.getByText('Feedback capability answer', { exact: true }).waitFor()
    const input = page.locator('[data-composer-input]')
    await input.fill('retain message draft')
    const like = page.getByRole('button', { name: 'Good response', exact: true })
    const dislike = page.getByRole('button', { name: 'Bad response', exact: true })
    const remove = page.getByRole('button', { name: 'Remove rating', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Submit feedback' })
    const details = dialog.getByRole('textbox', { name: 'Feedback details' })
    expect(await like.count()).toBe(0)
    expect(calls).toEqual([])
    const reconnect = async (next: string[]) => {
      supported = next
      const target = negotiations + 1
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    await reconnect(['feedback.message.read.v1'])
    await expect.poll(() => calls.filter(call => call === '/api/messageFeedback/list').length).toBeGreaterThan(0)
    expect(await like.count()).toBe(0)
    expect(await dislike.count()).toBe(0)
    await reconnect(['feedback.message.read.v1', 'feedback.message.put.v1'])
    await like.click()
    await details.fill('withdraw this unsent feedback draft')
    await reconnect(['feedback.message.read.v1', 'feedback.message.delete.v1'])
    await expect.poll(() => dialog.count()).toBe(0)
    expect(await input.textContent()).toBe('retain message draft')
    expect(calls.filter(call => call.endsWith('/put'))).toHaveLength(0)
    await reconnect(['feedback.message.read.v1', 'feedback.message.put.v1'])
    await like.click()
    await details.fill('one real positive feedback')
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect.poll(() => delayed).toBe(true)
    await reconnect(['feedback.message.read.v1', 'feedback.message.put.v1'])
    await expect.poll(() => cancelledPuts).toBe(1)
    await expect.poll(() => dialog.count()).toBe(0)
    await dislike.click()
    await details.fill('replacement connection feedback draft')
    release.resolve(undefined)
    await delivered.promise
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await details.inputValue()).toBe('replacement connection feedback draft')
    expect(await page.getByRole('alert').count()).toBe(0)
    expect(await remove.count()).toBe(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await reconnect(['feedback.message.read.v1', 'feedback.message.delete.v1'])
    await remove.click()
    await expect.poll(() => remove.count()).toBe(0)
    expect(await like.count()).toBe(0)
    expect(await dislike.count()).toBe(0)
    await reconnect(['feedback.session.record.v1'])
    await input.fill('/feedback')
    await input.press('Enter')
    await details.fill('one real session feedback')
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    const events = agent.session.snapshotEvents().filter(event => event.type.startsWith('feedback/')).map(event => event.type)
    expect(events).toEqual(['feedback/message-put', 'feedback/message-delete', 'feedback/record'])
    const mutations = calls.filter(call => !call.endsWith('/list'))
    expect(mutations).toEqual(['/api/messageFeedback/put', '/api/messageFeedback/delete', '/api/sessionFeedback/record'])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/recorded.png', fullPage: true })
    const actual = { noUnsupportedProbes: true, readOnlyHasNoMutationButtons: true, unsentDialogWithdrawn: true,
      composerDraftRetained: true, replacementFeedbackDraftRetained: true, oldAcknowledgementSuppressed: true,
      cancelledPuts, events, mutations, noMutationReplay: true, modelRequests: 0, discoveryControlled: true, putReplyControlled: true }
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/feedback.expected.json', import.meta.url), 'utf8')))
  } finally {
    release.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

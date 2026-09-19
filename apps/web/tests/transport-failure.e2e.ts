/** Real browser classification of a lost Prompt request without automatic mutation replay. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it.each(['en-US', 'zh-CN'].flatMap(locale => ['json', 'binary', 'interaction'].map(kind => ({ locale, kind }))))
('suspends invalid $kind stream data with explicit recovery in $locale', async ({ locale, kind }) => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let negotiations = 0
  let prompts = 0
  const sockets: WebSocketRoute[] = []
  let eventStream: string | undefined
  try {
    const path = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    scaffold.ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message') prompts++
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale })
    await page.clock.install()
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/host/negotiate') negotiations++
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type: string; endpoint?: string; streamId: string }
        if (frame.type === 'open' && frame.endpoint === '$events') eventStream = frame.streamId
        server.send(message)
      })
      sockets.push(socket)
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ timeout: 30_000 })
    const draft = 'INVALID_STREAM_MUST_NOT_SEND'
    await input.fill(draft)
    expect(eventStream).toBeDefined()
    const initialNegotiations = negotiations
    const initialSockets = sockets.length
    const invalid = kind === 'json' ? 'not json' : kind === 'binary' ? Buffer.from([1, 2, 3]) : JSON.stringify({
      type: 'item', streamId: eventStream, value: {
        type: 'waterfall', event: 'user/approval', eventId: 'invalid-record', agentId: 'invalid-agent', request: {},
        interaction: { requestId: 'invalid-record', sessionId: 'invalid-session', type: 'approval',
          requiredPermission: 'approval.respond', createdAt: 0, status: 'pending', revision: -1 },
      },
    })
    sockets.at(-1)!.send(invalid)
    const label = locale === 'zh-CN' ? 'Host 数据不可用' : 'Host data unavailable'
    const action = locale === 'zh-CN'
      ? 'Host 数据无效或不可用，自动重试已暂停；请检查 Host 后点击重连'
      : 'Host data is invalid or unavailable. Automatic retries are paused; check Host, then reconnect'
    const control = page.getByRole('button', { name: action, exact: true })
    await control.waitFor()
    expect(await control.textContent()).toContain(label)
    await page.clock.fastForward(60_000)
    expect(negotiations).toBe(initialNegotiations)
    expect(sockets.length).toBe(initialSockets)
    expect(prompts).toBe(0)
    const output = '.artifacts/invalid-stream-errors-browser'
    await mkdir(output, { recursive: true })
    const name = `${locale}-${kind}`
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
    await control.click()
    await input.waitFor()
    await expect.poll(() => input.textContent()).toBe(draft)
    const observation = { locale, kind, label, action, automaticReconnects: 0,
      manualReconnects: negotiations - initialNegotiations, replacementSockets: sockets.length - initialSockets,
      draftPreserved: await input.textContent() === draft, prompts, browserClockAdvanceMs: 60_000 }
    const expected = JSON.parse(await readFile(new URL(`./expected/invalid-stream-${name}.expected.json`, import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(join(output, `${name}.json`), JSON.stringify(observation, null, 2) + '\n')
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('reports an interrupted Prompt transport and preserves explicit retry after reconnect', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let requests = 0
  let negotiations = 0
  let acceptedPrompts = 0
  const sockets: WebSocketRoute[] = []
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message') acceptedPrompts++
  })
  try {
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/host/negotiate') negotiations++
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/session/prompt', async (route) => {
      requests++
      await route.abort('connectionfailed')
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill('TRANSPORT_FAILURE_MUST_NOT_REPLAY')
    await input.press('Enter')
    const failure = page.getByText(/gateway\/transport-interrupted/).first()
    await failure.waitFor()
    const errorText = await failure.textContent()
    const output = '.artifacts/transport-failure-semantics-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'interrupted.png'), fullPage: true })
    const nextNegotiation = negotiations + 1
    const nextSocket = sockets.length + 1
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations).toBe(nextNegotiation)
    await expect.poll(() => sockets.length).toBe(nextSocket)
    await page.getByText('Connected', { exact: true }).filter({ visible: true }).waitFor()
    await input.waitFor()
    const requestsAfterReconnect = requests
    const draft = await input.textContent()
    await input.press('Enter')
    await expect.poll(() => requests).toBe(2)
    await expect.poll(() => input.textContent()).toBe(draft)
    const observation = { errorText, requestsAfterReconnect, explicitRetryRequests: requests, draft, acceptedPrompts, reconnected: true }
    const expected = JSON.parse(await readFile(new URL('./expected/transport-failure.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

/** Real browser recovery from invalid streams and a lost Prompt without mutation replay. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it.each(['en-US', 'zh-CN'].flatMap(locale => ['json', 'binary', 'interaction'].map(kind => ({ locale, kind }))))
('recovers invalid $kind stream data through automatic and explicit reconnect in $locale', async ({ locale, kind }) => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let prompts = 0
  let readyFrames = 0
  let holdReady = false
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
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type: string; endpoint?: string; streamId: string }
        if (frame.type === 'open' && frame.endpoint === '$events') eventStream = frame.streamId
        server.send(message)
      })
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; value?: { type?: string } }
        if (frame.type === 'item' && frame.value?.type === 'ready') {
          if (holdReady) return
          readyFrames++
        }
        socket.send(message)
      })
      sockets.push(socket)
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ timeout: 30_000 })
    await expect.poll(() => readyFrames).toBe(1)
    const draft = 'INVALID_STREAM_MUST_NOT_SEND'
    await input.fill(draft)
    expect(eventStream).toBeDefined()
    const initialSockets = sockets.length
    const invalid = kind === 'json' ? 'not json' : kind === 'binary' ? Buffer.from([1, 2, 3]) : JSON.stringify({
      type: 'item', streamId: eventStream, value: {
        type: 'waterfall', event: 'approval/request', eventId: 'invalid-record', agentId: 'invalid-agent', request: [],
      },
    })
    // Withhold the replacement handshake so the automatic attempt and its manual override stay observable.
    holdReady = true
    sockets.at(-1)!.send(invalid)
    await expect.poll(() => sockets.length, { timeout: 10_000 }).toBe(initialSockets + 1)
    const label = locale === 'zh-CN' ? '重新连接中' : 'Reconnecting'
    const action = locale === 'zh-CN' ? '连接中断，正在重试，点击立即重连' : 'Reconnecting, reconnect now'
    const control = page.getByRole('button', { name: action, exact: true })
    await control.waitFor()
    expect(await control.textContent()).toMatch(new RegExp(`^${label}`))
    expect(prompts).toBe(0)
    const automaticAttempts = sockets.length - initialSockets
    const output = '.artifacts/invalid-stream-errors-browser'
    await mkdir(output, { recursive: true })
    const name = `${locale}-${kind}`
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
    holdReady = false
    await control.click()
    await expect.poll(() => sockets.length).toBe(initialSockets + 2)
    await expect.poll(() => readyFrames).toBe(2)
    await input.waitFor()
    await expect.poll(() => input.textContent()).toBe(draft)
    const observation = { locale, kind, label, action, automaticAttempts,
      manualReconnects: sockets.length - initialSockets - automaticAttempts, replacementSockets: sockets.length - initialSockets,
      draftPreserved: await input.textContent() === draft, prompts }
    const expected: unknown = JSON.parse(await readFile(new URL(`./expected/invalid-stream-${name}.expected.json`, import.meta.url), 'utf8'))
    await writeFile(join(output, `${name}.json`), JSON.stringify(observation, null, 2) + '\n')
    expect(observation).toEqual(expected)
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('reports an interrupted Prompt transport and preserves explicit retry after reconnect', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let requests = 0
  let readyFrames = 0
  let acceptedPrompts = 0
  const sockets: WebSocketRoute[] = []
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message') acceptedPrompts++
  })
  try {
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: { type?: string } }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
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
    const failure = page.getByText(/client api: session\/prompt failed:/).first()
    await failure.waitFor()
    const errorText = await failure.textContent()
    const output = '.artifacts/transport-failure-semantics-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'interrupted.png'), fullPage: true })
    const nextReady = readyFrames + 1
    const nextSocket = sockets.length + 1
    await sockets.at(-1)!.close()
    await expect.poll(() => sockets.length).toBe(nextSocket)
    await expect.poll(() => readyFrames).toBe(nextReady)
    await input.waitFor()
    const requestsAfterReconnect = requests
    const draft = await input.textContent()
    await input.press('Enter')
    await expect.poll(() => requests).toBe(2)
    await expect.poll(() => input.textContent()).toBe(draft)
    const observation = { errorText, requestsAfterReconnect, explicitRetryRequests: requests, draft, acceptedPrompts, reconnected: true }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/transport-failure.expected.json', import.meta.url), 'utf8'))
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
    expect(observation).toEqual(expected)
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

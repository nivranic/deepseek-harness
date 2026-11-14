/** Real Host command catalog changes, refusal diagnostics, and delayed acknowledgments. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { RemoteEventDownlinkFrame } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('presents an unknown command rejection with its original code and diagnostic', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let runs = 0
  let requests = 0
  try {
    scaffold.ctx.commands.register({ name: 'proof', description: 'Command rejection probe', risk: 'low', handler: () => {
      runs++
      return { kind: 'success' }
    } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await page.route('**/api/commands/execute', async (route) => {
      requests++
      const request = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
        ok: false, error: { code: 'future/command-unavailable', message: 'Host command unavailable', details: { reason: 'maintenance' } },
      } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill('/proof')
    await input.press('Enter')
    const notice = page.getByText('command.execute failed: future/command-unavailable: Host command unavailable', { exact: true })
    await notice.waitFor()
    const output = '.artifacts/remote-error-propagation-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/command-error.png`, fullPage: true })
    const observation = { notice: await notice.textContent(), requests, runs }
    await writeFile(`${output}/command.json`, JSON.stringify(observation, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/remote-error-command.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
  } finally {
    await page?.unrouteAll({ behavior: 'wait' })
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('refreshes the real Host command catalog and retries a refused draft once across reconnect', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let unregister: (() => void) | undefined
  let readyFrames = 0
  let runs = 0
  let userMessages = 0
  let delayed = false
  let refuse = true
  const reply = Promise.withResolvers<undefined>()
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const commandEvents: string[] = []
  const output = '.artifacts/commands-capability-browser'
  try {
    scaffold.ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message') userMessages++
      if (event.type === 'command/run' || event.type === 'command/done') commandEvents.push(event.type)
    })
    const definition: CommandDefinition = {
      name: 'proof', description: 'Command catalog probe', risk: 'low', input: { hint: 'retained text' },
      handler: () => {
        runs++
        return { kind: 'success' }
      },
    }
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/commands/')) calls.push(path)
    })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/commands/execute', async (route) => {
      if (refuse) {
        const request = route.request().postDataJSON() as { rpcId: string }
        await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
          ok: false, error: { code: 'future/command-unavailable', message: 'Host command unavailable', details: { reason: 'maintenance' } },
        } } })
        return
      }
      const response = await route.fetch()
      delayed = true
      await reply.promise
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    const proof = menu.getByRole('option', { name: /proof/u })
    const localFile = menu.getByRole('option', { name: /File/u })
    const observations: Array<{ stage: string; hostRows: number; localRows: number; runs: number }> = []
    const openMenu = async () => {
      await input.fill('')
      await input.fill('/')
      await localFile.waitFor()
    }
    const observe = async (stage: string) => {
      observations.push({ stage, hostRows: await proof.count(), localRows: await localFile.count(), runs })
    }
    const reconnect = async () => {
      const target = readyFrames + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => readyFrames, { timeout: 10_000 }).toBe(target)
    }
    await expect.poll(() => readyFrames).toBe(1)
    await openMenu()
    expect(await proof.count()).toBe(0)
    await observe('unregistered')
    unregister = scaffold.ctx.commands.register(definition)
    await reconnect()
    await openMenu()
    await proof.waitFor()
    await observe('registered')
    const draft = '/proof keep this draft'
    await input.fill(draft)
    await input.press('Enter')
    await page.getByText('command.execute failed: future/command-unavailable: Host command unavailable', { exact: true }).waitFor()
    expect(await input.textContent()).toBe(draft)
    expect(runs).toBe(0)
    expect(commandEvents).toEqual([])
    refuse = false
    await input.press('Enter')
    await expect.poll(() => delayed).toBe(true)
    expect(runs).toBe(1)
    unregister()
    unregister = undefined
    await reconnect()
    expect(calls.filter(path => path.endsWith('/execute'))).toHaveLength(2)
    reply.resolve(undefined)
    await expect.poll(() => input.textContent()).toBe('')
    await openMenu()
    expect(await proof.count()).toBe(0)
    await observe('removed-after-execution')
    unregister = scaffold.ctx.commands.register(definition)
    await reconnect()
    await openMenu()
    await proof.waitFor()
    await observe('restored')
    expect(runs).toBe(1)
    expect(userMessages).toBe(0)
    expect(commandEvents).toEqual(['command/run', 'command/done'])
    expect(calls.filter(path => path.endsWith('/execute'))).toHaveLength(2)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/restored.png`, fullPage: true })
    const actual = { observations, draftRetainedAfterRefusal: true, executionRequests: 2, handlerRuns: runs,
      lateSuccessAcknowledged: true, commandEvents, userMessages }
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/commands.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } finally {
    reply.resolve(undefined)
    await page?.unrouteAll({ behavior: 'wait' })
    unregister?.()
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

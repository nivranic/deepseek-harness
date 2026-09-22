/** Real Host command advertisement with controlled discovery withdrawal and delayed reply delivery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-commands'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('presents an unknown command rejection without replacing its diagnostic', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let runs = 0
  let requests = 0
  try {
    scaffold.ctx.commands.register({ name: 'proof', description: 'Command rejection probe', risk: 'low', handler: () => {
      runs++
      return { kind: 'success' }
    } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
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
    const notice = page.getByText('Host command unavailable', { exact: true })
    await notice.waitFor()
    const output = '.artifacts/remote-error-propagation-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/command-error.png`, fullPage: true })
    const observation = { notice: await notice.textContent(), requests, runs }
    const expected = JSON.parse(await readFile(new URL('./expected/remote-error-command.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(`${output}/command.json`, JSON.stringify(observation, null, 2) + '\n')
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('withdraws Host commands while preserving local commands and a pending submission draft', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const capabilities = ['command.catalog.v1', 'command.execute.v1']
  let hidden = [...capabilities]
  let negotiations = 0
  let runs = 0
  let delayed = false
  const reply = Promise.withResolvers<undefined>()
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const responses: Array<{ path: string; status: number }> = []
  const diagnostics: string[] = []
  const output = '.artifacts/commands-capability-browser'
  try {
    scaffold = await launchWebScaffold()
    scaffold.ctx.commands.register({ name: 'proof', description: 'Command capability probe', risk: 'low', input: { hint: 'retained text' }, handler: () => {
      runs++
      return { kind: 'success' }
    } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text().replace(/https?:\/\/\S+/gu, '<url>'))
    })
    page.on('pageerror', (error) => { diagnostics.push(error.message.replace(/https?:\/\/\S+/gu, '<url>')) })
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (path.startsWith('/api/commands/')) responses.push({ path, status: response.status() })
    })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/commands/')) calls.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('command fixture discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining(capabilities))
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !hidden.includes(id)),
      } } } })
    })
    await page.route('**/api/commands/execute', async (route) => {
      const response = await route.fetch()
      delayed = true
      await reply.promise
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    const proof = menu.getByRole('option', { name: /proof/u })
    const localFile = menu.getByRole('option', { name: /File/u })
    const observations: Array<{ stage: string; hostRows: number; localRows: number; runs: number }> = []
    const observe = async (stage: string) => {
      observations.push({ stage, hostRows: await proof.count(), localRows: await localFile.count(), runs })
    }
    const reconnect = async (next: string[]) => {
      hidden = next
      const target = negotiations + 1
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    await input.fill('/')
    await localFile.waitFor()
    expect(await proof.count()).toBe(0)
    expect(calls).toEqual([])
    await observe('absent')
    await reconnect(['command.execute.v1'])
    await expect.poll(() => calls.filter(path => path.endsWith('/list')).length).toBeGreaterThan(0)
    try {
      await localFile.waitFor()
    } catch (error) {
      await mkdir(output, { recursive: true })
      await page.screenshot({ path: `${output}/catalog-failure.png`, fullPage: true })
      await writeFile(`${output}/catalog-failure.json`, JSON.stringify({
        input: await input.textContent(), menus: await menu.count(), options: await menu.getByRole('option').allTextContents(), calls, responses, diagnostics,
      }, null, 2) + '\n')
      throw error
    }
    expect(await proof.count()).toBe(0)
    await observe('catalog-only')
    await reconnect([])
    await proof.waitFor()
    await observe('ready')
    await input.fill('/proof keep this draft')
    await input.press('Enter')
    await expect.poll(() => delayed).toBe(true)
    expect(runs).toBe(1)
    await reconnect(capabilities)
    reply.resolve(undefined)
    await page.getByText('This connection cannot execute the command. Select it again and retry.', { exact: true }).waitFor()
    await expect.poll(() => input.textContent()).toBe('/proof keep this draft')
    expect(calls.filter(path => path.endsWith('/execute'))).toHaveLength(1)
    await input.fill('/')
    await localFile.waitFor()
    expect(await proof.count()).toBe(0)
    await observe('withdrawn-after-execution')
    await reconnect([])
    await proof.waitFor()
    await observe('restored-without-replay')
    expect(runs).toBe(1)
    expect(calls.filter(path => path.endsWith('/execute'))).toHaveLength(1)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    const actual = { observations, retainedDraft: true, executionRequests: 1, handlerRuns: runs,
      discoveryControlled: true, replyDeliveryControlled: true }
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/commands.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } finally {
    reply.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

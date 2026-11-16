/** Real Web settings through descriptor changes and physical connection replacement. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, openSettings, writeComposerDraft } from './support.ts'

/** Forward both carrier directions and count the event stream's accepted generations. */
async function observeConnections(page: Page) {
  const sockets: { client: WebSocketRoute; server: WebSocketRoute }[] = []
  let readyFrames = 0
  let closed = false
  await page.routeWebSocket('**/api/remote.mux', (client) => {
    if (closed) { void client.close(); return }
    const server = client.connectToServer()
    const events = new Set<string>()
    sockets.push({ client, server })
    client.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as { type: string; streamId: string; endpoint?: string }
      if (frame.type === 'open' && frame.endpoint === '$events') events.add(frame.streamId)
      server.send(message)
    })
    server.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as { type: string; streamId: string; value?: { type: string } }
      if (frame.type === 'item' && events.has(frame.streamId) && frame.value?.type === 'ready') readyFrames++
      client.send(message)
    })
  })
  return {
    generations: () => readyFrames,
    reconnect: async () => {
      await expect.poll(() => readyFrames).toBeGreaterThan(0)
      const target = readyFrames + 1
      const socket = sockets.at(-1)!
      await socket.server.close()
      await socket.client.close()
      await expect.poll(() => readyFrames, { timeout: 30_000 }).toBe(target)
    },
    close: async () => {
      closed = true
      for (const socket of sockets) {
        await socket.server.close()
        await socket.client.close()
      }
    },
  }
}

/** Settle intercepted requests and both carrier halves before disposing the Host. */
async function closeFixture(
  page: Page | undefined,
  browser: Browser | undefined,
  connections: Awaited<ReturnType<typeof observeConnections>> | undefined,
  scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined,
): Promise<void> {
  try {
    await page?.unrouteAll({ behavior: 'wait' })
  } finally {
    try { await connections?.close() } finally {
      try { await browser?.close() } finally { await scaffold?.close() }
    }
  }
}

it('restores refused preset preferences across reconnect and keeps an unsent draft when entering Creator', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let connections: Awaited<ReturnType<typeof observeConnections>> | undefined
  let refuseDefault = true
  let userMessages = 0
  const requests: string[] = []
  const output = '.artifacts/preset-capabilities-browser'
  try {
    scaffold = await launchWebScaffold({ agentPresets: { default: 'standard' } })
    const host = scaffold
    const sessionPresets = async (): Promise<(string | null | undefined)[]> => {
      const response = await host.hostFetch('/api/session/list', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'preset-capabilities-list', method: 'session/list', payload: { args: { _request: {} } } }),
      })
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Preset Session listing failed')
      const list = envelope.result.value as { items: { projections?: { values: { agentPreset?: string | null } } }[] }
      return list.items.map(item => item.projections?.values.agentPreset)
    }
    scaffold.ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message') userMessages++
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    connections = await observeConnections(page)
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/agentPresets/')) requests.push(path)
      if (path === '/api/settings/update') {
        const payload = request.postDataJSON() as { payload: { args: { ns: string } } }
        if (payload.payload.args.ns === 'agent-preset-registry') requests.push(path)
      }
    })
    await page.route('**/api/settings/update', async (route) => {
      const request = route.request().postDataJSON() as { rpcId: string; payload: { args: { ns: string } } }
      if (refuseDefault && request.payload.args.ns === 'agent-preset-registry') {
        await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
          ok: false, error: { code: 'gateway/invocation-unavailable', message: 'Preset preferences are temporarily unavailable', details: {} },
        } } })
        return
      }
      await route.fulfill({ response: await route.fetch() })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const original = host.ctx.agents.list()[0]
    if (original === undefined) throw new Error('Connecting the workspace did not create a Session')
    const composer = page.locator(`[data-conversation-session="${original.id}"] [data-composer-input][contenteditable="true"]`)
    const draft = 'Keep this unsent Creator task'
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const entry = settings.getByRole('button', { name: 'Agent presets', exact: true })
    await entry.click()
    const viewer = settings.getByRole('button', { name: 'View configuration: Standard mode', exact: true })
    await viewer.click()
    const composition = page.getByRole('dialog', { name: 'View configuration · Standard mode', exact: true })
    await composition.waitFor()
    expect(await composition.locator('pre').textContent()).toContain('@deepseek-ai/')
    expect(await composition.getByRole('textbox').count()).toBe(0)
    await composition.getByRole('button', { name: 'Close', exact: true }).last().click()
    expect(await settings.getByRole('button', { name: /^Duplicate:/u }).count()).toBe(0)
    const select = settings.getByRole('button', { name: 'Set as new task default: Minimal mode', exact: true })
    await select.click()
    await settings.getByText('Preset preferences are temporarily unavailable', { exact: true }).waitFor()
    expect((await scaffold.ctx.agentPresets.remoteExportList()).presets.find(row => row.isDefault)?.id).toBe('standard')
    const refusedWrites = requests.filter(path => path === '/api/settings/update').length
    expect(refusedWrites).toBe(1)
    refuseDefault = false
    await connections.reconnect()
    await viewer.waitFor()
    expect(requests.filter(path => path === '/api/settings/update')).toHaveLength(refusedWrites)
    expect((await scaffold.ctx.agentPresets.remoteExportList()).presets.find(row => row.isDefault)?.id).toBe('standard')
    await select.click()
    await settings.getByRole('button', { name: 'New task default: Minimal mode', exact: true }).waitFor()
    await expect.poll(sessionPresets).toContain('minimal')
    expect(scaffold.ctx.settingsController.describe().namespaces.find(item => item.ns === 'agent-preset-registry')?.value)
      .toMatchObject({ selectedDefault: 'minimal' })
    const document = await readFile(scaffold.ctx.configEditor.documentPath, 'utf8')
    expect(document).toContain('selectedDefault: minimal')
    await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
    await writeComposerDraft(page, composer, draft)
    await openSettings(page, 'en')
    await entry.click()
    await settings.getByRole('button', { name: 'Let the agent help me create a preset', exact: true }).click()
    await settings.waitFor({ state: 'detached' })
    const creatorPicker = page.getByRole('button', { name: 'Creator mode', exact: true })
    await creatorPicker.waitFor()
    await expect.poll(sessionPresets).toContain('cordis')
    const creator = host.ctx.agents.list().find(agent => agent.session.header.agentPreset === 'cordis')
    if (creator === undefined) throw new Error('The Creator entry did not create its Session')
    expect(creator.id).not.toBe(original.id)
    const creatorComposer = page.locator(`[data-conversation-session="${creator.id}"] [data-composer-input][contenteditable="true"]`)
    expect((await creatorComposer.innerText()).trim()).toBe('')
    // Finish a fixture turn so New Session can return to the saved Minimal blank.
    creator.session.append('turn/start', { turn: 1 })
    creator.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await host.ctx.sessions.flush(creator.session)
    await creatorPicker.waitFor({ state: 'detached' })
    const newSession = page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' })
    const [reopening] = await Promise.all([page.waitForResponse('**/api/session/create'), newSession.click()])
    expect(await reopening.json()).toMatchObject({ result: { ok: true, value: { sessionId: original.id, agentPreset: 'minimal' } } })
    await composer.filter({ hasText: draft }).waitFor()
    expect(await composer.textContent()).toBe(draft)
    expect(userMessages).toBe(0)
    expect((await scaffold.ctx.agentPresets.remoteExportList()).presets.find(row => row.isDefault)?.id).toBe('minimal')
    const observation = {
      catalogRead: requests.includes('/api/agentPresets/list'),
      compositionReads: requests.filter(path => path === '/api/agentPresets/read').length,
      refusedPreferencePreserved: true,
      reconnectDidNotReplay: true,
      selectedDefaultPersisted: true,
      creatorDraftPreserved: true,
      userMessages,
      generations: connections.generations(),
      preferenceWrites: requests.filter(path => path === '/api/settings/update').length,
      retiredMutations: requests.filter(path => /\/agentPresets\/(copy|deletePreset)$/u.test(path)),
    }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/preset-operations.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    await writeFile(output + '/observation.json', JSON.stringify(observation, null, 2) + '\n')
  } finally { await closeFixture(page, browser, connections, scaffold) }
}, 120_000)

it('uses credential descriptions for legacy Web search and retries a refused key only after explicit save', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let connections: Awaited<ReturnType<typeof observeConnections>> | undefined
  let writable = false
  let refuseKey = true
  const requests: string[] = []
  const messages: string[] = []
  const keyRef = 'WEB_SEARCH_CAPABILITY_FIXTURE'
  const output = '.artifacts/web-search-capabilities-browser'
  try {
    scaffold = await launchWebScaffold({ deepSeekSearch: { apiKeyEnv: keyRef, baseURL: 'https://example.invalid/search' } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    connections = await observeConnections(page)
    page.on('console', (message) => { messages.push(message.text()) })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/credentials/')) requests.push(path)
    })
    await page.route('**/api/credentials/describe', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Web-search credential discovery failed')
      const views = envelope.result.value as Record<string, { writable: boolean }>
      const value = Object.fromEntries(Object.entries(views).map(([ref, view]) => [
        ref, ref === keyRef ? { ...view, writable } : view,
      ]))
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value } } })
    })
    await page.route('**/api/credentials/set', async (route) => {
      if (refuseKey) {
        const request = route.request().postDataJSON() as { rpcId: string }
        await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
          ok: false, error: { code: 'credential/rejected', message: 'Search key writes are temporarily unavailable', details: { ref: keyRef } },
        } } })
        return
      }
      await route.fulfill({ response: await route.fetch() })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
    const panel = page.locator('[data-plugin-panel]')
    await panel.getByRole('button', { name: 'View Web search and fetch', exact: true }).click()
    const card = panel.locator('[data-plugin-config]')
    await card.getByLabel('Results per search', { exact: true }).fill('12')
    expect(await card.getByLabel('API key', { exact: true }).count()).toBe(0)
    await card.getByRole('button', { name: /^Billing /u }).waitFor()
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    const documentPath = scaffold.ctx.configEditor.documentPath
    await expect.poll(async () => (await readFile(documentPath, 'utf8')).includes('count: 12')).toBe(true)
    const provider = card.getByRole('button', { name: /^Web search provider /u })
    await provider.click()
    await page.getByRole('menuitem', { name: 'DeepSeek (legacy)', exact: true }).click()
    const key = card.getByLabel('API key', { exact: true })
    await expect.poll(() => key.isDisabled()).toBe(true)
    await card.getByLabel('Maximum searches per request', { exact: true }).fill('3')
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await readFile(documentPath, 'utf8')).includes('maxUses: 3')).toBe(true)
    writable = true
    await connections.reconnect()
    await expect.poll(() => key.isEnabled()).toBe(true)
    const discarded = randomBytes(12).toString('hex')
    await key.fill(discarded)
    await provider.click()
    await page.getByRole('menuitem', { name: 'DeepSeek Search API', exact: true }).click()
    expect(await key.count()).toBe(0)
    await provider.click()
    await page.getByRole('menuitem', { name: 'DeepSeek (legacy)', exact: true }).click()
    expect(await key.inputValue()).toBe('')
    const secret = randomBytes(12).toString('hex')
    await key.fill(secret)
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await card.getByText('The deployment did not accept these values; they were left for you to correct.', { exact: true }).waitFor()
    expect(await key.inputValue()).toBe(secret)
    expect(requests.filter(path => path === '/api/credentials/set')).toHaveLength(1)
    refuseKey = false
    await connections.reconnect()
    await key.waitFor()
    expect(requests.filter(path => path === '/api/credentials/set')).toHaveLength(1)
    await key.fill(secret)
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await card.getByText('A key is configured.', { exact: true }).waitFor()
    expect(await key.inputValue()).toBe('')
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials).toContain(secret)
    expect(credentials).not.toContain(discarded)
    expect(await readFile(documentPath, 'utf8')).not.toContain(secret)
    expect(await page.content()).not.toContain(secret)
    expect(await page.locator('body').ariaSnapshot()).not.toContain(secret)
    expect(messages.some(message => message.includes(secret) || message.includes(discarded))).toBe(false)
    const observation = {
      credentialDescriptionRead: requests.includes('/api/credentials/describe'),
      ordinarySettingsPersisted: true,
      readOnlyCredentialDisabled: true,
      providerChangeDiscardedDraft: true,
      refusedDraftRetained: true,
      reconnectDidNotReplay: true,
      explicitKeyPersisted: true,
      noSecretInSettingsOrUi: true,
      generations: connections.generations(),
      credentialWrites: requests.filter(path => /\/(set|unset)$/u.test(path)),
    }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/web-search-operations.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/saved.png', fullPage: true })
    await writeFile(output + '/observation.json', JSON.stringify(observation, null, 2) + '\n')
  } finally { await closeFixture(page, browser, connections, scaffold) }
}, 120_000)

it('keeps Models registered, restores writable settings and preserves a refused provider draft across reconnect', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let connections: Awaited<ReturnType<typeof observeConnections>> | undefined
  let writable = false
  let refuseSettings = true
  const requests: string[] = []
  const catalogRequests: { provider?: string; baseURL?: string; apiKey?: string }[] = []
  const output = '.artifacts/models-capabilities-browser'
  try {
    scaffold = await launchWebScaffold()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    connections = await observeConnections(page)
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/llm/') || path.startsWith('/api/credentials/') || path === '/api/settings/mutate') requests.push(path)
      if (path === '/api/llm/discoverModels') {
        const payload = request.postDataJSON() as {
          payload: { args: { request: { provider?: string; baseURL?: string; apiKey?: string } } }
        }
        catalogRequests.push(payload.payload.args.request)
      }
    })
    await page.route('**/api/settings/describe', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Models settings discovery failed')
      const description = envelope.result.value as { writable: boolean }
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: { ...description, writable } } } })
    })
    await page.route('**/api/settings/mutate', async (route) => {
      if (refuseSettings) {
        const request = route.request().postDataJSON() as { rpcId: string }
        await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
          ok: false, error: { code: 'settings/rejected', message: 'Provider settings are temporarily unavailable', details: { ns: 'llm-pi-ai' } },
        } } })
        return
      }
      await route.fulfill({ response: await route.fetch() })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const entry = settings.getByRole('button', { name: 'Models', exact: true })
    await entry.click()
    await settings.getByText('The settings document is read-only in this deployment.', { exact: true }).waitFor()
    const add = settings.getByRole('button', { name: 'Add model provider', exact: true })
    expect(await add.isDisabled()).toBe(true)
    writable = true
    await connections.reconnect()
    await expect.poll(() => add.isEnabled()).toBe(true)
    await add.click()
    const provider = settings.getByLabel('Provider', { exact: true })
    await provider.selectOption('minimax-cn')
    const key = settings.getByLabel('API key', { exact: true })
    await key.waitFor()
    await settings.getByText('Customized settings', { exact: true }).click()
    await settings.getByRole('button', { name: 'Fetch available models', exact: true }).waitFor()
    const secret = randomBytes(12).toString('hex')
    await key.fill(secret)
    const apply = settings.getByRole('button', { name: 'Apply', exact: true })
    await apply.click()
    await settings.getByText('Provider settings are temporarily unavailable', { exact: true }).waitFor()
    expect(await key.inputValue()).toBe(secret)
    expect(requests.filter(path => path === '/api/settings/mutate')).toHaveLength(1)
    expect(requests.filter(path => path === '/api/credentials/set')).toEqual([])
    refuseSettings = false
    await connections.reconnect()
    await expect.poll(() => apply.isEnabled()).toBe(true)
    expect(await key.inputValue()).toBe(secret)
    expect(requests.filter(path => path === '/api/settings/mutate')).toHaveLength(1)
    expect(requests.filter(path => path === '/api/credentials/set')).toEqual([])
    await apply.click()
    await settings.getByText('Saved minimax-cn.', { exact: true }).waitFor()
    const document = await readFile(scaffold.ctx.configEditor.documentPath, 'utf8')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    expect(document).not.toContain(secret)
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials).toContain(secret)
    expect(await page.content()).not.toContain(secret)
    expect(await page.locator('body').ariaSnapshot()).not.toContain(secret)
    expect(catalogRequests.length).toBeGreaterThan(0)
    for (const request of catalogRequests) {
      expect(Object.keys(request)).toEqual(['provider'])
      expect(request.provider).toBeTruthy()
    }
    const observation = {
      modelsEntryRegistered: true,
      readOnlySettingsDisabledCreation: true,
      credentialDescriptionRead: requests.includes('/api/credentials/describe'),
      credentialControlPresent: true,
      discoveryControlPresent: true,
      catalogOnlyDiscovery: true,
      refusedDraftRetained: true,
      reconnectDidNotReplay: true,
      explicitSettingsAndKeyPersisted: true,
      generations: connections.generations(),
      settingsWrites: requests.filter(path => path === '/api/settings/mutate').length,
      credentialWrites: requests.filter(path => /\/(set|unset)$/u.test(path)),
    }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/models-operations.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/saved.png', fullPage: true })
    await writeFile(output + '/observation.json', JSON.stringify(observation, null, 2) + '\n')
  } finally { await closeFixture(page, browser, connections, scaffold) }
}, 120_000)

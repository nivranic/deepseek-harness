/** Real Web entry changes across controlled Host capability advertisements. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'

it('admits preset catalog, selection and management independently across real connection replacement', async () => {
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-capabilities-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let hidden: readonly string[] = ['agent-preset.catalog.v1', 'agent-preset.select.v1', 'agent-preset.manage.v1']
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const requests: string[] = []
  const settingsTraffic: string[] = []
  try {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./agent-preset-authoring.overlay.yml', import.meta.url)),
      agentPresets: { roots: [{ path: userRoot, trust: 'user' }], default: 'standard' },
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/settings/')) settingsTraffic.push(path)
      if (path.startsWith('/api/agentPresets/') || /\/settings\/(canOpenAgentPresetDirectory|openAgentPresetDirectory|update)$/u.test(path)) requests.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('preset fixture discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining([
        'agent-preset.catalog.v1', 'agent-preset.select.v1', 'agent-preset.manage.v1',
        'settings.read.v1', 'settings.write.v1', 'settings.document-open.v1', 'settings.agent-preset-directory.v1',
      ]))
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !hidden.includes(id)),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const entry = settings.getByRole('button', { name: 'Agent presets', exact: true })
    expect(await entry.count()).toBe(0)
    expect(requests).toEqual([])
    await settings.getByRole('button', { name: 'Open configuration file', exact: true }).waitFor()
    const initialSettingsReads = settingsTraffic.filter(path => path === '/api/settings/describe').length
    expect(initialSettingsReads).toBe(1)
    const output = '.artifacts/preset-capabilities-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/absent.png', fullPage: true })
    const replace = async (next: readonly string[]) => {
      const target = negotiations + 1
      hidden = next
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    await replace(['agent-preset.select.v1', 'agent-preset.manage.v1'])
    await entry.click()
    const viewer = settings.getByRole('button', { name: 'View: Standard mode', exact: true })
    await viewer.waitFor()
    expect(await settings.getByRole('button', { name: /^Duplicate:/u }).count()).toBe(0)
    expect(await settings.getByRole('button', { name: 'Draft a custom preset with Creator mode', exact: true }).count()).toBe(0)
    await viewer.click()
    await expect.poll(() => requests.filter(path => path.endsWith('/agentPresets/read')).length).toBe(1)
    const composition = page.getByRole('dialog', { name: 'View · Standard mode', exact: true })
    await composition.waitFor()
    expect(await composition.locator('pre').textContent()).toContain('@deepseek-ai/')
    await page.screenshot({ path: output + '/catalog-only.png', fullPage: true })
    await replace([])
    // Replacement dismisses generation-bound viewers and drafts before restoring actions.
    await entry.click()
    const duplicate = settings.getByRole('button', { name: 'Duplicate: Standard mode', exact: true })
    await duplicate.waitFor()
    await duplicate.click()
    await page.getByRole('dialog', { name: /^Duplicate preset ·/u }).waitFor()
    await replace(['agent-preset.manage.v1'])
    await expect.poll(() => page.getByRole('dialog', { name: /^Duplicate preset ·/u }).count()).toBe(0)
    expect(await settings.getByRole('button', { name: /^Duplicate:/u }).count()).toBe(0)
    await entry.click()
    await viewer.waitFor()
    await page.screenshot({ path: output + '/management-withdrawn.png', fullPage: true })
    const settingsStart = requests.length
    await replace(['settings.write.v1', 'settings.agent-preset-directory.v1'])
    await entry.click()
    await viewer.waitFor()
    const policy = settings.getByRole('switch', { name: 'Allow switching Agent modes', exact: true })
    expect(await policy.isDisabled()).toBe(true)
    await settings.getByText('Preset preferences cannot be changed on this Host', { exact: true }).waitFor()
    await settings.getByRole('button', { name: 'Duplicate: Minimal mode', exact: true }).click()
    const draft = page.getByRole('dialog', { name: /^Duplicate preset ·/u })
    await draft.getByRole('textbox', { name: 'Identifier', exact: true }).fill('capability-copy')
    await draft.getByRole('button', { name: 'Create', exact: true }).click()
    await draft.waitFor({ state: 'detached' })
    const copied = settings.getByRole('button', { name: 'Preset preferences cannot be changed on this Host: capability-copy', exact: true })
    await copied.waitFor()
    expect(await copied.isDisabled()).toBe(true)
    expect(await settings.getByRole('button', { name: /^Show location:/u }).count()).toBe(0)
    expect(requests.slice(settingsStart).filter(path => path.startsWith('/api/settings/'))).toEqual([])
    const copiedText = await readFile(join(userRoot, 'capability-copy', 'agent.cordis.yml'), 'utf8')
    expect(copiedText).toContain('@deepseek-ai/')
    await page.screenshot({ path: output + '/settings-unavailable.png', fullPage: true })
    await replace([])
    await entry.click()
    await viewer.waitFor()
    expect(await policy.isDisabled()).toBe(false)
    await settings.getByRole('button', { name: 'Show location: capability-copy', exact: true }).click()
    await settings.locator('code').filter({ hasText: join(userRoot, 'capability-copy') }).waitFor()
    await settings.getByRole('button', { name: 'Set as default: Minimal mode', exact: true }).click()
    await settings.getByRole('button', { name: 'New task default: Minimal mode', exact: true }).waitFor()
    expect(scaffold.ctx.settingsController.describe().namespaces.find(item => item.ns === 'agent-presets')?.value)
      .toMatchObject({ default: 'minimal' })
    await page.screenshot({ path: output + '/settings-restored.png', fullPage: true })
    const settingsOperations = requests.slice(settingsStart).filter(path => /\/settings\/(update|openAgentPresetDirectory)$/u.test(path))
    await replace(['settings.read.v1'])
    const documentAction = settings.getByRole('button', { name: 'Open configuration file', exact: true })
    await expect.poll(() => documentAction.count()).toBe(0)
    const readWithdrawal = settingsTraffic.length
    await settings.getByRole('button', { name: 'General', exact: true }).click()
    expect(settingsTraffic.slice(readWithdrawal).filter(path => path === '/api/settings/describe')).toEqual([])
    await page.screenshot({ path: output + '/settings-read-unavailable.png', fullPage: true })
    await replace(['settings.document-open.v1'])
    await expect.poll(() => settingsTraffic.slice(readWithdrawal).filter(path => path === '/api/settings/describe').length).toBe(1)
    await entry.click()
    await viewer.waitFor()
    expect(await documentAction.count()).toBe(0)
    await page.screenshot({ path: output + '/settings-document-unavailable.png', fullPage: true })
    await replace([])
    await documentAction.waitFor()
    expect(settingsTraffic.filter(path => path === '/api/settings/openSettingsDocument')).toEqual([])
    await page.screenshot({ path: output + '/settings-document-restored.png', fullPage: true })
    await replace(['agent-preset.catalog.v1', 'agent-preset.select.v1', 'agent-preset.manage.v1'])
    await expect.poll(() => entry.count()).toBe(0)
    const observation = {
      catalogRead: requests.some(path => path.endsWith('/agentPresets/list')),
      presetRead: requests.filter(path => path.endsWith('/agentPresets/read')).length,
      mutations: requests.filter(path => /\/agentPresets\/(select|copy|deletePreset)$/u.test(path)),
      negotiations,
      settingsOperations,
      copiedPreset: true,
      initialSettingsReads,
      settingsReadSuppressed: true,
      documentActionWithdrawn: true,
      documentActionRestored: true,
    }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/preset-operations.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await writeFile(output + '/observation.json', JSON.stringify(observation, null, 2) + '\n')
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { await rm(userRoot, { recursive: true, force: true }) }
    }
  }
}, 120_000)

it('keeps Web-search settings writable without credential capability and discards replaced key drafts', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let hidden: readonly string[] = ['credentials.describe.v1', 'credentials.write.v1']
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const requests: string[] = []
  const messages: string[] = []
  const output = '.artifacts/web-search-capabilities-browser'
  try {
    scaffold = await launchWebScaffold({ deepSeekSearch: { apiKeyEnv: 'WEB_SEARCH_CAPABILITY_FIXTURE', baseURL: 'https://example.invalid/search' } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    page.on('console', (message) => { messages.push(message.text()) })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/credentials/')) requests.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Web-search fixture discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations += 1
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !hidden.includes(id)),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 30_000 })
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const plugins = settings.getByRole('button', { name: 'Plugins', exact: true })
    await plugins.click()
    const expand = settings.getByRole('button', { name: 'Show settings: Web search', exact: true })
    const card = settings.locator('li').filter({ has: page.getByRole('button', { name: /settings: Web search$/u }) })
    await expand.click()
    expect(await card.getByLabel('API key', { exact: true }).count()).toBe(0)
    expect(requests).toEqual([])
    await card.getByLabel('Max searches per request', { exact: true }).fill('3')
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expand.waitFor()
    const documentPath = join(scaffold.harnessHome, 'settings.yaml')
    await expect.poll(async () => (await readFile(documentPath, 'utf8')).includes('maxUses: 3')).toBe(true)
    await expand.click()
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/credentials-absent.png', fullPage: true })
    const replace = async (next: readonly string[]) => {
      hidden = next
      const target = negotiations + 1
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
      await plugins.click()
      await expand.click()
    }
    await replace(['credentials.write.v1'])
    expect(await card.getByLabel('API key', { exact: true }).count()).toBe(0)
    expect(await card.getByLabel('Max searches per request', { exact: true }).inputValue()).toBe('3')
    await expect.poll(() => requests.filter(path => path === '/api/credentials/describe').length).toBeGreaterThan(0)
    await page.screenshot({ path: output + '/write-absent.png', fullPage: true })
    await replace([])
    const key = card.getByLabel('API key', { exact: true })
    await expect.poll(() => key.isEnabled()).toBe(true)
    const discarded = randomBytes(12).toString('hex')
    await key.fill(discarded)
    await replace(['credentials.write.v1'])
    await replace([])
    await expect.poll(() => key.isEnabled()).toBe(true)
    expect(await key.inputValue()).toBe('')
    expect(requests.filter(path => /\/(set|unset)$/u.test(path))).toEqual([])
    const secret = randomBytes(12).toString('hex')
    await key.fill(secret)
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expand.waitFor()
    await expand.click()
    await card.getByText('A key is configured.', { exact: true }).waitFor()
    expect(await key.inputValue()).toBe('')
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials.includes(secret)).toBe(true)
    expect(credentials.includes(discarded)).toBe(false)
    expect((await readFile(documentPath, 'utf8')).includes(secret)).toBe(false)
    expect((await page.content()).includes(secret)).toBe(false)
    expect((await page.locator('body').ariaSnapshot()).includes(secret)).toBe(false)
    expect(messages.some(message => message.includes(secret) || message.includes(discarded))).toBe(false)
    await page.screenshot({ path: output + '/saved.png', fullPage: true })
    const observation = { credentialReadsSuppressed: true, ordinarySettingPersisted: true, keyWriteIndependent: true,
      replacedDraftDiscarded: true, explicitKeyPersisted: true, noSecretInSettingsOrUi: true, negotiations,
      credentialWrites: requests.filter(path => /\/(set|unset)$/u.test(path)) }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/web-search-operations.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await writeFile(output + '/observation.json', JSON.stringify(observation, null, 2) + '\n')
  } finally {
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

it('admits Models directory, credential controls and discovery independently and discards replaced drafts', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let hidden: readonly string[] = ['llm.providers.v1']
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const requests: string[] = []
  const output = '.artifacts/models-capabilities-browser'
  try {
    scaffold = await launchWebScaffold()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/llm/') || path.startsWith('/api/credentials/')) requests.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Models fixture discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining([
        'llm.providers.v1', 'llm.discover-models.v1', 'credentials.describe.v1', 'credentials.write.v1',
      ]))
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations += 1
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !hidden.includes(id)),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 30_000 })
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Open configuration file', exact: true }).waitFor()
    const entry = settings.getByRole('button', { name: 'Models', exact: true })
    expect(await entry.count()).toBe(0)
    expect(requests.filter(path => path.startsWith('/api/llm/'))).toEqual([])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/directory-absent.png', fullPage: true })
    const replace = async (next: readonly string[]) => {
      hidden = next
      const target = negotiations + 1
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    const credentialWithdrawal = requests.length
    await replace(['credentials.describe.v1', 'credentials.write.v1', 'llm.discover-models.v1'])
    await entry.click()
    const addCustom = settings.getByRole('button', { name: 'Add a custom provider', exact: true })
    await addCustom.click()
    await settings.getByText('Configure the providers and models available on this Host.', { exact: true }).waitFor()
    expect(await settings.getByLabel('API key', { exact: true }).count()).toBe(0)
    expect(await settings.getByRole('button', { name: 'Fetch available models', exact: true }).count()).toBe(0)
    expect(requests.slice(credentialWithdrawal).filter(path => path.startsWith('/api/credentials/'))).toEqual([])
    await page.screenshot({ path: output + '/credential-and-discovery-absent.png', fullPage: true })
    await replace(['credentials.write.v1'])
    await entry.click()
    await addCustom.click()
    await settings.getByRole('button', { name: 'Fetch available models', exact: true }).waitFor()
    expect(await settings.getByLabel('API key', { exact: true }).count()).toBe(0)
    await expect.poll(() => requests.filter(path => path === '/api/credentials/describe').length).toBeGreaterThan(0)
    await page.screenshot({ path: output + '/credential-read-only.png', fullPage: true })
    await replace([])
    await entry.click()
    await addCustom.click()
    const key = settings.getByLabel('API key', { exact: true })
    await key.fill(randomBytes(12).toString('hex'))
    await replace([])
    await entry.click()
    await addCustom.click()
    expect(await key.inputValue()).toBe('')
    await page.screenshot({ path: output + '/draft-replaced.png', fullPage: true })
    expect(requests.filter(path => /\/(set|unset|discoverModels)$/u.test(path))).toEqual([])
    const observation = { directoryAbsent: true, credentialReadSuppressed: true, credentialWriteHidden: true,
      discoveryIndependent: true, draftDiscarded: true, noCredentialOrDiscoveryMutation: true, negotiations }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/models-operations.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await writeFile(output + '/observation.json', JSON.stringify(observation, null, 2) + '\n')
  } finally {
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

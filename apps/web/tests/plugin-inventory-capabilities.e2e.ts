/** Real Loader inventory with controlled discovery and held read delivery across reconnect. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it.each([
  { locale: 'en-US', settings: 'Settings', plugins: 'Plugins', tab: 'Plugin list', error: 'Plugins are temporarily unavailable.', retry: 'Retry' },
  { locale: 'zh-CN', settings: '设置', plugins: '插件', tab: '插件列表', error: '暂时无法读取插件。', retry: '重试' },
])('keeps an unknown Host error recoverable in $locale', async (labels) => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let reads = 0
  try {
    scaffold.ctx.loader.builtins['error-propagation-proof'] = () => {}
    await scaffold.ctx.loader.create({ name: 'cordis:error-propagation-proof' })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: labels.locale })
    await page.route('**/api/pluginInventory/list', async (route) => {
      reads++
      const response = await route.fetch()
      if (reads !== 1) { await route.fulfill({ response }); return }
      const envelope = await response.json() as ServerResponse
      await route.fulfill({ response, json: { ...envelope, result: {
        ok: false, error: { code: 'future/inventory-unavailable', message: 'Unknown Host failure', details: { reason: 'maintenance' } },
      } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: labels.settings, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: labels.settings })
    await dialog.getByRole('button', { name: labels.plugins, exact: true }).click()
    await dialog.getByRole('tab', { name: labels.tab, exact: true }).click()
    await dialog.getByText(labels.error, { exact: true }).waitFor()
    expect(reads).toBe(1)
    expect(await dialog.getByText('Unknown Host failure', { exact: true }).count()).toBe(0)
    const output = '.artifacts/remote-error-propagation-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/${labels.locale}-error.png`, fullPage: true })
    await dialog.getByRole('button', { name: labels.retry, exact: true }).click()
    await dialog.getByRole('searchbox').fill('error-propagation-proof')
    await dialog.locator('[data-plugin-module="cordis:error-propagation-proof"]').waitFor()
    const observation = { locale: labels.locale, message: labels.error, reads, recovered: true }
    const expected = JSON.parse(await readFile(new URL(`./expected/remote-error-${labels.locale}.expected.json`, import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(`${output}/${labels.locale}.json`, JSON.stringify(observation, null, 2) + '\n')
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('withdraws inventory tabs and stale reads without leaking previous Host page state', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let supported = false
  let negotiations = 0
  let reads = 0
  let cancelledReads = 0
  const sockets: WebSocketRoute[] = []
  const release = Promise.withResolvers<undefined>()
  const held = Promise.withResolvers<undefined>()
  const delivered = Promise.withResolvers<undefined>()
  const output = '.artifacts/plugin-inventory-capability-browser'
  try {
    scaffold = await launchWebScaffold()
    scaffold.ctx.loader.builtins['inventory-proof-old'] = () => {}
    scaffold.ctx.loader.builtins['inventory-proof-new'] = () => {}
    const oldId = await scaffold.ctx.loader.create({ name: 'cordis:inventory-proof-old' })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    page.on('requestfailed', (request) => { if (new URL(request.url()).pathname === '/api/pluginInventory/list') cancelledReads++ })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Inventory discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toContain('plugin.inventory.v1')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => id !== 'plugin.inventory.v1' || supported),
      } } } })
    })
    await page.route('**/api/pluginInventory/list', async (route) => {
      const index = ++reads
      const response = await route.fetch()
      if (index === 1) { held.resolve(undefined); await release.promise }
      await route.fulfill({ response })
      if (index === 1) delivered.resolve(undefined)
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('retain inventory-independent draft')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
    const tab = dialog.getByRole('tab', { name: 'Plugin list', exact: true })
    expect(await tab.count()).toBe(0)
    expect(reads).toBe(0)
    const reconnect = async (next: boolean) => {
      supported = next
      const target = negotiations + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    await reconnect(true)
    await tab.click()
    await held.promise
    await scaffold.ctx.loader.remove(oldId)
    await scaffold.ctx.loader.create({ name: 'cordis:inventory-proof-new' })
    await reconnect(true)
    await expect.poll(() => cancelledReads).toBe(1)
    await expect.poll(() => reads).toBe(2)
    const search = dialog.getByRole('searchbox', { name: 'Search plugins' })
    await search.fill('inventory-proof-new')
    const fresh = dialog.locator('[data-plugin-module="cordis:inventory-proof-new"]')
    await fresh.waitFor()
    await fresh.getByRole('button').click()
    release.resolve(undefined)
    await delivered.promise
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await search.inputValue()).toBe('inventory-proof-new')
    expect(await fresh.getAttribute('data-open')).toBe('true')
    expect(await dialog.locator('[data-plugin-module="cordis:inventory-proof-old"]').count()).toBe(0)
    await reconnect(false)
    await expect.poll(() => tab.count()).toBe(0)
    expect(await search.count()).toBe(0)
    expect(reads).toBe(2)
    await reconnect(true)
    await tab.click()
    await expect.poll(() => reads).toBe(3)
    await expect.poll(() => search.inputValue()).toBe('')
    expect(await dialog.locator('[data-plugin-module][data-open="true"]').count()).toBe(0)
    expect(await input.textContent()).toBe('retain inventory-independent draft')
    await search.fill('inventory-proof-new')
    await fresh.waitFor()
    const actual = { noUnsupportedRead: true, cancelledReads, reads, equalSupportRemounts: true,
      oldResponseSuppressed: true, replacementSearchPreserved: true, replacementExpansionPreserved: true,
      withdrawalRemovesTab: true, restorationClearsHostPageState: true, composerDraftRetained: true,
      realLoaderRows: true, discoveryControlled: true, readDeliveryControlled: true, modelRequests: 0 }
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/plugin-inventory.expected.json', import.meta.url), 'utf8')))
  } finally {
    release.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

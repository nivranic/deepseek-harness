/** Real Loader inventory, recoverable read failures, and late replies from closed Settings pages. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { RemoteEventDownlinkFrame } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, openSettings } from './support.ts'

it.each([
  { locale: 'en-US', language: 'en', settings: 'Settings', plugins: 'Built-in plugins', error: 'Plugins are temporarily unavailable.', retry: 'Retry' },
  { locale: 'zh-CN', language: 'zh', settings: '设置', plugins: '内置插件', error: '暂时无法读取插件。', retry: '重试' },
] as const)('keeps an unknown Host error recoverable in $locale', async (labels) => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let reads = 0
  try {
    scaffold.ctx.loader.builtins['error-propagation-proof'] = () => {}
    await scaffold.ctx.loader.create({ name: 'cordis:error-propagation-proof' })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: labels.locale })
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
    await openSettings(page, labels.language)
    const dialog = page.getByRole('dialog', { name: labels.settings })
    await dialog.getByRole('button', { name: labels.plugins, exact: true }).click()
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
    const expected: unknown = JSON.parse(await readFile(new URL(`./expected/remote-error-${labels.locale}.expected.json`, import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    await writeFile(`${output}/${labels.locale}.json`, JSON.stringify(observation, null, 2) + '\n')
  } finally {
    try { await page?.unrouteAll({ behavior: 'wait' }) } finally {
      try { await browser?.close() } finally { await scaffold.close() }
    }
  }
}, 120_000)

it('retains the mounted inventory across reconnect and ignores a late reply after Settings is reopened', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let readyFrames = 0
  let reads = 0
  let cancelledReads = 0
  const sockets: WebSocketRoute[] = []
  const release = Promise.withResolvers<undefined>()
  const held = Promise.withResolvers<undefined>()
  const output = '.artifacts/plugin-inventory-capability-browser'
  try {
    scaffold.ctx.loader.builtins['inventory-proof-old'] = () => {}
    scaffold.ctx.loader.builtins['inventory-proof-new'] = () => {}
    const oldId = await scaffold.ctx.loader.create({ name: 'cordis:inventory-proof-old' })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const currentPage = page
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    page.on('requestfailed', (request) => { if (new URL(request.url()).pathname === '/api/pluginInventory/list') cancelledReads++ })
    await page.route('**/api/pluginInventory/list', async (route) => {
      const index = ++reads
      const response = await route.fetch()
      if (index === 2) {
        held.resolve(undefined)
        await release.promise
      }
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await expect.poll(() => readyFrames).toBe(1)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('retain inventory-independent draft')
    expect(reads).toBe(0)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const open = async () => {
      await openSettings(currentPage, 'en')
      await dialog.getByRole('button', { name: 'Built-in plugins', exact: true }).click()
    }
    const close = async () => {
      await currentPage.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    }
    await open()
    const search = dialog.getByRole('searchbox', { name: 'Search plugins' })
    const old = dialog.locator('[data-plugin-module="cordis:inventory-proof-old"]')
    const fresh = dialog.locator('[data-plugin-module="cordis:inventory-proof-new"]')
    await search.fill('inventory-proof-old')
    await old.waitFor()
    await old.getByRole('button').click()
    const reconnect = async () => {
      const target = readyFrames + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => readyFrames, { timeout: 10_000 }).toBe(target)
    }
    await reconnect()
    expect(reads).toBe(1)
    expect(await search.inputValue()).toBe('inventory-proof-old')
    expect(await old.getAttribute('data-open')).toBe('true')
    await close()
    await open()
    await held.promise
    scaffold.ctx.loader.remove(oldId)
    await scaffold.ctx.loader.create({ name: 'cordis:inventory-proof-new' })
    await close()
    await open()
    await search.waitFor()
    expect(reads).toBe(3)
    expect(await search.inputValue()).toBe('')
    expect(await dialog.locator('[data-plugin-module][data-open="true"]').count()).toBe(0)
    await search.fill('inventory-proof-new')
    await fresh.waitFor()
    await fresh.getByRole('button').click()
    const lateReply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/pluginInventory/list')
    release.resolve(undefined)
    expect(await (await lateReply).finished()).toBeNull()
    expect(await search.inputValue()).toBe('inventory-proof-new')
    expect(await fresh.getAttribute('data-open')).toBe('true')
    expect(await old.count()).toBe(0)
    expect(reads).toBe(3)
    expect(cancelledReads).toBe(0)
    await close()
    expect(await input.textContent()).toBe('retain inventory-independent draft')
    const actual = { reads, cancelledReads, lazyRead: true, sameMountSnapshotRetainedAcrossReconnect: true,
      sameMountSearchRetained: true, sameMountExpansionRetained: true, reopenedSearchReset: true,
      reopenedExpansionReset: true, oldMountReplyIgnored: true, replacementSearchPreserved: true,
      replacementExpansionPreserved: true, composerDraftRetained: true, realLoaderRows: true }
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/restored.png`, fullPage: true })
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/plugin-inventory.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } finally {
    release.resolve(undefined)
    try { await page?.unrouteAll({ behavior: 'wait' }) } finally {
      try { await browser?.close() } finally { await scaffold.close() }
    }
  }
}, 120_000)

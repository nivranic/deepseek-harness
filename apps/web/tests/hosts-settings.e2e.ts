/** Host bookmarks and authorization guidance through the shipped Settings section. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { symbols } from '@deepseek-ai/cordis'
import { remoteMethods, type TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { openSettings, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/hosts-settings.expected.md', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../.artifacts/screenshots/browser-host-origin/', import.meta.url))

describe.skipIf(MODE === 'record')('web e2e: saved-Host settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let discovery: unknown

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)) })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'en-US', timezoneId: 'Asia/Shanghai' })
    page = await context.newPage()
    tripwire = watchConsole(page)
    // An unselected bookmark exercises guidance without contacting an unrelated server.
    await page.addInitScript(() => {
      if (localStorage.getItem('dsh-saved-hosts.v1') === null) localStorage.setItem('dsh-saved-hosts.v1', JSON.stringify([{
        hostId: 'saved-external', displayName: 'Other Host', platform: 'linux',
        origin: 'https://other-host.invalid', lastConnectedAt: 1,
      }]))
    })
    const described = page.waitForResponse(response => response.url().endsWith('/api/host/describe'))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    discovery = await (await described).json()
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('exports every capability method advertised by the shipped Host composition', () => {
    const missing: string[] = []
    for (const [key, definition] of Object.entries(scaffold.ctx.reflect.props)) {
      if (definition.type !== 'service') continue
      const receiver: unknown = scaffold.ctx.get(key)
      if (typeof receiver !== 'object' || receiver === null) continue
      const original = Reflect.get(receiver, symbols.original) as object | undefined ?? receiver
      const binding = Reflect.get(original, 'typertRemote') as TypertGatewayBinding | undefined
      if (binding === undefined) continue
      const methods = new Set(remoteMethods(original).map(method => method.exportName ?? method.method))
      for (const capability of binding.capabilities ?? []) {
        for (const method of capability.methods) {
          if (!methods.has(method)) missing.push(`${capability.id}: ${binding.namespace}/${method}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('manages local bookmarks and marks discovered identity without switching transport', async () => {
    expect(discovery, JSON.stringify(discovery)).toMatchObject({ result: { ok: true } })
    onTestFailed(async () => {
      await mkdir(SHOTS, { recursive: true })
      await saveFailureShot(page, `screenshots/browser-host-origin/failure-${process.pid}`)
    })
    await openSettings(page, 'en')
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.getByRole('button', { name: 'Hosts', exact: true }).click()
    const section = dialog.getByRole('region', { name: 'Saved Hosts', exact: true })
    const external = section.locator('[data-host-id="saved-external"]')
    const link = external.getByRole('link', { name: 'Open Host page', exact: true })
    expect(await link.getAttribute('href')).toBe('https://other-host.invalid')
    expect(await link.getAttribute('target')).toBe('_blank')
    expect(await link.getAttribute('rel')).toBe('noopener noreferrer')
    const hint = await link.locator('..').innerText()
    expect(hint).toContain('current launch link')
    expect(hint).toContain('cannot connect inside the current page')
    expect(await external.getByRole('button', { name: 'Switch', exact: true }).count()).toBe(0)
    await mkdir(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}/guidance-${MODE}-${process.pid}.png`, fullPage: true })
    const current = section.locator('[data-host-id]').filter({ hasNot: page.getByText('Other Host', { exact: true }) })
    await expect.poll(() => current.count()).toBe(1)
    expect(await current.getByRole('link').count()).toBe(0)
    expect(await section.getByText('Using the page Host', { exact: true }).isVisible()).toBe(true)
    const hostId = await current.getAttribute('data-host-id')
    await expect.poll(() => current.getAttribute('data-host-selected')).toBe('')
    expect(await current.getByText('Current Host', { exact: true }).isVisible()).toBe(true)
    expect(await current.getByRole('button', { name: 'Switch', exact: true }).count()).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('dsh-selected-host.v1'))).toBeNull()
    const rows = section.locator('[data-host-id]')
    const hostIds = async (): Promise<(string | undefined)[]> =>
      rows.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.hostId))
    await expect.poll(async () => await hostIds()).toEqual([hostId, 'saved-external'])
    await external.getByRole('button', { name: 'Move up', exact: true }).click()
    await expect.poll(async () => await hostIds()).toEqual(['saved-external', hostId])
    expect(await external.getByRole('button', { name: 'Move up', exact: true }).isDisabled()).toBe(true)
    expect(await current.getByRole('button', { name: 'Move down', exact: true }).isDisabled()).toBe(true)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh-saved-hosts.v1'))).toContain('"order":0')
    await external.getByRole('button', { name: 'Move down', exact: true }).click()
    await expect.poll(async () => await hostIds()).toEqual([hostId, 'saved-external'])
    await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh-saved-hosts.v1'))).toContain('"order":1')
    await external.getByRole('button', { name: 'Forget', exact: true }).click()
    await expect.poll(() => external.count()).toBe(0)
    await expect.poll(() => current.count()).toBe(1)
    const nameOf = current.locator('span[class*="hostName"]')
    const presentedName = (await nameOf.innerText()).trim()
    await current.getByRole('button', { name: 'Rename', exact: true }).click()
    const editor = current.getByRole('textbox', { name: 'Rename', exact: true })
    await editor.fill('   ')
    await current.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => section.getByText('The name cannot be empty', { exact: true }).isVisible()).toBe(true)
    await editor.fill('  Desk  ')
    await current.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => nameOf.innerText()).toBe('Desk')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh-saved-hosts.v1'))).toContain('"customName":"Desk"')
    await current.getByRole('button', { name: 'Reset name', exact: true }).click()
    await expect.poll(() => nameOf.innerText()).toBe(presentedName)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('dsh-saved-hosts.v1'))).not.toContain('customName')
    await mkdir(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}/hosts-${MODE}-${process.pid}.png`, fullPage: true })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await compareOrRefreshGolden(EXPECTED, [
      '# Saved Host bookmarks', '',
      `- Cross-origin guidance: ${hint}`,
      '- Page Host: no cross-origin guidance',
      '- Current identity: discovered Host marked; no in-page switch or persisted selection',
      '- Reorder: Move up puts the external Host first with boundary buttons disabled and explicit order stamps; Move down restores the recency order',
      '- Forget: external bookmark removed; page Host retained',
      '- Rename: empty draft rejected; Desk overrides and persists; Reset name returns the descriptor name',
    ].join('\n'), MODE)
  })

  it('retains a cross-origin bookmark while ignoring its unsupported boot selection', async () => {
    const other = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)) })
    const otherPage = await page.context().newPage()
    try {
      await otherPage.goto(other.authenticatedUrl, { waitUntil: 'load' })
      const origin = new URL(other.authenticatedUrl).origin
      const body = { type: 'client-request', rpcId: 'origin-probe', method: 'host/describe', payload: { args: {} } }
      const direct = await page.request.post(origin + '/api/host/describe', { data: body })
      expect(direct.status()).toBe(200)
      const decoded = await direct.json() as { result: { ok: boolean } }
      expect(decoded, JSON.stringify(decoded)).toMatchObject({ result: { ok: true } })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Network.enable')
      const preflights: number[] = []
      cdp.on('Network.responseReceived', (event) => {
        if (event.type === 'Preflight' && event.response.url === origin + '/api/host/describe') preflights.push(event.response.status)
      })
      const rejected = await page.evaluate(async ({ origin, body }) => {
        try {
          await fetch(origin + '/api/host/describe', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
          return false
        } catch {
          // This probe observes fetch's CORS rejection; the separate CDP assertion owns HTTP status.
          return true
        }
      }, { origin, body })
      expect(rejected).toBe(true)
      await expect.poll(() => preflights).toEqual([403])
      await cdp.detach()
      await page.evaluate((origin) => {
        localStorage.setItem('dsh-saved-hosts.v1', JSON.stringify([{ hostId: 'other-live', displayName: 'Other live Host', platform: 'linux', origin, lastConnectedAt: 1 }]))
        localStorage.setItem('dsh-selected-host.v1', 'other-live')
      }, origin)
      await page.reload({ waitUntil: 'load' })
      await openSettings(page, 'en')
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      await dialog.getByRole('button', { name: 'Hosts', exact: true }).click()
      const section = dialog.getByRole('region', { name: 'Saved Hosts', exact: true })
      const bookmark = section.locator('[data-host-id="other-live"]')
      expect(await bookmark.getByRole('link', { name: 'Open Host page', exact: true }).getAttribute('href')).toBe(origin)
      expect(await bookmark.getByRole('button', { name: 'Switch', exact: true }).count()).toBe(0)
      expect(await section.getByText('Using the page Host', { exact: true }).isVisible()).toBe(true)
      expect(await page.evaluate(() => localStorage.getItem('dsh-selected-host.v1'))).toBe('other-live')
      await expect.poll(() => section.locator('[data-host-id]').count()).toBe(2)
      await page.screenshot({ path: `${SHOTS}/boot-${MODE}-${process.pid}.png`, fullPage: true })
    } finally {
      await otherPage.close()
      await other.close()
    }
  })
})

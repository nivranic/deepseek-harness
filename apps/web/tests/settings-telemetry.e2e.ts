/** Real Settings gestures persist live consent without remounting the telemetry backend. */
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole } from './scaffold.ts'
import { openSettings } from './support.ts'

it('saves one consent category through the Host and retains it after a browser reload', async () => {
  let requests = 0
  const collector = createServer((request, response) => {
    requests += 1
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
  })
  onTestFinished(async () => {
    const closed = once(collector, 'close')
    collector.close()
    collector.closeAllConnections()
    await closed
  })
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  const address = collector.address()
  if (address === null || typeof address === 'string') throw new Error('collector has no port')
  const scaffold = await launchWebScaffold({
    developerTools: false,
    telemetryUrl: `http://127.0.0.1:${address.port}/v1/logs`,
    extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  const tripwire = watchConsole(page)
  const backend = scaffold.ctx.sessionTelemetry
  const telemetryEntry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.id === 'session-telemetry-otel')!
  const fiberId = telemetryEntry.fiber!.uid
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await openSettings(page, 'en')
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: 'Telemetry', exact: true }).click()
  const switches = dialog.getByRole('switch')
  await expect.poll(() => switches.count()).toBe(5)
  for (const control of await switches.all()) expect(await control.getAttribute('aria-checked')).toBe('false')
  const sessionConsent = dialog.getByRole('switch', { name: 'Session telemetry', exact: true })
  const mutation = page.waitForResponse(response => response.url().endsWith('/api/settings/mutate'))
  await sessionConsent.click()
  const response: unknown = await (await mutation).json()
  expect(response, JSON.stringify(response)).toMatchObject({ result: { ok: true } })
  await expect.poll(() => sessionConsent.getAttribute('aria-checked')).toBe('true')
  expect(telemetryEntry.fiber!.uid).toBe(fiberId)
  expect(backend.consent.sessionTelemetry).toBe(true)
  expect(backend.consent.providerMetadata).toBe(false)
  const patch = join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')
  expect(await readFile(patch, 'utf8')).toContain('sessionTelemetry: true')

  const warningStart = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await openSettings(page, 'en')
  await dialog.getByRole('button', { name: 'Telemetry', exact: true }).click()
  await expect.poll(() => sessionConsent.getAttribute('aria-checked')).toBe('true')
  acknowledgeReloadConnectionLoss(tripwire, warningStart)
  await sessionConsent.click()
  await expect.poll(() => sessionConsent.getAttribute('aria-checked')).toBe('false')
  expect(backend.consent.sessionTelemetry).toBe(false)
  expect(await readFile(patch, 'utf8')).toContain('sessionTelemetry: false')
  expect(requests).toBe(0)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})

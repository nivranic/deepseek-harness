// Cold boot may issue one settings/describe calls regardless of client
// plugin count. No model call or replay fixture is involved.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/** The first admitted generation starts the shared describe read after capability discovery. */
const DESCRIBE_BUDGET = 1

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold()
  const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
  browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
})

afterAll(async () => {
  await page?.close()
  await browser?.close()
  await scaffold?.close()
})

describe('startup RPC budget', () => {
  it('keeps cold-boot settings.describe at the mirror count', async () => {
    page = await newEnglishPage(browser)
    watchConsole(page)
    const calls: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) calls.push(url.pathname.slice('/api/'.length))
    })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    // The action is derived from the accepted shared describe response.
    await page.getByRole('button', { name: 'Open configuration file', exact: true }).waitFor({ timeout: 30_000 })
    const describeCount = calls.filter(method => method === 'settings/describe').length
    expect(describeCount, `startup /api calls:\n${calls.join('\n')}`).toBe(DESCRIBE_BUDGET)
  })
})

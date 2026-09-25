/** Unified Diff rendering and raw patch copying through the shipped file preview. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const PAGING = fileURLToPath(new URL('../../../snapshots/web/document-preview/paging.patch.yml', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/diff-preview.expected.md', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../.artifacts/screenshots/diff-readable-copy/', import.meta.url))
const PATCH = [
  '--- a/one.ts', '+++ b/one.ts', '@@ -1 +1 @@', '-old', '+new',
  'diff --git a/two.ts b/two.ts', '--- a/two.ts', '+++ b/two.ts', '@@ -2 +2 @@', '-before', '+after',
].join('\n')

describe.skipIf(MODE === 'record')('web e2e: unified Diff preview', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false, extraOverlayPath: PAGING })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('distinguishes file headers and changes, and copies full or loaded patch text', async () => {
    onTestFailed(async () => {
      await mkdir(SHOTS, { recursive: true })
      await saveFailureShot(page, `screenshots/diff-readable-copy/failure-${process.pid}`)
    })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill('Reply with the single word LIGHTHOUSE and stop.')
    await input.press('Enter')
    const id = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const cwd = scaffold.ctx.agents.get(id)?.session.header.cwd
    if (cwd === undefined) throw new Error('Diff scenario has no Session workspace')
    const pagedLines = ['@@ -1,100 +1,100 @@', ...Array.from({ length: 100 }, (_, index) => ` unchanged line ${index + 1}`)]
    await writeFile(join(cwd, 'changes.diff'), PATCH)
    await writeFile(join(cwd, 'paged.patch'), pagedLines.join('\n'))
    await page.locator('[data-sidebar-right-expand]').click()
    const column = page.locator('[data-rightbar-col]')
    await column.locator('[data-files-state="tree"]').waitFor()
    await column.locator('[data-files-reload]').click()
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'changes.diff', exact: true }).click()
    const preview = column.locator('[data-diff-preview]')
    await expect.poll(() => preview.locator('[data-diff-row]').count()).toBe(11)
    const rows = await preview.locator('[data-diff-row]').evaluateAll(nodes => nodes.map(node => ({
      type: node.getAttribute('data-diff-row'), text: node.textContent,
      background: getComputedStyle(node).backgroundColor,
    })))
    expect(rows.slice(5, 8).map(row => row.type)).toEqual(['preamble', 'preamble', 'preamble'])
    expect(rows[6]?.text?.trim()).toBe('--- a/two.ts')
    expect(rows[7]?.text?.trim()).toBe('+++ b/two.ts')
    expect(rows[3]?.text).toBe('1-old')
    expect(rows[4]?.text).toBe('1+new')
    expect(rows[2]?.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(rows[3]?.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(rows[4]?.background).not.toBe(rows[3]?.background)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
    const copyPatch = async (button: Locator, text: string): Promise<void> => {
      // Windows clipboard text normalizes line endings independently of the product.
      await page.evaluate(value => navigator.clipboard.writeText(value), text)
      const expected = await page.evaluate(() => navigator.clipboard.readText())
      await page.evaluate(() => navigator.clipboard.writeText(''))
      await button.click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
    }
    await copyPatch(preview.getByRole('button', { name: 'Copy diff', exact: true }), PATCH)
    await mkdir(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}/desktop-${MODE}-${process.pid}.png`, fullPage: true })
    await page.setViewportSize({ width: 375, height: 812 })
    await preview.waitFor({ state: 'visible' })
    const copyButton = await preview.getByRole('button', { name: 'Copied', exact: true }).boundingBox()
    expect(copyButton).not.toBeNull()
    expect(copyButton!.x).toBeGreaterThanOrEqual(0)
    expect(copyButton!.x + copyButton!.width).toBeLessThanOrEqual(375)
    expect(await preview.locator('[data-diff-scrollport]').count()).toBe(1)
    await page.screenshot({ path: `${SHOTS}/phone-${MODE}-${process.pid}.png`, fullPage: true })
    await page.setViewportSize({ width: 1680, height: 1000 })
    await column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) }).click()
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'paged.patch', exact: true }).click()
    await expect.poll(() => preview.locator('[data-diff-row]').count()).toBe(64)
    await copyPatch(preview.getByRole('button', { name: 'Copy loaded diff', exact: true }), pagedLines.slice(0, 64).join('\n'))
    await preview.locator('[data-diff-scrollport]').evaluate((node) => { node.scrollTop = node.scrollHeight })
    await expect.poll(() => preview.getAttribute('data-diff-eof'), { timeout: 15_000 }).toBe('true')
    await expect.poll(() => preview.locator('[data-diff-row]').count()).toBe(101)
    await copyPatch(preview.getByRole('button', { name: 'Copy diff', exact: true }), pagedLines.join('\n'))
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await compareOrRefreshGolden(EXPECTED, [
      '# Unified Diff preview', '',
      '- Second file headers: preamble without source line numbers',
      '- Removed / added rows: 1-old / 1+new; distinct theme backgrounds',
      '- Hunk header: elevated background',
      '- Phone viewport: unified rows and copy action inside the viewport',
      '- Copy diff: original patch with prefixes, headers and no display gutters',
      '- Paging: 64 -> 101 rows through the renderer scrollport',
      '- Copy loaded diff: first 64 lines only; complete copy after paging',
    ].join('\n'), MODE)
  })
})

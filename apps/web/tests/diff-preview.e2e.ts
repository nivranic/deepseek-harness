/** Patch files open through the shipped Files text/code preview: full text
 * content, paging through the workspace-files line budget, and raw copies. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const PAGING = fileURLToPath(new URL('../../../snapshots/web/document-preview/paging.patch.yml', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/diff-preview.expected.md', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../.artifacts/screenshots/diff-rich-viewer/', import.meta.url))
const PATCH = [
  '--- a/one.ts', '+++ b/one.ts', '@@ -1 +1 @@', '-old', '+new',
  'diff --git a/two.ts b/two.ts', '--- a/two.ts', '+++ b/two.ts', '@@ -2 +2 @@', '-const before = 1', '+const after = 2',
  'diff --git a/archive.unknown b/archive.unknown', 'Binary files a/archive.unknown and b/archive.unknown differ',
  'diff --git a/main.py b/main.py', '--- a/main.py', '+++ b/main.py', '@@ -1 +1 @@', '-print("before")', '+print("after")',
].join('\n')

/** Source lines of the paging fixture: one hunk header plus 100 unchanged lines. */
const PAGED_LINES = ['@@ -1,100 +1,100 @@', ...Array.from({ length: 100 }, (_, index) => ` unchanged line ${index + 1}`)]
/** The overlay caps one workspace-files read at 64 lines. */
const PAGE_LINES = 64

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
      await saveFailureShot(page, `screenshots/diff-rich-viewer/failure-${process.pid}`)
    })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill('Reply with the single word LIGHTHOUSE and stop.')
    await input.press('Enter')
    const id = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const cwd = scaffold.ctx.agents.get(id)?.session.header.cwd
    if (cwd === undefined) throw new Error('Diff scenario has no Session workspace')
    await writeFile(join(cwd, 'changes.diff'), PATCH)
    await writeFile(join(cwd, 'paged.patch'), PAGED_LINES.join('\n'))
    await writeFile(join(cwd, 'two.ts'), 'const after = 2')
    await writeFile(join(cwd, 'archive.unknown'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    await page.locator('[data-sidebar-right-expand]').click()
    const column = page.locator('[data-rightbar-col]')
    // The expanded right sidebar opens on its Start tab; the Files tree is a
    // dock tab opened through the Start tab's guide entry.
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    await column.locator('[data-files-state="tree"]').waitFor()
    await column.locator('[data-files-reload]').click()
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'changes.diff', exact: true }).click()
    const preview = column.locator('[data-textpreview-body]')
    const lines = preview.locator('[data-code-preview] .line')
    await expect.poll(() => lines.allTextContents(), { timeout: 15_000 }).toEqual(PATCH.split('\n'))
    // The code renderer decorates patch structure: file headers and hunk
    // markers carry meta classes, removed and added lines carry markers.
    // CSS-module class names are hash-prefixed, so match the logical suffix.
    const decorated = await lines.evaluateAll(nodes => nodes
      .filter(node => node.querySelector('span[class*="_diffMarker"]') !== null)
      .map(node => node.textContent))
    expect(decorated).toEqual(['-old', '+new', '-const before = 1', '+const after = 2', '-print("before")', '+print("after")'])
    const metaLines = await lines.evaluateAll(nodes => nodes
      .filter(node => [...node.classList].some(cls => cls.includes('_diffMeta') || cls.includes('_diffHunk')))
      .map(node => node.textContent))
    expect(metaLines).toContain('--- a/one.ts')
    expect(metaLines).toContain('+++ b/one.ts')
    expect(metaLines).toContain('@@ -1 +1 @@')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
    // Windows clipboard text normalizes line endings independently of the product.
    await page.evaluate(value => navigator.clipboard.writeText(value), PATCH)
    const expectedPatch = await page.evaluate(() => navigator.clipboard.readText())
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await preview.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedPatch)
    await mkdir(SHOTS, { recursive: true })
    await page.screenshot({ path: `${SHOTS}/desktop-${MODE}-${process.pid}.png`, fullPage: true })
    await column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) }).click()
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'paged.patch', exact: true }).click()
    const pagedPreview = column.locator('[data-textpreview-body]')
    const pagedLines = pagedPreview.locator('[data-code-preview] .line')
    await expect.poll(() => pagedLines.count(), { timeout: 15_000 }).toBe(PAGE_LINES)
    expect(await pagedLines.allTextContents()).toEqual(PAGED_LINES.slice(0, PAGE_LINES))
    await expect.poll(() => pagedPreview.locator('[data-textpreview-more]').isEnabled()).toBe(true)
    await pagedPreview.locator('[data-textpreview-more]').click()
    await expect.poll(() => pagedLines.allTextContents(), { timeout: 15_000 }).toEqual(PAGED_LINES)
    await expect.poll(() => pagedPreview.locator('[data-textpreview-more]').count()).toBe(0)
    await page.evaluate(value => navigator.clipboard.writeText(value), PAGED_LINES.join('\n'))
    const expectedPaged = await page.evaluate(() => navigator.clipboard.readText())
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await pagedPreview.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expectedPaged)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await compareOrRefreshGolden(EXPECTED, [
      '# Patch preview through Files', '',
      '- Full patch: every header, hunk, removed and added line as file text',
      '- Copy: the raw patch bytes with no preview chrome',
      '- Paging: 64 budgeted lines, then the complete 101 through the pager',
      '- Paged copy: the whole file after paging',
    ].join('\n'), MODE)
  })
})

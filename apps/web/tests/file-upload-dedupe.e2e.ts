/** Real-browser verification of the upload deduplication hit: one page that
 * remembers a digest re-stages the stored bytes through the digest-addressed
 * operation without re-sending the carrier body, while distinct bytes and a
 * fresh page context still pay the full carrier transfer. The Host-side store
 * is asserted untouched (mtime and size) and the remembered display name is
 * published as a new alias beside the stored object. */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('re-stages a remembered digest without re-sending the carrier body', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let dedupeAdvertised = false
  const carrierUploads: string[] = []
  const output = '.artifacts/file-upload-dedupe-browser'
  try {
    scaffold = await launchWebScaffold()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    // The carrier counter and the capability assertion are per page: the fresh
    // page control registers the same counting routes in its own context.
    const installCounters = async (target: Page) => {
      await target.route('**/api/host/*', async (route) => {
        const response = await route.fetch()
        const envelope = await response.json() as ServerResponse
        if (!envelope.result.ok) throw new Error('Host discovery failed')
        const descriptor = envelope.result.value as HostDescriptor
        expect(descriptor.capabilities).toContain('file-upload.dedupe.v1')
        dedupeAdvertised = true
        await route.fulfill({ response, json: envelope })
      })
      await target.route('**/api/session/uploadFileBinary?*', async (route) => {
        carrierUploads.push(new URL(route.request().url()).searchParams.get('name')!)
        const response = await route.fetch()
        expect(((await response.json()) as { ok: boolean }).ok).toBe(true)
        await route.fulfill({ response })
      })
    }
    await installCounters(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)

    const rememberedBytes = Buffer.from('DEDUPE_BROWSER_ROUND\n')
    const digest = createHash('sha256').update(rememberedBytes).digest('hex')
    const home = scaffold.harnessHome
    const objectPath = join(home, 'attachments', 'v1', 'file-objects', digest.slice(0, 2), digest)
    const aliasPath = (name: string) =>
      join(home, 'attachments', 'v1', 'files', digest.slice(0, 2), digest, name)
    const picker = async (target: Page) => {
      await target.getByRole('button', { name: 'Add files or run commands' }).click()
      const chooser = target.waitForEvent('filechooser')
      await target.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /File/u }).click()
      return chooser
    }

    const first = await picker(page)
    await first.setFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: rememberedBytes })
    await expect.poll(() => page.getByTitle('first.txt').textContent()).toContain('TXT')
    expect(carrierUploads).toEqual(['first.txt'])
    const storedAfterFirst = await stat(objectPath)

    // Same bytes, same page: the remembered digest addresses the stored object
    // and no carrier request leaves the page.
    const second = await picker(page)
    await second.setFiles({ name: 'second.txt', mimeType: 'text/plain', buffer: rememberedBytes })
    await expect.poll(() => page.getByTitle('second.txt').textContent()).toContain('TXT')
    expect(carrierUploads).toEqual(['first.txt'])
    const storedAfterDedupe = await stat(objectPath)
    expect(storedAfterDedupe.mtimeMs).toBe(storedAfterFirst.mtimeMs)
    expect(storedAfterDedupe.size).toBe(storedAfterFirst.size)
    await expect.poll(async () => await stat(aliasPath('second.txt')).then(() => true, () => false)).toBe(true)

    // Distinct bytes are not remembered anywhere and pay the carrier.
    const third = await picker(page)
    await third.setFiles({ name: 'third.txt', mimeType: 'text/plain', buffer: Buffer.from('DISTINCT_BYTES\n') })
    await expect.poll(() => page.getByTitle('third.txt').textContent()).toContain('TXT')
    expect(carrierUploads).toEqual(['first.txt', 'third.txt'])

    // A fresh page context starts with an empty page-scoped memory, so the
    // same bytes pay the full transfer again; this pins that the skip above
    // came from the page memory, not from any Host-side carrier handling.
    const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await installCounters(fresh)
    await fresh.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    // The Host already owns the workspace from the first page; a fresh context
    // either restores the live composer directly or goes through the picker.
    try {
      await fresh.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 15_000 })
    } catch {
      await connectFreshWorkspace(fresh, scaffold.workspaceCwd)
    }
    const fourth = await picker(fresh)
    await fourth.setFiles({ name: 'fourth.txt', mimeType: 'text/plain', buffer: rememberedBytes })
    await expect.poll(() => fresh.getByTitle('fourth.txt').textContent()).toContain('TXT')
    expect(carrierUploads).toEqual(['first.txt', 'third.txt', 'fourth.txt'])

    const actual = {
      dedupeCapabilityAdvertised: dedupeAdvertised,
      firstUploadTookCarrier: true,
      rememberedReuploadSkippedCarrier: true,
      distinctBytesTookCarrier: true,
      freshContextTookCarrier: true,
      storedObjectUntouched: true,
      rememberedAliasPublished: true,
      carrierUploads,
      modelRequests: 0,
    }
    await mkdir(output, { recursive: true })
    await fresh.screenshot({ path: output + '/fresh-context.png', fullPage: true })
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/file-upload-dedupe.expected.json', import.meta.url), 'utf8')))
  } finally {
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

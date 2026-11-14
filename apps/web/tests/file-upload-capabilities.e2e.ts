/** Real raw-byte staging with controlled discovery and delayed upload delivery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('checks file and image staging independently and preserves completed uploads across reconnect', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let supported = false
  let generations = 0
  let descriptions = 0
  let disconnect: (() => Promise<void>) | undefined
  const uploaded: string[] = []
  const committed: string[] = []
  const imageUploads: string[] = []
  const release = Promise.withResolvers<undefined>()
  let delayed = 0
  let delivered = 0
  const output = '.artifacts/file-upload-capability-browser'
  try {
    scaffold = await launchWebScaffold()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const targetPage = page
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      disconnect = async () => { await server.close(); await socket.close() }
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; value?: { type?: string } }
        if (frame.type === 'item' && frame.value?.type === 'ready') generations++
        socket.send(message)
      })
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Upload discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toContain('file-upload.stage.v1')
      expect(descriptor.capabilities).toContain('image-upload.stage.v1')
      if (new URL(route.request().url()).pathname.endsWith('/describe')) descriptions++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => id !== 'file-upload.stage.v1' || supported),
      } } } })
    })
    await page.route('**/api/session/uploadFileBinary?*', async (route) => {
      const query = new URL(route.request().url()).searchParams
      const name = query.get('name')!
      if (query.has('mediaType')) {
        const response = await route.fetch()
        expect((await response.json() as { ok: boolean }).ok).toBe(true)
        imageUploads.push(name)
        await route.fulfill({ response })
        return
      }
      uploaded.push(name)
      const response = await route.fetch()
      const result = await response.json() as { ok: boolean }
      expect(result.ok).toBe(true)
      committed.push(name)
      if (name.startsWith('active-')) { delayed++; await release.promise }
      await route.fulfill({ response })
      if (name.startsWith('active-')) delivered++
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('retain upload draft')
    const picker = async () => {
      await targetPage.getByRole('button', { name: 'Add files or run commands' }).click()
      const [chooser] = await Promise.all([
        targetPage.waitForEvent('filechooser'),
        targetPage.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /File/u }).click(),
      ])
      return chooser
    }
    const reconnect = async (next: boolean) => {
      supported = next
      const target = generations + 1
      await disconnect!()
      await expect.poll(() => generations, { timeout: 30_000 }).toBe(target)
      await expect.poll(() => input.isEnabled()).toBe(true)
    }
    const imageChooser = await picker()
    expect(await page.locator('input[type="file"]').getAttribute('accept')).toBeNull()
    const imageBytes = await readFile(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
    await imageChooser.setFiles({ name: 'keep.png', mimeType: 'image/png', buffer: imageBytes })
    await page.getByRole('button', { name: 'Remove image keep.png' }).waitFor()
    await expect.poll(() => imageUploads).toEqual(['keep.png'])
    await expect.poll(() => targetPage.getByRole('img', { name: 'keep.png' }).locator('..').getAttribute('aria-busy')).toBe('false')
    const blockedChooser = await picker()
    await blockedChooser.setFiles({ name: 'blocked.txt', mimeType: 'text/plain', buffer: Buffer.from('blocked') })
    await expect.poll(() => targetPage.getByTitle('blocked.txt').textContent()).toContain('Upload failed')
    expect(uploaded).toEqual([])
    await page.getByRole('button', { name: 'Remove file blocked.txt' }).click()
    await reconnect(true)
    const staleChooser = await picker()
    await reconnect(false)
    await staleChooser.setFiles({ name: 'stale.txt', mimeType: 'text/plain', buffer: Buffer.from('stale') })
    await expect.poll(() => targetPage.getByTitle('stale.txt').textContent()).toContain('Upload failed')
    expect(uploaded).toEqual([])
    await page.getByRole('button', { name: 'Remove file stale.txt' }).click()
    await reconnect(true)
    const readyChooser = await picker()
    await readyChooser.setFiles({ name: 'ready.txt', mimeType: 'text/plain', buffer: Buffer.from('ready') })
    await expect.poll(() => committed).toEqual(['ready.txt'])
    await expect.poll(() => targetPage.getByTitle('ready.txt').textContent()).toContain('TXT')
    const activeChooser = await picker()
    await activeChooser.setFiles(['active-one', 'active-two', 'queued'].map(name => ({ name: name + '.txt', mimeType: 'text/plain', buffer: Buffer.from(name) })))
    await expect.poll(() => delayed).toBe(2)
    expect([...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'ready.txt'])
    await reconnect(false)
    await expect.poll(() => targetPage.getByRole('button', { name: /^Retry upload/u }).count()).toBe(3)
    for (const name of ['active-one', 'active-two', 'queued']) {
      await expect.poll(() => targetPage.getByTitle(name + '.txt').textContent()).toContain('Upload failed')
    }
    expect(await page.getByTitle('ready.txt').textContent()).toContain('TXT')
    expect(await input.textContent()).toBe('retain upload draft')
    expect(await page.getByRole('button', { name: 'Remove image keep.png' }).count()).toBe(1)
    const beforeRejectedRetry = descriptions
    await page.getByRole('button', { name: 'Retry uploading queued.txt' }).click()
    await expect.poll(() => descriptions).toBeGreaterThan(beforeRejectedRetry)
    await expect.poll(() => targetPage.getByTitle('queued.txt').textContent()).toContain('Upload failed')
    expect([...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'ready.txt'])
    release.resolve(undefined)
    await expect.poll(() => delivered).toBe(2)
    await expect.poll(() => targetPage.getByRole('button', { name: /^Retry upload/u }).count()).toBe(3)
    await reconnect(true)
    await expect.poll(() => targetPage.getByRole('button', { name: /^Retry upload/u }).count()).toBe(3)
    expect([...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'ready.txt'])
    await page.getByRole('button', { name: 'Retry uploading queued.txt' }).click()
    await expect.poll(() => targetPage.getByTitle('queued.txt').textContent()).toContain('TXT')
    expect(await page.getByRole('button', { name: /^Retry upload/u }).count()).toBe(2)
    expect([...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'queued.txt', 'ready.txt'])
    const actual = { discoveryControlled: true, rawResponseDeliveryControlled: true, noUnsupportedUpload: true,
      pickerChecksCurrentAdmission: true, independentImageStaging: true, imageDraftRetained: true,
      composerDraftRetained: true, completedReceiptRetained: true, unsupportedRetryRejected: true,
      queuedUploadWaitedForExplicitRetry: true, oldResponsesSuppressed: true, noAutomaticRetry: true,
      uploaded: [...uploaded].sort(), committed: [...committed].sort(), imageUploads, modelRequests: 0 }
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/file-upload.expected.json', import.meta.url), 'utf8')))
  } finally {
    release.resolve(undefined)
    try { await page?.unrouteAll({ behavior: 'wait' }) } finally {
      try { await browser?.close() } finally { await scaffold?.close() }
    }
  }
}, 120_000)

/** Real raw-byte staging with controlled discovery and delayed upload delivery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('withdraws upload receipts and queued work, preserves files and requires explicit retry after reconnect', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let supported = false
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const uploaded: string[] = []
  const committed: string[] = []
  const release = Promise.withResolvers<undefined>()
  let delayed = 0
  const output = '.artifacts/file-upload-capability-browser'
  try {
    scaffold = await launchWebScaffold()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Upload discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toContain('file-upload.stage.v1')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => id !== 'file-upload.stage.v1' || supported),
      } } } })
    })
    await page.route('**/api/session/uploadFileBinary?*', async (route) => {
      const name = new URL(route.request().url()).searchParams.get('name')!
      uploaded.push(name)
      const response = await route.fetch()
      const result = await response.json() as { ok: boolean }
      expect(result.ok).toBe(true)
      committed.push(name)
      if (name.startsWith('active-')) { delayed++; await release.promise }
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('retain upload draft')
    const picker = async (label: string) => {
      await page.getByRole('button', { name: 'Add files or run commands' }).click()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: new RegExp(label, 'u') }).click()
      return chooser
    }
    const reconnect = async (next: boolean) => {
      supported = next
      const target = negotiations + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
      await expect.poll(() => input.isEnabled()).toBe(true)
    }
    const imageChooser = await picker('Image')
    expect(await page.locator('input[type="file"]').getAttribute('accept')).toContain('image/')
    const imageBytes = await readFile(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
    await imageChooser.setFiles({ name: 'keep.png', mimeType: 'image/png', buffer: imageBytes })
    await page.getByRole('button', { name: 'Remove image keep.png' }).waitFor()
    expect(uploaded).toEqual([])
    await reconnect(true)
    const staleChooser = await picker('File')
    await reconnect(true)
    await staleChooser.setFiles({ name: 'stale.txt', mimeType: 'text/plain', buffer: Buffer.from('stale') })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(uploaded).toEqual([])
    const readyChooser = await picker('File')
    await readyChooser.setFiles({ name: 'ready.txt', mimeType: 'text/plain', buffer: Buffer.from('ready') })
    await expect.poll(() => committed).toEqual(['ready.txt'])
    await expect.poll(() => page.getByTitle('ready.txt').textContent()).toContain('TXT')
    const activeChooser = await picker('File')
    await activeChooser.setFiles(['active-one', 'active-two', 'queued'].map(name => ({ name: name + '.txt', mimeType: 'text/plain', buffer: Buffer.from(name) })))
    await expect.poll(() => delayed).toBe(2)
    expect([...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'ready.txt'])
    await reconnect(false)
    await expect.poll(() => page.getByRole('button', { name: /^Retry upload/u }).count()).toBe(0)
    for (const name of ['ready', 'active-one', 'active-two', 'queued']) {
      await expect.poll(() => page.getByTitle(name + '.txt').textContent()).toContain('Upload failed')
    }
    expect(await input.textContent()).toBe('retain upload draft')
    expect(await page.getByRole('button', { name: 'Remove image keep.png' }).count()).toBe(1)
    release.resolve(undefined)
    await reconnect(true)
    await expect.poll(() => page.getByRole('button', { name: /^Retry upload/u }).count()).toBe(4)
    expect([...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'ready.txt'])
    await page.getByRole('button', { name: 'Retry uploading ready.txt' }).click()
    await expect.poll(() => [...uploaded].sort()).toEqual(['active-one.txt', 'active-two.txt', 'ready.txt', 'ready.txt'])
    await expect.poll(() => page.getByTitle('ready.txt').textContent()).toContain('TXT')
    expect(await page.getByRole('button', { name: /^Retry upload/u }).count()).toBe(3)
    const actual = { discoveryControlled: true, rawResponseDeliveryControlled: true, noUnsupportedUpload: true,
      stalePickerRejected: true, imageDraftRetained: true, composerDraftRetained: true, readyReceiptWithdrawn: true,
      queuedUploadNeverDispatched: true, oldResponsesSuppressed: true, noAutomaticRetry: true,
      explicitRetrySucceeded: true, uploaded: [...uploaded].sort(), committed: [...committed].sort(), modelRequests: 0 }
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/file-upload.expected.json', import.meta.url), 'utf8')))
  } finally {
    release.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

/** Viewing links use authenticated Host identity and reveal a durable turn in the shipped Web profile. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('copies an authenticated-page link and opens an earlier turn without carrying credentials', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)) })
  onTestFinished(async () => { await scaffold.close() })
  const workspacePath = join(scaffold.workspaceCwd, 'handoff')
  await mkdir(workspacePath, { recursive: true })
  const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
  const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
  const agent = scaffold.ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error('Handoff fixture has no Agent')
  let firstAnchor = 0
  for (let turn = 1; turn <= 45; turn++) {
    const start = agent.session.append('turn/start', { turn })
    if (turn === 1) firstAnchor = start.seq
    agent.session.append('step/start', { turn, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `Handoff turn ${turn}: ${'durable history '.repeat(35)}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn, step: 1 })
    agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  await scaffold.ctx.sessionController.rename({ sessionId, title: 'Handoff history' })
  await scaffold.ctx.sessions.flush(agent.session)
  const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  onTestFinished(async () => { await browser.close() })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const captureConsole = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
  await page.getByRole('treeitem').filter({ hasText: 'New Session' }).waitFor()
  const group = page.getByRole('treeitem').filter({ hasText: workspace.title }).first()
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByRole('treeitem').filter({ hasText: 'Handoff history' }).last().click()
  const trigger = page.getByRole('button', { name: /^(Continue on another device|View-location link copied)$/ })
  const panel = page.getByRole('dialog', { name: 'Scan on another device to continue viewing', exact: true })
  await trigger.click()
  await panel.waitFor()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(async () => {
      const bounds = await panel.boundingBox()
      return bounds !== null && bounds.x >= 0 && bounds.y >= 0
        && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height
    }).toBe(true)
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.keyboard.press('Escape')
  await expect.poll(() => panel.isVisible()).toBe(false)
  await expect.poll(() => trigger.evaluate(button => button === document.activeElement)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light' })
  await trigger.click()
  await panel.waitFor()
  await page.locator('[data-composer-input][contenteditable="true"]').click()
  await expect.poll(() => panel.isVisible()).toBe(false)
  const address = new URL(link)
  expect(address.search).toBe('')
  expect(address.origin).toBe(new URL(scaffold.authenticatedUrl).origin)
  const prefix = '#dsh-view=dsh-session-view.v1.'
  expect(address.hash.startsWith(prefix)).toBe(true)
  const location = JSON.parse(Buffer.from(address.hash.slice(prefix.length), 'base64url').toString()) as {
    hostId: string
    sessionId: string
    anchorSeq: number
  }
  expect(location.sessionId).toBe(sessionId)
  expect(location.anchorSeq).toBeGreaterThan(0)
  const linked = (value: typeof location): string => {
    const url = new URL(link)
    url.hash = prefix.slice(1) + Buffer.from(JSON.stringify(value)).toString('base64url')
    return url.href
  }
  const receiver = await context.newPage()
  const receiverConsole = watchConsole(receiver)
  await receiver.goto(linked({ ...location, anchorSeq: firstAnchor }), { waitUntil: 'load' })
  const first = receiver.getByRole('button', { name: 'Jump to turn 1', exact: true })
  await expect.poll(() => first.getAttribute('aria-current')).toBe('true')
  expect(new URL(receiver.url()).hash).toBe('')
  const anchor = receiver.locator('[data-chat-turn="1"][data-chat-paging-anchor]').first()
  await expect.poll(async () => {
    const bounds = await anchor.boundingBox()
    return bounds !== null && bounds.y >= 0 && bounds.y < 900
  }).toBe(true)
  await receiver.close()

  const refused = await context.newPage()
  const sessionRequests: string[] = []
  refused.on('request', (request) => {
    if (request.url().includes('/api/session/') && request.postData()?.includes(sessionId)) sessionRequests.push(request.url())
  })
  await refused.goto(linked({ ...location, hostId: 'different-host' }), { waitUntil: 'load' })
  await refused.getByText('This link belongs to another Host. Open its original page.', { exact: true }).waitFor()
  expect(sessionRequests).toEqual([])
  const malformed = await context.newPage()
  await malformed.goto(new URL('#dsh-view=invalid', link).href, { waitUntil: 'load' })
  await malformed.getByText('This view link is invalid. Copy a new link.', { exact: true }).waitFor()
  const expired = await context.newPage()
  await expired.goto(linked({ ...location, anchorSeq: Number.MAX_SAFE_INTEGER }), { waitUntil: 'load' })
  await expired.getByText('The viewing position could not open. Check Session access and try again.', { exact: true }).waitFor()
  expect(captureConsole.pageErrors).toEqual([])
  expect(receiverConsole.pageErrors).toEqual([])
})

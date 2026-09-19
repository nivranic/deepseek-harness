/** Two browser title editors retain their opening revision across saves and retries. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { chromium, type Browser, type Page } from 'playwright'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'

async function editor(page: Page, title: string) {
  await page.getByRole('treeitem').filter({ hasText: title }).hover()
  await page.getByRole('button', { name: `Session actions for ${title}`, exact: true, includeHidden: true }).click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  return page.getByRole('dialog', { name: 'Rename session', exact: true })
}

it('preserves the newer title, keeps a conflicting draft, and deduplicates accepted retries', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const failures: unknown[] = []
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('rename fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Rename revision fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Original title' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const first = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const second = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await first.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await second.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    for (const page of [first, second]) {
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
      await page.getByRole('treeitem').filter({ hasText: 'New Session' }).waitFor()
      const group = page.getByRole('treeitem').filter({ hasText: workspace.title }).first()
      if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    }
    const firstEditor = await editor(first, 'Original title')
    await firstEditor.getByRole('textbox', { name: 'Session name', exact: true }).fill('First draft')
    const secondEditor = await editor(second, 'Original title')
    await secondEditor.getByRole('textbox', { name: 'Session name', exact: true }).fill('Second saved')
    await secondEditor.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect.poll(() => secondEditor.count()).toBe(0)
    await first.getByRole('treeitem').filter({ hasText: 'Second saved' }).last().waitFor()
    const conflict = first.waitForResponse('**/api/session/renameAt')
    await firstEditor.getByRole('button', { name: 'Rename', exact: true }).click()
    const rejected = (await (await conflict).json() as ServerResponse).result
    const alert = firstEditor.getByRole('alert')
    await alert.waitFor()
    const conflictCopy = await alert.textContent()
    const preservedDraft = await firstEditor.getByRole('textbox', { name: 'Session name', exact: true }).inputValue()
    const retry = first.waitForResponse('**/api/session/renameAt')
    await firstEditor.getByRole('button', { name: 'Rename', exact: true }).click()
    expect((await (await retry).json() as ServerResponse).result).toMatchObject({ ok: false, error: { code: 'session/revision-conflict' } })
    await mkdir('.artifacts/rename-revision-browser', { recursive: true })
    await first.screenshot({ path: '.artifacts/rename-revision-browser/conflict.png', fullPage: true })
    await firstEditor.getByRole('button', { name: 'Cancel', exact: true }).click()
    const reopened = await editor(first, 'Second saved')
    await reopened.getByRole('textbox', { name: 'Session name', exact: true }).fill(preservedDraft)
    const acceptedResponse = first.waitForResponse('**/api/session/renameAt')
    await reopened.getByRole('button', { name: 'Rename', exact: true }).click()
    const response = await acceptedResponse
    const accepted = (await response.json() as ServerResponse).result
    expect(accepted.ok).toBe(true)
    await expect.poll(() => reopened.count()).toBe(0)
    const body = response.request().postData()
    if (body === null) throw new Error('rename request body missing')
    const replay = async () => {
      const result = await scaffold.hostFetch('/api/session/renameAt', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      })
      return (await result.json() as ServerResponse).result
    }
    expect(await replay()).toEqual(accepted)
    await second.getByRole('treeitem').filter({ hasText: 'First draft' }).last().waitFor()
    const newerEditor = await editor(second, 'First draft')
    await newerEditor.getByRole('textbox', { name: 'Session name', exact: true }).fill('Final title')
    await newerEditor.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect.poll(() => newerEditor.count()).toBe(0)
    const staleReplay = await replay()
    expect(staleReplay).toMatchObject({ ok: false, error: { code: 'session/revision-conflict' } })
    const recorded = {
      conflictCode: rejected.ok ? null : rejected.error.code,
      conflictCopy, preservedDraft,
      titles: agent.session.snapshotEvents().flatMap(event => event.type === 'session/title' && event.data.source.kind === 'user' ? [event.data.title] : []),
      finalTitle: scaffold.ctx.sessionTitle.get(agent.session)?.title,
    }
    const expected = JSON.parse(await readFile(fileURLToPath(new URL('./expected/host-capability/rename-revision.expected.json', import.meta.url)), 'utf8')) as unknown
    expect(recorded).toEqual(expected)
    await first.getByRole('treeitem').filter({ hasText: 'Final title' }).last().waitFor()
    await first.screenshot({ path: '.artifacts/rename-revision-browser/settled.png', fullPage: true })
  } catch (error) {
    failures.push(error)
    await mkdir('.artifacts/rename-revision-browser', { recursive: true })
    let index = 0
    for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
      await page.screenshot({ path: `.artifacts/rename-revision-browser/failure-${String(index++)}.png`, fullPage: true })
    }
  } finally {
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Rename revision verification failed')
}, 120_000)

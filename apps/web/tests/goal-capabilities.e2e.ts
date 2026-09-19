/** Real Goal reads and edits with controlled capability advertisements and response delay. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import type {} from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold } from './scaffold.ts'

it('withdraws Goal controls and isolates an old edit response from the new connection editor', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const capabilities = ['goal.read.v1', 'goal.create.v1', 'goal.edit.v1', 'goal.pause.v1', 'goal.resume.v1', 'goal.complete.v1', 'goal.clear.v1']
  let supported: string[] = []
  let negotiations = 0
  let delayed = false
  let cancelledEdits = 0
  const release = Promise.withResolvers<undefined>()
  const delivered = Promise.withResolvers<undefined>()
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const output = '.artifacts/goal-capability-browser'
  try {
    scaffold = await launchWebScaffold()
    const path = join(scaffold.workspaceCwd, 'Goal capabilities')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Goal fixture has no live Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Goal capability fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // A replayed active Goal is disarmed; no driver receives continuation authority.
    agent.session.append('goal/change', {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'capability-goal' as GoalId, revision: 1, objective: 'Seeded objective', phase: 'active', maxGoalRounds: 3 },
      roundsStarted: 0, createdAt: 1, updatedAt: 1,
    })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Goal capability session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/goals/')) calls.push(endpoint)
    })
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/api/goals/edit') cancelledEdits++
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Goal fixture discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining(capabilities))
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !capabilities.includes(id) || supported.includes(id)),
      } } } })
    })
    await page.route('**/api/goals/edit', async (route) => {
      const response = await route.fetch()
      delayed = true
      await release.promise
      await route.fulfill({ response })
      delivered.resolve(undefined)
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.waitFor({ timeout: 30_000 })
    const workspaceRow = page.getByRole('treeitem').filter({ hasText: 'Goal capabilities' }).first()
    if (await workspaceRow.getAttribute('aria-expanded') === 'false') await workspaceRow.click()
    await page.getByRole('treeitem').filter({ hasText: 'Goal capability session' }).click()
    await input.fill('retain the message draft')
    const bar = page.locator('[data-goal-bar]')
    const observations: Array<{ stage: string; bar: number; edit: number; resume: number; clear: number }> = []
    const observe = async (stage: string) => {
      observations.push({ stage, bar: await bar.count(), edit: await bar.getByRole('button', { name: 'Edit goal' }).count(),
        resume: await bar.getByRole('button', { name: 'Resume goal' }).count(), clear: await bar.getByRole('button', { name: 'Clear goal' }).count() })
    }
    const reconnect = async (next: string[]) => {
      supported = next
      const target = negotiations + 1
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    expect(await bar.count()).toBe(0)
    expect(calls).toEqual([])
    await observe('absent')
    await reconnect(['goal.read.v1'])
    await bar.getByText('Seeded objective', { exact: true }).waitFor()
    await observe('read-only')
    await reconnect(['goal.read.v1', 'goal.edit.v1'])
    await bar.getByRole('button', { name: 'Edit goal' }).waitFor()
    await observe('edit-only')
    await bar.getByRole('button', { name: 'Edit goal' }).click()
    await bar.getByRole('textbox', { name: 'Goal objective' }).fill('Accepted Host edit')
    await bar.getByRole('button', { name: 'Save goal' }).click()
    await expect.poll(() => delayed).toBe(true)
    expect(scaffold.ctx.goals.get(agent)?.objective).toBe('Accepted Host edit')
    await reconnect(capabilities)
    await expect.poll(() => cancelledEdits).toBe(1)
    await bar.getByRole('button', { name: 'Resume goal' }).waitFor()
    await observe('restored')
    await bar.getByRole('button', { name: 'Edit goal' }).click()
    const editor = bar.getByRole('textbox', { name: 'Goal objective' })
    await editor.fill('new connection edit draft')
    release.resolve(undefined)
    await delivered.promise
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await editor.inputValue()).toBe('new connection edit draft')
    expect(await bar.getByRole('alert').count()).toBe(0)
    expect(await input.textContent()).toBe('retain the message draft')
    expect(calls.filter(endpoint => endpoint !== '/api/goals/get')).toEqual(['/api/goals/edit'])
    const changes = agent.session.snapshotEvents().filter(event => event.type === 'goal/change').map(event => event.data.operation)
    expect(changes).toEqual(['create', 'edit'])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/replacement-editor.png', fullPage: true })
    const actual = { observations, cancelledEdits, changes, retainedComposerDraft: true, retainedReplacementEditor: true,
      noMutationReplay: true, discoveryControlled: true, editReplyDeliveryControlled: true, goalInitiallySeededAndDisarmed: true }
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/goal.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } finally {
    release.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 120_000)

/** Real Goal projection, compare-and-set refusals, and explicit editing after reconnect. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type { RemoteEventDownlinkFrame } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import type { GoalId, GoalRef } from '@deepseek-ai/dsh-goal/types'
import type {} from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold } from './scaffold.ts'

it('preserves a refused Goal draft and retries against the current revision after reconnect', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let readyFrames = 0
  const release = Promise.withResolvers<undefined>()
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const editRefs: GoalRef[] = []
  const editResponses: ServerResponse['result'][] = []
  const output = '.artifacts/goal-capability-browser'
  try {
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
    // Seed a disarmed Goal so editing grants no continuation authority.
    agent.session.append('goal/change', {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'capability-goal' as GoalId, revision: 1, objective: 'Seeded objective', phase: 'active', maxGoalRounds: 3 },
      roundsStarted: 0, createdAt: 1, updatedAt: 1,
    })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Goal capability session' })
    await scaffold.ctx.sessions.flush(agent.session)
    expect(scaffold.ctx.goals.get(agent)?.activation).toBe('disarmed')
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/goals/')) calls.push(endpoint)
    })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/goals/edit', async (route) => {
      const request = route.request().postDataJSON() as { payload: { args: { ref: GoalRef } } }
      editRefs.push(request.payload.args.ref)
      if (editRefs.length === 1) await release.promise
      const response = await route.fetch()
      editResponses.push((await response.json() as ServerResponse).result)
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ timeout: 30_000 })
    const workspaceRow = page.getByRole('treeitem').filter({ hasText: 'Goal capabilities' }).first()
    if (await workspaceRow.getAttribute('aria-expanded') === 'false') await workspaceRow.click()
    await page.getByRole('treeitem').filter({ hasText: 'Goal capability session' }).click()
    const composerDraft = 'retain the message draft'
    await input.fill(composerDraft)
    const bar = page.locator('[data-goal-bar]')
    await bar.getByText('Seeded objective', { exact: true }).waitFor()
    await bar.getByRole('button', { name: 'Resume goal' }).waitFor()
    expect(await bar.getByRole('button', { name: 'Edit goal' }).count()).toBe(1)
    expect(await bar.getByRole('button', { name: 'Clear goal' }).count()).toBe(1)
    await bar.getByRole('button', { name: 'Edit goal' }).click()
    const editor = bar.getByRole('textbox', { name: 'Goal objective' })
    const goalDraft = 'Retained objective draft'
    await editor.fill(goalDraft)
    await bar.getByRole('button', { name: 'Save goal' }).click()
    await expect.poll(() => editRefs.length).toBe(1)
    const current = scaffold.ctx.goals.get(agent)
    if (current === undefined) throw new Error('seeded Goal disappeared before the concurrent edit')
    scaffold.ctx.goals.edit(agent, { id: current.id, revision: current.revision }, { objective: 'Concurrent Host edit' })
    release.resolve(undefined)
    const error = bar.getByRole('alert')
    await error.waitFor()
    const rejection = await error.textContent()
    expect(rejection).toMatch(/stale goal ref .* revision 1; current is .* revision 2/)
    expect(await editor.inputValue()).toBe(goalDraft)
    expect(scaffold.ctx.goals.get(agent)?.objective).toBe('Concurrent Host edit')
    const nextReady = readyFrames + 1
    await sockets.at(-1)!.close()
    await expect.poll(() => readyFrames, { timeout: 10_000 }).toBe(nextReady)
    await bar.getByText('Concurrent Host edit', { exact: true }).waitFor()
    expect(await editor.count()).toBe(0)
    expect(await input.textContent()).toBe(composerDraft)
    expect(editRefs).toEqual([{ id: 'capability-goal', revision: 1 }])
    await bar.getByRole('button', { name: 'Edit goal' }).click()
    await editor.fill(goalDraft)
    await bar.getByRole('button', { name: 'Save goal' }).click()
    await bar.getByText(goalDraft, { exact: true }).waitFor()
    expect(editRefs).toEqual([{ id: 'capability-goal', revision: 1 }, { id: 'capability-goal', revision: 2 }])
    expect(editResponses).toMatchObject([{ ok: false }, { ok: true }])
    expect(await bar.getByRole('alert').count()).toBe(0)
    expect(scaffold.ctx.goals.get(agent)?.objective).toBe(goalDraft)
    expect(scaffold.ctx.goals.get(agent)?.activation).toBe('disarmed')
    await bar.getByRole('button', { name: 'Edit goal' }).click()
    await editor.fill('cancelled goal draft')
    await bar.getByRole('button', { name: 'Cancel edit', exact: true }).click()
    await bar.getByText(goalDraft, { exact: true }).waitFor()
    expect(editRefs).toHaveLength(2)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/recovered.png`, fullPage: true })
    await bar.getByRole('button', { name: 'Clear goal' }).click()
    await expect.poll(() => bar.count()).toBe(0)
    expect(scaffold.ctx.goals.get(agent)).toBeUndefined()
    expect(await input.textContent()).toBe(composerDraft)
    const changes = agent.session.snapshotEvents().filter(event => event.type === 'goal/change').map(event => event.data.operation)
    expect(changes).toEqual(['create', 'edit', 'edit', 'clear'])
    const mutationCalls = calls.filter(endpoint => endpoint !== '/api/goals/get')
    expect(mutationCalls).toEqual(['/api/goals/edit', '/api/goals/edit', '/api/goals/clear'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)
    const actual = { rejection, editRevisions: editRefs.map(ref => ref.revision), changes, mutationCalls,
      retainedComposerDraft: true, goalDraftRetainedAfterRefusal: true, reconnectShowsCurrentGoal: true,
      noMutationReplay: true, goalInitiallySeededAndDisarmed: true }
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/goal.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
    await scaffold.ctx.sessions.flush(agent.session)
  } finally {
    release.resolve(undefined)
    await page?.unrouteAll({ behavior: 'wait' })
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

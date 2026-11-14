/** Competing approval answers through the real Web composition and two browser Clients. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type {
  RemoteEventDownlinkFrame, RemoteEventInvocationFrame, RemoteEventCancellationFrame,
  RemoteEventReadyFrame, RemoteEventResult,
} from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { launchWebScaffold } from './scaffold.ts'

it('recovers a rejected interaction reply without replaying the answer', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  const abort = new AbortController()
  let approval: Promise<string> | undefined
  try {
    const path = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('reply protocol fixture has no Agent')
    const decisions: string[] = []
    scaffold.ctx.on('session/event', (session, event) => {
      if (session.id === sessionId && event.type === 'approval/decided') decisions.push(event.data.outcome)
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const generations: RemoteEventReadyFrame[] = []
    const pending: RemoteEventInvocationFrame[] = []
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type !== 'item') return
        if (frame.value?.type === 'ready') generations.push(frame.value)
        if (frame.value?.type === 'waterfall') pending.push(frame.value)
      })
    })
    let replies = 0
    let rejectedCode: string | undefined
    await page.route('**/api/$events/result', async (route) => {
      replies++
      if (replies !== 1) { await route.continue(); return }
      const request = route.request().postDataJSON() as { payload: { args: RemoteEventResult } }
      const invalid = { ...request, payload: { args: { ...request.payload.args, outcome: { kind: 'invalid' } } } }
      const response = await route.fetch({ postData: JSON.stringify(invalid) })
      const envelope = await response.json() as ServerResponse
      rejectedCode = envelope.result.ok ? 'unexpected-success' : envelope.result.error.code
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    await expect.poll(() => generations.length).toBe(1)
    agent.session.append('turn/start', { turn: 1 })
    approval = scaffold.ctx.approval.request({ agent, toolName: 'fixture_action', reason: 'Check the reply protocol', signal: abort.signal })
    const panel = page.locator('[data-approval-key]')
    await panel.waitFor()
    await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect.poll(() => generations.length, { timeout: 10_000 }).toBe(2)
    await expect.poll(() => pending.length).toBe(2)
    await panel.waitFor()
    expect(rejectedCode).toBe('gateway/internal')
    expect(pending[1]).toEqual(pending[0])
    expect(replies).toBe(1)
    expect(decisions).toEqual([])
    await panel.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(approval).resolves.toBe('rejected')
    const observation = { rejectedCode, automaticReconnects: generations.length - 1,
      replies, decisions, samePendingEvent: true }
    const output = '.artifacts/interaction-reply-errors-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/recovered.png`, fullPage: true })
    await writeFile(`${output}/observation.json`, JSON.stringify(observation, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/interaction-reply-errors.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
  } finally {
    abort.abort()
    await approval?.catch(() => undefined)
    await page?.unrouteAll({ behavior: 'wait' })
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('settles one approval and ignores a competing answer without reconnecting either Client', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let second: Page | undefined
  const abort = new AbortController()
  const approvals: Promise<string>[] = []
  const releaseLosingReply = Promise.withResolvers<undefined>()
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('approval fixture has no live Agent')
    const decisions: string[] = []
    scaffold.ctx.on('session/event', (session, event) => {
      if (session.id === sessionId && event.type === 'approval/decided') decisions.push(event.data.outcome)
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const first = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    second = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const generations: RemoteEventReadyFrame[][] = [[], []]
    const records: (RemoteEventInvocationFrame | RemoteEventCancellationFrame)[][] = [[], []]
    for (const [index, page] of [first, second].entries()) {
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
          if (frame.type !== 'item') return
          if (frame.value?.type === 'ready') generations[index]!.push(frame.value)
          if (frame.value?.type === 'waterfall' || frame.value?.type === 'cancel') records[index]!.push(frame.value)
        })
      })
    }
    let holdCancellation = true
    const heldCancellations: (() => void)[] = []
    await second.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (holdCancellation && frame.type === 'item' && frame.value?.type === 'cancel') {
          heldCancellations.push(() => { socket.send(message) })
        } else socket.send(message)
      })
    })
    let losingReply: RemoteEventResult | undefined
    let losingResponse: ServerResponse['result'] | undefined
    await second.route('**/api/$events/result', async (route) => {
      if (losingReply !== undefined) { await route.continue(); return }
      const request = route.request().postDataJSON() as { payload: { args: RemoteEventResult } }
      losingReply = request.payload.args
      await releaseLosingReply.promise
      const response = await route.fetch()
      losingResponse = (await response.json() as ServerResponse).result
      await route.fulfill({ response })
    })
    for (const page of [first, second]) {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    }
    await expect.poll(() => generations.map(items => items.length)).toEqual([1, 1])
    agent.session.append('turn/start', { turn: 1 })
    const result = scaffold.ctx.approval.request({
      agent, toolName: 'fixture_action', reason: 'Approve the shared test action', signal: abort.signal,
    })
    approvals.push(result)
    const firstPanel = first.locator('[data-approval-key]')
    const secondPanel = second.locator('[data-approval-key]')
    await firstPanel.waitFor()
    await secondPanel.waitFor()
    await expect.poll(() => records.map(items => items.length)).toEqual([1, 1])
    expect(records[0]).toEqual(records[1])
    const original = records[0]![0]!
    expect(original).toMatchObject({ type: 'waterfall', event: 'approval/request', agentId: sessionId })
    const reply = { clientId: generations[0]![0]!.clientId, eventId: original.eventId,
      outcome: { kind: 'result', value: 'allowed-once' } }
    const invalidReplies = [
      { ...reply, outcome: { kind: 'invalid' } },
      { clientId: reply.clientId, outcome: reply.outcome },
      { ...reply, interactionRevision: 1 },
    ]
    const rejectedReplies: string[] = []
    for (const [index, invalid] of invalidReplies.entries()) {
      const response = await first.request.post(new URL('/api/$events/result', first.url()).href, { data: {
        type: 'client-request', rpcId: `invalid-event-reply-${index}`, method: '$events/result', payload: { args: invalid },
      } })
      const result = (await response.json() as ServerResponse).result
      expect(result).toMatchObject({ ok: false, error: { code: 'gateway/internal', message: 'api gateway: invalid Remote event result' } })
      rejectedReplies.push(result.ok ? 'unexpected-success' : result.error.code)
      expect(decisions).toEqual([])
    }
    await secondPanel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect.poll(() => losingReply).toBeDefined()
    await firstPanel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(result).resolves.toBe('allowed-once')
    releaseLosingReply.resolve(undefined)
    await expect.poll(() => losingResponse).toEqual({ ok: true })
    holdCancellation = false
    for (const send of heldCancellations) send()
    await expect.poll(() => secondPanel.count()).toBe(0)
    expect(decisions).toEqual(['allowed-once'])

    const next = scaffold.ctx.approval.request({
      agent, toolName: 'fixture_action', reason: 'Reject the second test action', signal: abort.signal,
    })
    approvals.push(next)
    await firstPanel.waitFor()
    await secondPanel.waitFor()
    const stale = await first.request.post(new URL('/api/$events/result', first.url()).href, { data: {
      type: 'client-request', rpcId: 'old-answer-during-new-approval', method: '$events/result', payload: { args: reply },
    } })
    expect(await stale.json()).toMatchObject({ result: { ok: true } })
    expect(await firstPanel.count()).toBe(1)
    expect(decisions).toEqual(['allowed-once'])
    await secondPanel.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(next).resolves.toBe('rejected')
    await expect.poll(() => firstPanel.count()).toBe(0)
    await expect.poll(() => records.map(items => items.length)).toEqual([3, 3])
    expect(records[0]![1]).toEqual(records[1]![2])
    expect(records[0]![1]!.eventId).not.toBe(original.eventId)
    expect(records[0]![2]).toEqual({ type: 'cancel', eventId: records[1]![2]!.eventId })
    expect(records[1]![1]).toEqual({ type: 'cancel', eventId: original.eventId })
    expect(generations.map(items => items.length)).toEqual([1, 1])
    const observation = { rejectedReplies, outcomes: decisions, losingResult: 'accepted-no-op', reconnects: [0, 0],
      interactions: records.map(items => items.map(frame => frame.type === 'waterfall' ? frame.event : frame.type)) }
    await mkdir('.artifacts/interaction-revision-browser', { recursive: true })
    await writeFile('.artifacts/interaction-revision-browser/observation.json', JSON.stringify(observation, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/interaction-closed.expected.json', import.meta.url), 'utf8'))
    expect(observation).toEqual(expected)
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await second.screenshot({ path: '.artifacts/interaction-revision-browser/settled.png', fullPage: true })
  } finally {
    releaseLosingReply.resolve(undefined)
    abort.abort()
    await Promise.allSettled(approvals)
    await second?.unrouteAll({ behavior: 'wait' })
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

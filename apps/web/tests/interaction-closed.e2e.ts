/** Competing approval answers through the real Web composition and two browser Clients. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type { RemoteInteractionRecord } from '@deepseek-ai/dsh-api-gateway/protocol'
import { launchWebScaffold } from './scaffold.ts'

it('suspends rejected interaction protocol replies until explicit reconnect and a fresh answer', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await page.clock.install()
    let negotiations = 0
    let replies = 0
    let corruptProtocol = true
    let rejectedCode: string | undefined
    const pending: RemoteInteractionRecord[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/host/negotiate') negotiations++
    })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: { interaction?: RemoteInteractionRecord } }
        if (frame.type === 'item' && frame.value?.interaction?.status === 'pending') pending.push(frame.value.interaction)
      })
    })
    await page.route('**/api/$events/result', async (route) => {
      replies++
      if (!corruptProtocol) { await route.continue(); return }
      const request = route.request().postDataJSON() as { payload: { apiProtocolVersion: number } }
      expect(request.payload.apiProtocolVersion).toBe(2)
      request.payload.apiProtocolVersion = 3
      const response = await route.fetch({ postData: JSON.stringify(request) })
      const envelope = await response.json() as ServerResponse
      expect(envelope.result).toMatchObject({ ok: false, error: { code: 'gateway/protocol-unsupported' } })
      rejectedCode = envelope.result.ok ? 'unexpected-success' : envelope.result.error.code
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    const initialNegotiations = negotiations
    agent.session.append('turn/start', { turn: 1 })
    approval = scaffold.ctx.approval.request({ agent, toolName: 'fixture_action', reason: 'Check the reply protocol', signal: abort.signal })
    const panel = page.locator('[data-approval-key]')
    await panel.waitFor()
    await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
    const blocked = page.getByText('Update required', { exact: true }).filter({ visible: true })
    await blocked.waitFor()
    await page.clock.fastForward(60_000)
    expect(negotiations).toBe(initialNegotiations)
    expect(replies).toBe(1)
    expect(decisions).toEqual([])
    const output = '.artifacts/interaction-reply-errors-browser'
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/incompatible.png`, fullPage: true })
    corruptProtocol = false
    await page.getByRole('button', { name: 'Host and Client are incompatible. Update the application, then reconnect', exact: true }).click()
    await panel.waitFor()
    await expect.poll(() => pending.length).toBe(2)
    expect(pending[1]).toEqual(pending[0])
    expect(replies).toBe(1)
    await panel.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(approval).resolves.toBe('rejected')
    const observation = { rejectedCode, automaticReconnects: 0, manualReconnects: negotiations - initialNegotiations,
      replies, decisions, samePendingInteraction: true, browserClockAdvanceMs: 60_000 }
    const expected = JSON.parse(await readFile(new URL('./expected/interaction-reply-errors.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(`${output}/observation.json`, JSON.stringify(observation, null, 2) + '\n')
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
  } finally {
    abort.abort()
    await approval?.catch(() => undefined)
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('settles one approval and keeps the losing Client connected after interaction-closed', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
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
    const second = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const records: RemoteInteractionRecord[][] = [[], []]
    for (const [index, page] of [first, second].entries()) {
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          const frame = JSON.parse(payload.toString()) as {
            type?: string
            value?: { eventId?: string; interaction?: RemoteInteractionRecord }
          }
          if (frame.type !== 'item' || frame.value?.interaction === undefined) return
          expect(frame.value.interaction.requestId).toBe(frame.value.eventId)
          records[index]!.push(frame.value.interaction)
        })
      })
    }
    const rejectedReplies: string[] = []
    let revisionProbed = false
    let firstNegotiations = 0
    first.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/host/negotiate')) firstNegotiations++
    })
    await first.route('**/api/$events/result', async (route) => {
      if (revisionProbed) { await route.continue(); return }
      revisionProbed = true
      const original = route.request().postDataJSON() as {
        payload: { apiProtocolVersion?: number; args: { interactionRevision?: number } }
      }
      expect(original.payload.apiProtocolVersion).toBe(2)
      expect(original.payload.args.interactionRevision).toBe(1)
      let conflictResponse: Awaited<ReturnType<typeof route.fetch>> | undefined
      for (const invalid of ['wrong', 'missing', 'downgraded']) {
        const request = structuredClone(original)
        if (invalid === 'wrong') request.payload.args.interactionRevision = 2
        else delete request.payload.args.interactionRevision
        if (invalid === 'downgraded') delete request.payload.apiProtocolVersion
        const response = await route.fetch({ postData: JSON.stringify(request) })
        if (invalid === 'wrong') conflictResponse = response
        const result = (await response.json() as ServerResponse).result
        rejectedReplies.push(result.ok ? 'unexpected-success' : result.error.code)
        expect(decisions).toEqual([])
      }
      if (conflictResponse === undefined) throw new Error('revision conflict response missing')
      await route.fulfill({ response: conflictResponse })
    })
    let secondNegotiations = 0
    second.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/host/negotiate')) secondNegotiations++
    })
    let holdCancellation = true
    const heldCancellations: (() => void)[] = []
    await second.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; value?: { type?: string } }
        if (holdCancellation && frame.type === 'item' && frame.value?.type === 'cancel') {
          heldCancellations.push(() => { socket.send(message) })
        } else socket.send(message)
      })
    })
    const losingReplyReady = Promise.withResolvers<undefined>()
    const losingResponse = Promise.withResolvers<ServerResponse['result']>()
    let intercepted = false
    await second.route('**/api/$events/result', async (route) => {
      if (intercepted) { await route.continue(); return }
      intercepted = true
      losingReplyReady.resolve(undefined)
      await releaseLosingReply.promise
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      losingResponse.resolve(envelope.result)
      await route.fulfill({ response })
    })
    for (const page of [first, second]) {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    }
    const baselineNegotiations = secondNegotiations
    const baselineFirstNegotiations = firstNegotiations
    agent.session.append('turn/start', { turn: 1 })
    const result = scaffold.ctx.approval.request({ agent, toolName: 'fixture_action', reason: 'Approve the shared test action' })
    const firstPanel = first.locator('[data-approval-key]')
    const secondPanel = second.locator('[data-approval-key]')
    await firstPanel.waitFor()
    await secondPanel.waitFor()
    await expect.poll(() => records.map(items => items.length)).toEqual([1, 1])
    expect(records[0]).toEqual(records[1])
    expect(records[0]![0]).toEqual({
      requestId: expect.any(String) as unknown, sessionId, type: 'approval', requiredPermission: 'approval.respond',
      createdAt: expect.any(Number) as unknown, status: 'pending', revision: 1,
    })
    await secondPanel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await losingReplyReady.promise
    await firstPanel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect.poll(() => records[0]!.length).toBe(2)
    expect(records[0]![1]).toEqual(records[0]![0])
    expect(decisions).toEqual([])
    await firstPanel.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(result).resolves.toBe('allowed-once')
    releaseLosingReply.resolve(undefined)
    const response = await losingResponse.promise
    expect(response).toMatchObject({ ok: false, error: { code: 'interaction-closed' } })
    holdCancellation = false
    for (const send of heldCancellations) send()
    await expect.poll(() => records[1]!.length).toBe(2)
    expect(records[1]![1]).toEqual({ ...records[0]![0], status: 'resolved', revision: 2 })
    await expect.poll(() => secondPanel.count()).toBe(0)
    expect(decisions).toEqual(['allowed-once'])

    // A later request proves the losing result did not invalidate the shared Connection.
    const next = scaffold.ctx.approval.request({ agent, toolName: 'fixture_action', reason: 'Reject the second test action' })
    await secondPanel.waitFor()
    await secondPanel.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(next).resolves.toBe('rejected')
    await expect.poll(() => firstPanel.count()).toBe(0)
    expect(secondNegotiations).toBe(baselineNegotiations)
    await expect.poll(() => records.map(items => items.length)).toEqual([4, 3])
    expect(records[0]![2]).toEqual(records[1]![2])
    expect(records[0]![3]).toEqual({ ...records[1]![2], status: 'resolved', revision: 2 })
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/interaction-closed.expected.json', import.meta.url), 'utf8')) as unknown
    expect({ rejectedReplies, outcomes: decisions, losingResult: response.ok ? 'unexpected-success' : response.error.code,
      reconnects: secondNegotiations - baselineNegotiations,
      revisionReconnects: firstNegotiations - baselineFirstNegotiations,
      interactions: records.map(items => items.map(({ type, status, revision, requiredPermission }) => (
        { type, status, revision, requiredPermission }
      ))) }).toEqual(expected)
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await mkdir('.artifacts/interaction-revision-browser', { recursive: true })
    await second.screenshot({ path: '.artifacts/interaction-revision-browser/settled.png', fullPage: true })
  } finally {
    releaseLosingReply.resolve(undefined)
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

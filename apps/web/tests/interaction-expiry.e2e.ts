/** Host-owned Approval and Question deadlines through the shipped Web Loader. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type { RemoteInteractionRecord } from '@deepseek-ai/dsh-api-gateway/protocol'
import { launchWebScaffold } from './scaffold.ts'

it('expires approvals and questions at their original Host deadline and refuses a late grant', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./interaction-expiry.overlay.yml', import.meta.url)),
  })
  let browser: Browser | undefined
  const failures: unknown[] = []
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('expiry fixture has no Agent')
    const decisions: string[] = []
    scaffold.ctx.on('session/event', (session, event) => {
      if (session.id === sessionId && event.type === 'approval/decided') decisions.push(event.data.outcome)
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const first = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const second = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const records: RemoteInteractionRecord[][] = [[], []]
    const clientIds: (string | undefined)[] = []
    const sockets: WebSocketRoute[] = []
    await second.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    for (const [index, page] of [first, second].entries()) {
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          const frame = JSON.parse(payload.toString()) as {
            type?: string
            value?: { clientId?: string; interaction?: RemoteInteractionRecord }
          }
          if (frame.type !== 'item') return
          if (frame.value?.clientId !== undefined) clientIds[index] = frame.value.clientId
          if (frame.value?.interaction !== undefined) records[index]!.push(frame.value.interaction)
        })
      })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    }
    agent.session.append('turn/start', { turn: 1 })
    const approval = scaffold.ctx.approval.request({ agent, toolName: 'expiry_fixture', reason: 'This approval will expire' })
    await first.locator('[data-approval-key]').waitFor()
    await second.locator('[data-approval-key]').waitFor()
    await expect.poll(() => records.map(values => values.length)).toEqual([1, 1])
    const opening = records[0]![0]!
    expect(records[1]![0]).toEqual(opening)
    expect(opening.expiresAt! - opening.createdAt).toBe(10_000)
    const originalClientId = clientIds[1]
    await sockets[0]!.close()
    await expect.poll(() => records[1]!.length, { timeout: 8_000 }).toBe(2)
    expect(clientIds[1]).not.toBe(originalClientId)
    expect(records[1]![1]).toEqual(opening)
    const approvalOutcome = await approval
    expect(approvalOutcome).toBe('unavailable')
    await expect.poll(() => records.map(values => values.length)).toEqual([2, 3])
    expect(records[0]![1]).toEqual({ ...opening, status: 'expired', revision: 2 })
    for (const page of [first, second]) await expect.poll(() => page.locator('[data-approval-key]').count()).toBe(0)
    const late = await scaffold.hostFetch('/api/$events/result', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'expiry-late', method: '$events/result', payload: {
        apiProtocolVersion: 2, args: { clientId: clientIds[0], eventId: opening.requestId, interactionRevision: opening.revision,
          outcome: { kind: 'result', value: 'allowed-once' } },
      } }),
    })
    const lateResult = (await late.json() as ServerResponse).result
    expect(lateResult).toMatchObject({ ok: false, error: { code: 'interaction-closed' } })
    const question = scaffold.ctx.userQuestions.ask({ agent, questions: [{ id: 'expires', question: 'This question will expire' }] })
      .then(() => 'unexpected-answer', (error: unknown) => remoteErrorOf(error)?.code ?? 'unexpected-error')
    await first.locator('[data-question-key]').waitFor()
    await second.locator('[data-question-key]').waitFor()
    const questionError = await question
    expect(questionError).toBe('interaction-expired')
    await expect.poll(() => records.map(values => values.length)).toEqual([4, 5])
    for (const page of [first, second]) await expect.poll(() => page.locator('[data-question-key]').count()).toBe(0)
    const actual = {
      approvalOutcome, decisions, questionError, lateResult: lateResult.ok ? 'unexpected-success' : lateResult.error.code,
      deadlinePreserved: records[1]![1]?.expiresAt === opening.expiresAt,
      interactions: records.map(values => values.map(({ type, status, revision, createdAt, expiresAt }) => (
        { type, status, revision, lifetimeMs: expiresAt! - createdAt }
      ))),
    }
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/interaction-expiry.expected.json', import.meta.url), 'utf8')) as unknown
    expect(actual).toEqual(expected)
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await mkdir('.artifacts/interaction-expiry-browser', { recursive: true })
    await first.screenshot({ path: '.artifacts/interaction-expiry-browser/settled.png', fullPage: true })
  } catch (error) {
    failures.push(error)
  } finally {
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Interaction expiry verification failed')
}, 120_000)

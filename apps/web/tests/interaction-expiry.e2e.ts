/** Caller cancellation and timed Question waits through the shipped Web Loader. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type {
  RemoteEventDownlinkFrame, RemoteEventInvocationFrame, RemoteEventCancellationFrame,
  RemoteEventReadyFrame, RemoteEventResult,
} from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { launchWebScaffold } from './scaffold.ts'

it('preserves pending requests and timed Question deadlines across reconnects and ignores a late grant', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const failures: unknown[] = []
  const approvalAbort = new AbortController()
  const replacementAbort = new AbortController()
  const questionAbort = new AbortController()
  const waiting: Promise<unknown>[] = []
  const claims: { remainingMs: number; deadline: number }[] = []
  const attachWait = scaffold.ctx.userQuestions.attachWait.bind(scaffold.ctx.userQuestions)
  const observeClaims = vi.spyOn(scaffold.ctx.userQuestions, 'attachWait').mockImplementation(async function* (agent, callId, signal) {
    for await (const frame of attachWait(agent, callId, signal)) {
      claims.push({ remainingMs: frame.remainingMs, deadline: Date.now() + frame.remainingMs })
      yield frame
    }
  })
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('expiry fixture has no Agent')
    const decisions: string[] = []
    const effects: string[] = []
    scaffold.ctx.on('session/event', (session, event) => {
      if (session.id !== sessionId) return
      if (event.type === 'approval/decided') decisions.push(event.data.outcome)
      if (event.type === 'tool/result' || event.type === 'user/message') effects.push(event.type)
    })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const first = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const second = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const generations: RemoteEventReadyFrame[][] = [[], []]
    const records: (RemoteEventInvocationFrame | RemoteEventCancellationFrame)[][] = [[], []]
    const replies: RemoteEventResult[] = []
    let disconnect: (() => Promise<void>) | undefined
    await second.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      disconnect = async () => { await server.close(); await socket.close() }
    })
    for (const [index, page] of [first, second].entries()) {
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
          if (frame.type !== 'item') return
          if (frame.value?.type === 'ready') generations[index]!.push(frame.value)
          if (frame.value?.type === 'waterfall' || frame.value?.type === 'cancel') records[index]!.push(frame.value)
        })
      })
      page.on('request', (request) => {
        if (new URL(request.url()).pathname !== '/api/$events/result') return
        const body = request.postDataJSON() as { payload: { args: RemoteEventResult } }
        replies.push(body.payload.args)
      })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    }
    await expect.poll(() => generations.map(values => values.length)).toEqual([1, 1])
    agent.session.append('turn/start', { turn: 1 })
    const approval = scaffold.ctx.approval.request({
      agent, toolName: 'expiry_fixture', reason: 'Caller-owned approval lifetime', signal: approvalAbort.signal,
    })
    waiting.push(approval)
    const firstApproval = first.locator('[data-approval-key]')
    const secondApproval = second.locator('[data-approval-key]')
    await firstApproval.waitFor()
    await secondApproval.waitFor()
    await expect.poll(() => records.map(values => values.length)).toEqual([1, 1])
    const opening = records[0]![0]!
    expect(opening).toMatchObject({ type: 'waterfall', event: 'approval/request', agentId: sessionId })
    expect(records[1]![0]).toEqual(opening)
    const originalClientId = generations[1]![0]!.clientId
    await disconnect!()
    await expect.poll(() => generations[1]!.length, { timeout: 10_000 }).toBe(2)
    await expect.poll(() => records[1]!.length).toBe(2)
    expect(generations[1]![1]!.clientId).not.toBe(originalClientId)
    expect(records[1]![1]).toEqual(opening)
    expect(decisions).toEqual([])
    approvalAbort.abort()
    const approvalOutcome = await approval
    expect(approvalOutcome).toBe('cancelled')
    await expect.poll(() => records.map(values => values.length)).toEqual([2, 3])
    expect(records[0]![1]).toEqual({ type: 'cancel', eventId: opening.eventId })
    for (const page of [first, second]) await expect.poll(() => page.locator('[data-approval-key]').count()).toBe(0)

    const replacement = scaffold.ctx.approval.request({
      agent, toolName: 'expiry_fixture', reason: 'Reject this separate approval', signal: replacementAbort.signal,
    })
    waiting.push(replacement)
    await firstApproval.waitFor()
    await secondApproval.waitFor()
    const late = await first.request.post(new URL('/api/$events/result', first.url()).href, { data: {
      type: 'client-request', rpcId: 'expiry-late', method: '$events/result', payload: { args: {
        clientId: generations[0]![0]!.clientId, eventId: opening.eventId,
        outcome: { kind: 'result', value: 'allowed-once' },
      } },
    } })
    const lateResult = (await late.json() as ServerResponse).result
    expect(lateResult).toEqual({ ok: true })
    expect(decisions).toEqual(['cancelled'])
    expect(await firstApproval.count()).toBe(1)
    expect(effects).toEqual([])
    await firstApproval.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(replacement).resolves.toBe('rejected')
    for (const page of [first, second]) await expect.poll(() => page.locator('[data-approval-key]').count()).toBe(0)

    const callId = brandString<ToolCallId>('expiry-timed-question')
    let questionSettlements = 0
    const question = scaffold.ctx.userQuestions.askTimed({
      agent, signal: questionAbort.signal, questions: [{
        id: 'expires', question: 'Let this timed question continue', options: [{ label: 'Answer before continuing' }],
      }],
    }, callId, 10_000).then((result) => { questionSettlements++; return result })
    waiting.push(question)
    await first.locator('[data-question-key]').waitFor()
    await second.locator('[data-question-key]').waitFor()
    await expect.poll(() => claims.length).toBe(2)
    await first.getByText(/^Continuing in [1-8]s$/).waitFor()
    const questionOpening = records[0]!.findLast(record => record.type === 'waterfall')!
    expect(questionOpening).toMatchObject({ type: 'waterfall', event: 'user-questions/request', agentId: sessionId })
    await disconnect!()
    await expect.poll(() => generations[1]!.length, { timeout: 10_000 }).toBe(3)
    await expect.poll(() => claims.length).toBe(3)
    const questionReplay = records[1]!.findLast(record => record.type === 'waterfall')!
    expect(questionReplay).toEqual(questionOpening)
    expect(claims[2]!.remainingMs).toBeLessThan(claims[0]!.remainingMs)
    expect(Math.abs(claims[2]!.deadline - claims[0]!.deadline)).toBeLessThan(100)
    expect(questionSettlements).toBe(0)
    const questionResult = await question
    expect(questionResult).toEqual({ pending: true, callId })
    expect(questionAbort.signal.aborted).toBe(false)
    await expect.poll(() => records.some(values => values.some(record =>
      record.type === 'cancel' && record.eventId === questionOpening.eventId))).toBe(true)
    const timeoutReplies = replies.filter(reply => reply.eventId === questionOpening.eventId)
    expect(timeoutReplies.length).toBeGreaterThan(0)
    expect(timeoutReplies.every(reply => reply.outcome.kind === 'rejected' && reply.outcome.error.code === 'ASK_TIMED_OUT')).toBe(true)
    expect(questionSettlements).toBe(1)
    expect(decisions).toEqual(['cancelled', 'rejected'])
    expect(effects).toEqual([])
    expect(generations.map(values => values.length)).toEqual([1, 3])
    const actual = {
      approvalOutcome, decisions, lateResult, questionResult, questionSettlements,
      deadlinePreserved: true, approvalReplayed: true, questionReplayed: true,
      callerAborted: questionAbort.signal.aborted, effects,
    }
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/interaction-expiry.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    const output = '.artifacts/interaction-expiry-browser'
    await mkdir(output, { recursive: true })
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    await first.screenshot({ path: `${output}/settled.png`, fullPage: true })
  } catch (error) {
    failures.push(error)
  } finally {
    approvalAbort.abort()
    replacementAbort.abort()
    questionAbort.abort()
    await Promise.allSettled(waiting)
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    observeClaims.mockRestore()
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Interaction expiry verification failed')
}, 120_000)

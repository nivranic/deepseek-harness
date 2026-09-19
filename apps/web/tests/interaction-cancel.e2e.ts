/** Cancelling an Agent turn while a browser answer or its retry is awaiting HTTP delivery. */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import type { RemoteInteractionRecord } from '@deepseek-ai/dsh-api-gateway/protocol'
import { connectFreshWorkspace, REPO_ROOT } from './support.ts'

interface HostMessage {
  kind: string
  url?: string
  sessionId?: string
}

it.each([
  { interaction: 'approval', order: 'cancel-before-retry' },
  { interaction: 'approval', order: 'retry-before-cancel' },
  { interaction: 'question', order: 'cancel-before-retry' },
  { interaction: 'question', order: 'retry-before-cancel' },
  { interaction: 'approval', order: 'authentication-before-cancel' },
  { interaction: 'question', order: 'authentication-before-cancel' },
] as const)('cancels $interaction with $order without admitting the old answer', async ({ interaction, order }) => {
  const authenticationLoss = order === 'authentication-before-cancel'
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-restart-'))
  const home = join(root, 'home')
  const patch = join(root, 'scenario.patch.yml')
  const evidenceDir = `.artifacts/interaction-cancel-browser/${interaction}-${order}`
  await mkdir(evidenceDir, { recursive: true })
  const mock = await startMockLlmServer({
    sequence: ['tool_call_success', 'tool_call_success', 'success'], toolName: 'restart_fixture', toolArguments: '{}',
    successText: 'Explicit continuation completed',
  })
  const fixture = new URL('./host-restart.fixture.ts', import.meta.url).href
  await writeFile(patch, JSON.stringify([
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true } },
    { id: 'llm-deepseek', config: { baseURL: mock.baseURL, apiKeyEnv: 'DSH_RESTART_TEST_KEY' } },
    { id: 'agent-instructions', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'open-in-app', disabled: true },
    { id: 'ui-open-in-app', disabled: true },
    { id: 'skill-filesystem', config: {
      dshHome: join(root, 'skills'), agentsHome: join(root, 'agents'), bundledSkillDir: join(root, 'bundled'), watch: false,
    } },
    { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'restart-picker', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-restart-picker', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
      { id: 'restart-fixture', name: fixture, config: { interaction } },
    ] },
  ]))
  let browser: Browser | undefined
  let child: ChildProcess | undefined
  let exited: Promise<void> | undefined
  let messages: HostMessage[] = []
  const failures: unknown[] = []
  let stderr = ''
  function start(): void {
    messages = []
    child = spawn(process.execPath, [
      '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href,
      join(REPO_ROOT, 'apps/cli/src/bin.ts'), '--profile', 'web', '--patch', patch,
    ], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      env: { ...process.env, DSH_HOME: home, DSH_RESTART_TEST_KEY: 'test-only', DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: mock.baseURL,
        DSH_AGENTS_HOME: join(root, 'agents'), DSH_BUNDLED_SKILL_DIR: join(root, 'bundled'),
        NODE_OPTIONS: '', TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json') },
    })
    child.on('message', (message: HostMessage) => { messages.push(message) })
    child.stdout?.on('data', (data: Buffer) => { stderr += data.toString().replace(/token=[^\s"']+/g, 'token=REDACTED') })
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString().replace(/token=[^\s"']+/g, 'token=REDACTED') })
    exited = new Promise<void>((resolve, reject) => {
      child!.once('error', reject)
      child!.once('exit', () => { resolve() })
    })
  }
  async function ready(): Promise<string> {
    await expect.poll(() => messages.some(message => message.kind === 'ready'), { timeout: 60_000 }).toBe(true)
    return messages.find(message => message.kind === 'ready')!.url!
  }
  async function readEvents(sessionId: string) {
    const reader = new Context()
    try {
      await reader.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
      const handle = await reader.sessionPersistence.open(SessionId(sessionId), 'read')
      try {
        return (await handle.read()).events
      } finally {
        await handle.close()
      }
    } finally {
      await reader.fiber.dispose()
    }
  }
  const releaseAnswer = Promise.withResolvers<undefined>()
  try {
    start()
    const authenticatedUrl = await ready()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    const page = await context.newPage()
    const replies: { clientId: string; eventId: string; interactionRevision: number; outcome: unknown }[] = []
    const generations: { clientId: string; pendingInteractionIds: string[] }[] = []
    const records: RemoteInteractionRecord[] = []
    const otherRecords: RemoteInteractionRecord[] = []
    const authenticationRejections: { path: string; status: number }[] = []
    const heldAnswer = Promise.withResolvers<undefined>()
    let disconnect: (() => Promise<void>) | undefined
    page.on('pageerror', error => failures.push(error))
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (path.startsWith('/api/') && response.status() === 401) authenticationRejections.push({ path, status: 401 })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      disconnect = async () => { await server.close(); await socket.close() }
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as {
          type?: string
          value?: { type?: string; clientId: string; pendingInteractionIds: string[]; interaction?: RemoteInteractionRecord }
        }
        if (frame.type === 'item' && frame.value?.type === 'ready') generations.push(frame.value)
        if (frame.type === 'item' && frame.value?.interaction !== undefined) records.push(frame.value.interaction)
        socket.send(message)
      })
    })
    await page.route('**/api/$events/result', async (route) => {
      const request = route.request().postDataJSON() as { payload: { args: typeof replies[number] } }
      replies.push(request.payload.args)
      if (request.payload.args.eventId !== replies[0]!.eventId) { await route.continue(); return }
      if (authenticationLoss) {
        await context.clearCookies()
        const response = await page.request.post(route.request().url(), {
          data: route.request().postDataBuffer()!, headers: { 'content-type': 'application/json' },
        })
        expect(response.status()).toBe(401)
        await route.fulfill({ response })
        heldAnswer.resolve(undefined)
        return
      }
      if (order === 'retry-before-cancel' && replies.length === 1) {
        await route.abort('connectionfailed')
        return
      }
      heldAnswer.resolve(undefined)
      await releaseAnswer.promise
      await route.abort('connectionfailed')
    })
    await page.goto(authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, root)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill(`Ask for ${interaction} once`)
    await input.press('Enter')
    await expect.poll(() => messages.filter(message => message.kind === 'tool-entered').length, { timeout: 30_000 }).toBe(1)
    const sessionId = messages.find(message => message.kind === 'tool-entered')!.sessionId!
    child!.send({ kind: 'request-interaction' })
    const selector = interaction === 'approval' ? '[data-approval-key]' : '[data-question-key]'
    const panel = page.locator(selector)
    await panel.waitFor({ timeout: 30_000 })
    const otherContext = authenticationLoss
      ? await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' }) : context
    const other = await otherContext.newPage()
    other.on('pageerror', error => failures.push(error))
    other.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: { interaction?: RemoteInteractionRecord } }
        if (frame.type === 'item' && frame.value?.interaction !== undefined) otherRecords.push(frame.value.interaction)
      })
    })
    await other.goto(authenticationLoss ? authenticatedUrl : page.url(), { waitUntil: 'load' })
    await other.getByRole('treeitem').filter({ hasText: `Ask for ${interaction} once` }).first().click()
    await other.locator(selector).waitFor({ timeout: 30_000 })
    if (interaction === 'approval') await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
    else {
      await panel.getByRole('radio', { name: 'Stale answer', exact: true }).click()
      await panel.getByRole('button', { name: 'Submit', exact: true }).click()
    }
    await heldAnswer.promise
    const authenticationControl = page.getByRole('button', {
      name: 'Open this Host using its current launch link to authenticate, then reconnect', exact: true,
    })
    if (authenticationLoss) {
      await authenticationControl.waitFor({ timeout: 30_000 })
      await page.waitForTimeout(1_100)
      expect(authenticationRejections).toEqual([{ path: '/api/$events/result', status: 401 }])
      await page.screenshot({ path: `${evidenceDir}/authentication.png`, fullPage: true })
    }
    const oldReply = replies[0]!
    const oldReplyCount = order === 'retry-before-cancel' ? 2 : 1
    expect(replies).toHaveLength(oldReplyCount)
    expect(generations).toHaveLength(oldReplyCount)
    expect(oldReply.outcome).toEqual({ kind: 'result', value: interaction === 'approval' ? 'allowed-once'
      : { answers: [{ id: 'restart', selected: ['Stale answer'] }] } })
    const beforeCancel = await readEvents(sessionId)
    const turnStartSeq = beforeCancel.findIndex(event => event.type === 'turn/start')
    expect(turnStartSeq).toBeGreaterThanOrEqual(0)
    expect(beforeCancel.filter(event => event.type === 'tool/result')).toEqual([])
    const cancelBody = { type: 'client-request', rpcId: 'cancel-held-answer', method: 'session/cancelTurn', payload: {
      apiProtocolVersion: 2, args: { request: { sessionId, turnStartSeq } },
    } }
    const cancel = async () => {
      const response = await other.request.post(new URL('/api/session/cancelTurn', other.url()).href, { data: cancelBody })
      expect(await response.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
    }
    await cancel()
    await expect.poll(() => messages.filter(message => message.kind === 'turn/end').length, { timeout: 30_000 }).toBe(1)
    await expect.poll(() => (authenticationLoss ? otherRecords : records)
      .some(record => record.requestId === oldReply.eventId && record.status === 'cancelled')).toBe(true)
    await expect.poll(() => other.locator(selector).count()).toBe(0)
    releaseAnswer.resolve(undefined)
    if (authenticationLoss) {
      await authenticationControl.waitFor()
      expect(replies).toHaveLength(1)
      const login = await context.newPage()
      await login.goto(authenticatedUrl, { waitUntil: 'load' })
      expect(new URL(login.url()).searchParams.has('token')).toBe(false)
      await authenticationControl.click()
      await expect.poll(() => generations.length, { timeout: 30_000 }).toBe(2)
      await login.close()
    } else await disconnect!()
    await expect.poll(() => generations.length, { timeout: 30_000 }).toBe(oldReplyCount + 1)
    expect(generations.at(-1)!.pendingInteractionIds).toEqual([])
    expect(replies).toHaveLength(oldReplyCount)
    const stale = async (id: string) => {
      const response = await page.request.post(new URL('/api/$events/result', page.url()).href, { data: {
        type: 'client-request', rpcId: id, method: '$events/result', payload: {
          apiProtocolVersion: 2, args: { ...oldReply, clientId: generations.at(-1)!.clientId },
        },
      } })
      expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'interaction-closed' } } })
    }
    await stale('late-answer-after-cancel')
    expect(mock.requests).toHaveLength(1)
    expect(existsSync(join(home, 'side-effect'))).toBe(false)
    await expect.poll(async () => (await readEvents(sessionId)).filter(event => event.type === 'turn/end').length).toBe(1)
    const cancelled = await readEvents(sessionId)
    const cancellationCode = interaction === 'approval' ? 'ABORTED' : 'ASK_ABORTED'
    expect(cancelled.filter(event => event.type === 'tool/result')).toMatchObject([{ data: { error: { code: cancellationCode } } }])
    expect(cancelled.filter(event => event.type === 'approval/decided')).toMatchObject(interaction === 'approval'
      ? [{ data: { outcome: 'cancelled' } }] : [])
    expect(cancelled.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'aborted' } } }])
    await page.screenshot({ path: `${evidenceDir}/cancelled.png`, fullPage: true })
    await input.fill('Ask me again after cancellation')
    await input.press('Enter')
    await expect.poll(() => messages.filter(message => message.kind === 'tool-entered').length, { timeout: 30_000 }).toBe(2)
    child!.send({ kind: 'request-interaction' })
    await panel.waitFor({ timeout: 30_000 })
    expect(records.at(-1)!.requestId).not.toBe(oldReply.eventId)
    await stale('late-answer-during-new-request')
    await cancel()
    expect(await panel.count()).toBe(1)
    expect(messages.filter(message => message.kind === 'turn/end')).toHaveLength(1)
    if (interaction === 'approval') await panel.getByRole('button', { name: 'Reject', exact: true }).click()
    else {
      await panel.getByRole('radio', { name: 'Fresh answer', exact: true }).click()
      await panel.getByRole('button', { name: 'Submit', exact: true }).click()
    }
    await expect.poll(() => messages.filter(message => message.kind === 'turn/end').length, { timeout: 30_000 }).toBe(2)
    await page.getByText('Explicit continuation completed', { exact: true }).waitFor()
    expect(mock.requests).toHaveLength(3)
    expect(replies).toHaveLength(oldReplyCount + 1)
    expect(existsSync(join(home, 'side-effect'))).toBe(false)
    await expect.poll(async () => (await readEvents(sessionId)).filter(event => event.type === 'turn/end').length).toBe(2)
    const durable = await readEvents(sessionId)
    expect(durable.filter(event => event.type === 'tool/call')).toHaveLength(2)
    const results = durable.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(results[1]!.data.error).toBeUndefined()
    expect(JSON.stringify(results[1])).toContain(interaction === 'approval' ? 'Marker was not written' : 'Fresh answer')
    expect(JSON.stringify(results)).not.toContain('Stale answer')
    expect(durable.filter(event => event.type === 'turn/end')).toMatchObject([
      { data: { turn: 1, reason: { kind: 'aborted' } } }, { data: { turn: 2, reason: { kind: 'completed' } } },
    ])
    await page.screenshot({ path: `${evidenceDir}/continued.png`, fullPage: true })
    await writeFile(`${evidenceDir}/events.json`, JSON.stringify(durable, null, 2) + '\n')
    await writeFile(`${evidenceDir}/observation.json`, JSON.stringify({
      interaction, order, oldAnswerSubmissions: 1, oldAnswerRequests: oldReplyCount, generations: generations.length,
      authenticationLoss, authenticationRejections, cancellationFromIndependentContext: authenticationLoss,
      staleAnswersRejected: 2, staleCancellationPreservedNewTurn: true, toolCalls: 2, toolResults: 2,
      modelRequests: mock.requests.length, sideEffects: 0, turnReasons: ['aborted', 'completed'],
      newAnswer: interaction === 'approval' ? 'rejected' : 'Fresh answer', cancellationCode,
    }, null, 2) + '\n')
  } catch (error) {
    failures.push(error)
    await writeFile(`${evidenceDir}/child.log`, stderr)
    await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `${evidenceDir}/failed.png`, fullPage: true })
  } finally {
    releaseAnswer.resolve(undefined)
    child?.kill('SIGKILL')
    await exited?.catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await mock.close().catch((error: unknown) => { failures.push(error) })
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Interaction cancellation verification failed')
}, 180_000)

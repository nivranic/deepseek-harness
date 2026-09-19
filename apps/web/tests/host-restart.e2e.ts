/** Abrupt Host process death and cookie-authenticated Web recovery through dsh profiles. */
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
import { connectFreshWorkspace, probeFreePort, REPO_ROOT } from './support.ts'

interface HostMessage {
  kind: string
  url?: string
  sessionId?: string
}

it.each(['approval', 'question'] as const)('recovers %s across Host restart and accepts a new answer', async (interaction) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-restart-'))
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'restart')
  await mkdir(profile, { recursive: true })
  const port = await probeFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const mock = await startMockLlmServer({
    sequence: ['tool_call_success', 'tool_call_success', 'success'], toolName: 'restart_fixture', toolArguments: '{}',
    successText: 'Explicit continuation completed',
  })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-restart', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const fixture = new URL('./host-restart.fixture.ts', import.meta.url).href
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
    { id: 'webserver', config: { host: '127.0.0.1', port } },
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
      join(REPO_ROOT, 'apps/cli/src/bin.ts'), '--profile', 'restart',
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
  try {
    start()
    const authenticatedUrl = await ready()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    let clientId: string | undefined
    let pending: RemoteInteractionRecord | undefined
    const snapshots: { sessionId: string; events: { type: string; data: unknown }[] }[] = []
    page.on('pageerror', (error) => { failures.push(error) })
    page.on('console', (message) => {
      if (message.text().includes('received more than one start Match')) failures.push(new Error(message.text()))
    })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as {
          type?: string
          value?: {
            clientId?: string
            interaction?: RemoteInteractionRecord
            type?: string
            header?: { id: string }
            records?: { event: { type: string; data: unknown } }[]
          }
        }
        if (frame.type !== 'item') return
        if (frame.value?.clientId !== undefined) clientId = frame.value.clientId
        if (frame.value?.interaction?.status === 'pending') pending = frame.value.interaction
        if (frame.value?.type === 'snapshot' && frame.value.header !== undefined && frame.value.records !== undefined) {
          snapshots.push({ sessionId: frame.value.header.id, events: frame.value.records.map(record => record.event) })
        }
      })
    })
    await page.goto(authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, root)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill(`Ask for ${interaction} once`)
    await input.press('Enter')
    await expect.poll(() => messages.some(message => message.kind === 'tool-entered'), { timeout: 30_000 }).toBe(true)
    await input.fill('Unsent draft survives Host restart')
    child!.send({ kind: 'request-interaction' })
    const panel = page.locator(interaction === 'approval' ? '[data-approval-key]' : '[data-question-key]')
    await panel.waitFor({ timeout: 30_000 })
    if (interaction === 'approval') {
      await expect.poll(() => messages.some(message => message.kind === 'approval/asked'), { timeout: 30_000 }).toBe(true)
    }
    expect(pending).toBeDefined()
    expect(pending!.type).toBe(interaction)
    expect(mock.requests).toHaveLength(1)
    expect(existsSync(join(home, 'side-effect'))).toBe(false)
    const sessionId = messages.find(message => message.kind === 'tool-entered')!.sessionId!
    const originalPending = pending!
    const originalClientId = clientId
    const snapshotCount = snapshots.length
    expect(child!.kill('SIGKILL')).toBe(true)
    await exited
    expect(messages.some(message => message.kind === 'disposed')).toBe(false)
    expect(messages.some(message => message.kind === 'turn/end')).toBe(false)
    const interruptedEvents = await readEvents(sessionId)
    expect(interruptedEvents.filter(event => event.type === 'approval/asked')).toHaveLength(interaction === 'approval' ? 1 : 0)
    expect(interruptedEvents.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(interruptedEvents.filter(event => ['tool/result', 'turn/end', 'approval/decided'].includes(event.type))).toHaveLength(0)
    start()
    await ready()
    // Keep the page and its original cookie; no second launch-token exchange.
    await expect.poll(() => clientId !== originalClientId, { timeout: 30_000 }).toBe(true)
    const recoveredClientId = clientId
    await expect.poll(() => panel.count()).toBe(0)
    expect(await input.innerText()).toBe('Unsent draft survives Host restart')
    expect((await page.request.get(baseUrl)).status()).toBe(200)
    async function rejectOldAnswer(rpcId: string): Promise<void> {
      const late = await page.request.post(`${baseUrl}/api/$events/result`, { data: {
        type: 'client-request', rpcId, method: '$events/result', payload: {
          apiProtocolVersion: 2, args: { clientId, eventId: originalPending.requestId, interactionRevision: originalPending.revision,
            outcome: { kind: 'result', value: interaction === 'approval' ? 'allowed-once'
              : { answers: [{ id: 'restart', selected: ['Stale answer'] }] } } },
        },
      } })
      expect(await late.json()).toMatchObject({ result: { ok: false, error: { code: 'interaction-closed' } } })
    }
    await rejectOldAnswer('restart-stale-before-new-request')
    await expect.poll(() => snapshots.length > snapshotCount, { timeout: 30_000 }).toBe(true)
    expect(snapshots.at(-1)!.sessionId).toBe(sessionId)
    const historyEvents = snapshots.at(-1)!.events
    expect(historyEvents.find(event => event.type === 'tool/result')).toMatchObject({
      data: { error: { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' } },
    })
    expect(historyEvents.find(event => event.type === 'turn/end')).toMatchObject({
      data: { turn: 1, reason: { kind: 'interrupted' } },
    })
    expect(mock.requests).toHaveLength(1)
    expect(existsSync(join(home, 'side-effect'))).toBe(false)
    const evidenceDir = `.artifacts/tool-replay-restart-browser/${interaction}`
    await mkdir(evidenceDir, { recursive: true })
    await page.screenshot({ path: `${evidenceDir}/recovered.png`, fullPage: true })
    await input.fill('Ask me again after restart')
    await input.press('Enter')
    await expect.poll(() => messages.some(message => message.kind === 'tool-entered'), { timeout: 30_000 }).toBe(true)
    child!.send({ kind: 'request-interaction' })
    await panel.waitFor({ timeout: 30_000 })
    expect(pending!.requestId).not.toBe(originalPending.requestId)
    expect(pending!.type).toBe(interaction)
    await rejectOldAnswer('restart-stale-during-new-request')
    expect(await panel.count()).toBe(1)
    if (interaction === 'approval') {
      await panel.getByRole('button', { name: 'Reject', exact: true }).click()
    } else {
      await panel.getByRole('radio', { name: 'Fresh answer', exact: true }).click()
      await panel.getByRole('button', { name: 'Submit', exact: true }).click()
    }
    await expect.poll(() => messages.some(message => message.kind === 'turn/end'), { timeout: 30_000 }).toBe(true)
    await page.getByText('Explicit continuation completed', { exact: true }).waitFor()
    expect(mock.requests).toHaveLength(3)
    expect(clientId).toBe(recoveredClientId)
    expect(JSON.stringify(mock.requests[1]!.body)).toContain('Do not retry blindly')
    const answeredText = interaction === 'approval' ? 'Marker was not written' : 'Fresh answer'
    expect(JSON.stringify(mock.requests[2]!.body)).toContain(answeredText)
    expect(existsSync(join(home, 'side-effect'))).toBe(false)
    const durableEvents = await readEvents(sessionId)
    expect(durableEvents.filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog')).toEqual([])
    expect(durableEvents.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(2)
    expect(durableEvents.filter(event => event.type === 'tool/call')).toHaveLength(2)
    expect(durableEvents.filter(event => event.type === 'tool/result')).toMatchObject([
      { data: { error: { code: 'TOOL_OUTCOME_UNKNOWN' } } },
      { type: 'tool/result' },
    ])
    expect(JSON.stringify(durableEvents.filter(event => event.type === 'tool/result').at(-1))).toContain(answeredText)
    expect(JSON.stringify(durableEvents.filter(event => event.type === 'tool/result').at(-1))).not.toContain('Stale answer')
    expect(durableEvents.filter(event => event.type === 'tool/result').at(-1)?.data.error).toBeUndefined()
    expect(durableEvents.filter(event => event.type === 'approval/decided')).toMatchObject(
      interaction === 'approval' ? [{ data: { outcome: 'rejected' } }] : [],
    )
    expect(durableEvents.filter(event => event.type === 'turn/end')).toMatchObject([
      { data: { turn: 1, reason: { kind: 'interrupted' } } },
      { data: { turn: 2, reason: { kind: 'completed' } } },
    ])
    await expect.poll(() => page.getByText(/The tool call was interrupted after it was recorded/).count()).toBe(1)
    await page.screenshot({ path: `${evidenceDir}/answered.png`, fullPage: true })
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    const toolRows = page.locator('tr[data-kind="tool"]')
    await expect.poll(() => toolRows.count()).toBe(2)
    expect(await toolRows.nth(0).getAttribute('data-error')).toBe('true')
    expect(await toolRows.nth(1).getAttribute('data-error')).toBeNull()
    expect(await toolRows.nth(0).textContent()).toContain('TOOL_OUTCOME_UNKNOWN')
    expect(await toolRows.nth(1).textContent()).toContain(answeredText)
    const rowKeys = await toolRows.evaluateAll(rows => rows.map(row => row.getAttribute('data-trajectory-row-key')))
    expect(new Set(rowKeys).size).toBe(2)
    await page.screenshot({ path: `${evidenceDir}/trajectory.png`, fullPage: true })
    for (const occurrence of [1, 0]) {
      await page.getByRole('tab', { name: 'Chat', exact: true }).click()
      const processToggle = page.locator('[data-turn-process][aria-expanded="false"]')
      if (await processToggle.count() > 0) await processToggle.first().click()
      const tool = page.locator('[data-chat-flow-kind="tool-call"]').nth(occurrence)
      const collapsed = tool.locator('[aria-expanded="false"]')
      if (await collapsed.count() > 0) await collapsed.first().click()
      await tool.getByRole('button', { name: 'Inspect', exact: true }).click()
      const details = page.getByRole('complementary', { name: 'Event details' })
      await expect.poll(() => details.textContent()).toContain(`Turn ${occurrence + 1} · Step 1`)
      await details.getByRole('tab', { name: 'Result', exact: true }).click()
      if (interaction === 'question' && occurrence === 1) {
        for (let level = 0; level < 3; level++) {
          await details.locator('[data-json-expander][aria-expanded="false"]').first().click()
        }
      }
      await expect.poll(() => details.textContent()).toContain(occurrence === 0 ? 'TOOL_OUTCOME_UNKNOWN' : answeredText)
      await details.getByRole('tab', { name: 'Schema', exact: true }).click()
      await expect.poll(() => details.textContent()).toContain('Request human input for the restart regression.')
      await page.screenshot({ path: `${evidenceDir}/inspect-${occurrence + 1}.png`, fullPage: true })
    }
    await writeFile(`${evidenceDir}/observation.json`, JSON.stringify({
      interaction, newInteractionAnswered: true, sameRecoveredConnection: true, staleAnswersRejected: 2,
      interruptedToolStillVisibleAfterNextTurn: true, trajectoryToolOccurrencesDistinct: true,
      inspectOccurrencesVerified: 2, inspectSchemaVerified: true,
      sessionId, processRestart: true, originalCookieAccepted: true, pendingCardRemoved: true,
      draftRetained: true, lateAnswer: 'interaction-closed', modelRequests: mock.requests.length, sideEffects: 0,
    }, null, 2) + '\n')
  } catch (error) {
    failures.push(error)
    console.error('Host restart progress', JSON.stringify({
      messages: messages.map(({ kind, sessionId }) => ({ kind, sessionId })),
      requests: mock.requests.map(({ behavior, chunksSent, outcome }) => ({ behavior, chunksSent, outcome })),
    }))
    await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `.artifacts/question-restart-failed-${Date.now()}.png`, fullPage: true })
    await writeFile(`.artifacts/question-restart-child-${Date.now()}.log`, stderr, { flag: 'wx' })
  } finally {
    child?.kill('SIGKILL')
    await exited?.catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await mock.close().catch((error: unknown) => { failures.push(error) })
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Host restart verification failed')
}, 180_000)

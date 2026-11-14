/** Recorded Question answers across HTTP loss and competing Clients through the shipped Web profile. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stringifyEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { captureWorkspaceSnapshot, normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import { fixtureUserPrompts, isolatedStandardPresetPatch, normalizeWebSessionVolatiles, selectedSessionFixture } from './scaffold.ts'
import { connectFreshWorkspace, REPO_ROOT, writeComposerDraft } from './support.ts'

const scenario = fileURLToPath(new URL('../../../snapshots/web/question-composer', import.meta.url))

interface HostMessage {
  kind: string
  url?: string
  turn?: number
  sessionId?: string
  error?: string
}

it.skipIf(process.env.DSH_SNAPSHOT === 'record').each([
  'before-host', 'after-host', 'competing', 'reload-before-host', 'reload-after-host',
] as const)
('recovers a recorded Question through dsh web: %s', async (loss) => {
  const reload = loss.startsWith('reload-')
  const beforeHost = loss.endsWith('before-host')
  const competing = loss === 'competing'
  const artifacts = `.artifacts/question-retry-${loss}`
  const fixture = await selectedSessionFixture(join(scenario, 'session.jsonl'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-question-retry-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const patch = join(root, 'scenario.patch.yml')
  await writeFile(patch, stringifyEntryYaml([
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true } },
    { id: 'llm-deepseek', disabled: true },
    { id: 'llm-deepseek-account', disabled: true },
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    isolatedStandardPresetPatch(root, true),
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'session-log-deepseek', config: { enabled: false } },
    { id: 'open-in-app', disabled: true },
    { id: 'ui-open-in-app', disabled: true },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'replay-picker', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-replay-picker', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
      { id: 'tool-replay-fixture', name: new URL('./tool-reused-id.fixture.ts', import.meta.url).href,
        config: { file: fixture, browserApproval: true, finalTurn: 1 } },
    ] },
  ]))
  const launch = resolveExampleLaunch({
    srcBin: join(REPO_ROOT, 'apps/cli/src/bin.ts'),
    sourceImport: 'tsx/esm', tsconfigPath: join(REPO_ROOT, 'tsconfig.json'),
    configArgs: ['--profile', 'web', '--patch', patch],
    env: { DSH_HOME: home, DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: '',
      DSH_AGENTS_HOME: join(root, 'agents'), DSH_BUNDLED_SKILL_DIR: join(root, 'bundled'),
      NODE_OPTIONS: '' },
  })
  const child = spawn(launch.command, launch.args, {
    cwd: workspace, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    env: { ...process.env, ...launch.env },
  })
  const messages: HostMessage[] = []
  const failures: unknown[] = []
  let output = ''
  let browser: Browser | undefined
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => { resolve() })
  })
  child.on('message', (message: HostMessage) => { messages.push(message) })
  const collect = (data: Buffer) => { output += data.toString().replace(/token=[^\s"']+/g, 'token=REDACTED') }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  const releaseLosingReply = Promise.withResolvers<undefined>()
  const reloadReplyReady = Promise.withResolvers<undefined>()
  try {
    await expect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Web Host exited before readiness: ${output}`)
      const failure = messages.find(message => message.kind === 'failure')
      if (failure !== undefined) throw new Error(failure.error)
      return messages.some(message => message.kind === 'ready')
    }, { timeout: 60_000 }).toBe(true)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    const page = await context.newPage()
    const readyFrames: { clientId: string }[] = []
    const deliveries: { clientId: string; eventId: string }[] = []
    const replies: { clientId: string; eventId: string; outcome: unknown }[] = []
    const secondReplies: unknown[] = []
    const losingReplyReady = Promise.withResolvers<undefined>()
    let firstEnvelope: { payload: { args: typeof replies[number] }; [key: string]: unknown } | undefined
    let firstClientSubmissions = 0
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as {
          type?: string
          value?: { type?: string; clientId: string; eventId: string }
        }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames.push(frame.value)
        if (frame.type === 'item' && frame.value?.type === 'waterfall') {
          deliveries.push({ clientId: readyFrames.at(-1)!.clientId, eventId: frame.value.eventId })
        }
        if (competing && frame.type === 'item' && frame.value?.type === 'cancel') return
        socket.send(message)
      })
    })
    await page.route('**/api/$events/result', async (route) => {
      const request = route.request().postDataJSON() as NonNullable<typeof firstEnvelope>
      replies.push(request.payload.args)
      if (replies.length !== 1) { await route.continue(); return }
      firstEnvelope = request
      if (!beforeHost && !competing) {
        const accepted = await route.fetch()
        expect(await accepted.json()).toMatchObject({ result: { ok: true } })
      }
      if (reload) {
        reloadReplyReady.resolve(undefined)
        await releaseLosingReply.promise
        return
      }
      if (competing) {
        losingReplyReady.resolve(undefined)
        await releaseLosingReply.promise
      }
      await route.abort('connectionfailed')
    })
    page.on('pageerror', (error) => { failures.push(error) })
    await page.goto(messages.find(message => message.kind === 'ready')!.url!, { waitUntil: 'load' })
    await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(1)
    await connectFreshWorkspace(page, workspace)
    const expected = await readFile(fixture, 'utf8')
    const prompts = fixtureUserPrompts(expected)
    expect(prompts).toHaveLength(1)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await writeComposerDraft(page, input, prompts[0]!)
    await input.press('Enter')

    async function answer(target: Page, losing: boolean): Promise<void> {
      const panel = target.locator('[data-question-key]')
      await panel.waitFor({ timeout: 30_000 })
      const selected = panel.getByRole('checkbox', { name: losing ? 'Green' : 'Blue' })
      if (await selected.getAttribute('aria-checked') !== 'true') await selected.click()
      await panel.getByRole('textbox').fill(losing ? 'Discard this losing answer' : 'Include accessibility notes')
      await panel.getByRole('textbox').press('Enter')
      if (target === page) firstClientSubmissions++
    }

    let other: Page | undefined
    if (competing) {
      other = await context.newPage()
      other.on('pageerror', (error) => { failures.push(error) })
      other.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/api/$events/result')) secondReplies.push(request.postDataJSON())
      })
      await other.goto(page.url(), { waitUntil: 'load' })
      await other.locator('[role="treeitem"]').filter({ hasText: 'Use the ask_user_question tool to' }).first().click()
      await other.locator('[data-question-key]').waitFor({ timeout: 30_000 })
    }
    await answer(page, competing)
    if (reload) {
      await reloadReplyReady.promise
      expect(new URL(page.url()).searchParams.has('token')).toBe(false)
      const reloaded = await page.reload({ waitUntil: 'load' })
      expect(reloaded?.status()).toBe(200)
      releaseLosingReply.resolve(undefined)
    }
    if (beforeHost) {
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(2)
      await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })
      expect(replies).toHaveLength(1)
      expect(messages.some(message => message.kind === 'turn/end')).toBe(false)
      await page.screenshot({ path: artifacts + '-pending.png', fullPage: true })
      await answer(page, false)
    }
    if (other !== undefined) {
      await losingReplyReady.promise
      await answer(other, false)
    }
    await expect.poll(() => {
      const failed = messages.find(message => message.kind === 'failure')
      if (failed !== undefined) throw new Error(failed.error)
      return messages.some(message => message.kind === 'turn/end' && message.turn === 1)
    }, { timeout: 30_000 }).toBe(true)
    releaseLosingReply.resolve(undefined)
    await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(2)
    expect(replies).toHaveLength(beforeHost ? 2 : 1)
    expect(firstClientSubmissions).toBe(beforeHost ? 2 : 1)
    expect(replies[0]!.outcome).toEqual({ kind: 'result', value: { answers: [{
      id: 'color', selected: [competing ? 'Green' : 'Blue'],
      custom: competing ? 'Discard this losing answer' : 'Include accessibility notes',
    }] } })
    expect(secondReplies).toHaveLength(competing ? 1 : 0)
    expect(deliveries).toEqual((beforeHost ? [0, 1] : [0]).map(index => ({
      clientId: readyFrames[index]!.clientId, eventId: replies[0]!.eventId,
    })))
    if (beforeHost) {
      expect(replies[1]).toEqual({ ...replies[0], clientId: readyFrames[1]!.clientId })
      expect(replies[1]!.clientId).not.toBe(replies[0]!.clientId)
    }
    await expect.poll(() => page.locator('[data-question-key]').count()).toBe(0)
    if (competing) {
      if (firstEnvelope === undefined) throw new Error('missing intercepted reply envelope')
      const late = await page.request.post(new URL('/api/$events/result', page.url()).href, { data: {
        ...firstEnvelope, rpcId: 'late-losing-answer',
        payload: { ...firstEnvelope.payload, args: { ...replies[0], clientId: readyFrames[1]!.clientId } },
      } })
      expect(await late.json()).toMatchObject({ result: { ok: true } })
    }
    const sessionId = messages.findLast(message => message.kind === 'turn/end')!.sessionId!
    const reader = new Context()
    let actual = ''
    let sessionWorkspace: string | undefined
    try {
      await reader.plugin(JsonlSessionPersistence, { root: join(home, 'sessions') })
      const handle = await reader.sessionPersistence.open(SessionId(sessionId), 'read')
      try {
        sessionWorkspace = handle.header.cwd
        const { events } = await handle.read()
        const calls = events.filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call')
        expect(calls).toHaveLength(1)
        expect(calls[0]!.data.name).toBe('ask_user_question')
        const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        expect(results[0]!.data.error).toBeUndefined()
        expect(JSON.stringify(results[0])).toContain('Include accessibility notes')
        expect(JSON.stringify(results[0])).not.toContain('Discard this losing answer')
        actual = [JSON.stringify({ type: 'session', ...handle.header }), ...events.map(event => JSON.stringify(event))].join('\n') + '\n'
      } finally {
        await handle.close()
      }
    } finally {
      await reader.fiber.dispose()
    }
    if (sessionWorkspace === undefined) throw new Error('replayed Session has no workspace')
    expect(sessionWorkspace).toBe(join(workspace, 'workspace'))
    const normalizedActual = normalizeSessionSnapshots(
      [normalizeWebSessionVolatiles(actual)], { sessionIds: [sessionId], cwd: sessionWorkspace },
    )[0]
    const normalizedExpected = normalizeSessionSnapshots([normalizeWebSessionVolatiles(expected)], { sessionIds: ['{{session:1}}'], cwd: '{{cwd}}' })[0]
    await writeFile(`${artifacts}-actual.jsonl`, normalizedActual ?? '')
    await writeFile(`${artifacts}-expected.jsonl`, normalizedExpected ?? '')
    expect(normalizedActual).toBe(normalizedExpected)
    expect(await captureWorkspaceSnapshot(sessionWorkspace)).toEqual([])
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    const processToggle = page.locator('[data-turn-process="1"][aria-expanded="false"]')
    if (await processToggle.count() > 0) await processToggle.click()
    const group = page.locator('[data-chat-flow-kind="tool-call"]').first()
      .locator('xpath=ancestor::*[@data-chat-group-key][1]')
    const groupToggle = group.locator('button[data-process-activity][aria-expanded="false"]')
    if (await groupToggle.count() > 0) await groupToggle.click()
    await page.getByRole('button', { name: 'Ask question 1/1 answered', exact: true }).click()
    await page.getByText('Include accessibility notes', { exact: true }).waitFor()
    expect(await page.getByText('Discard this losing answer', { exact: true }).count()).toBe(0)
    await page.screenshot({ path: artifacts + '-answered.png', fullPage: true })
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    const rows = page.locator('tr[data-kind="tool"]')
    await expect.poll(() => rows.count()).toBe(1)
    expect(await rows.first().getAttribute('data-error')).toBeNull()
    await page.screenshot({ path: artifacts + '-trajectory.png', fullPage: true })
    await writeFile(artifacts + '-observation.json', JSON.stringify({
      profile: 'web', keyless: true, fullSessionCompared: true, workspaceCompared: true, replayConsumed: true,
      normalizedRecords: normalizedActual?.trimEnd().split('\n').length,
      answerLoss: loss, answerRequests: replies.length, secondClientAnswerRequests: secondReplies.length,
      readyGenerations: readyFrames.length, firstClientSubmissions, toolCalls: 1, toolResults: 1,
      pageReloaded: reload, cookieAuthenticatedReload: reload,
      winningAnswer: { selected: ['Blue'], custom: 'Include accessibility notes' },
      losingAnswerIgnored: competing,
    }, null, 2) + '\n')
  } catch (error) {
    failures.push(error)
    console.error('Recorded replay progress', messages.map(({ kind, turn, error }) => ({ kind, turn, error })))
    await writeFile(artifacts + '-child.log', output)
    await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: artifacts + '-failure.png', fullPage: true })
  } finally {
    releaseLosingReply.resolve(undefined)
    child.kill('SIGKILL')
    await exited.catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Recorded Question retry verification failed')
}, 180_000)

/** Recorded same-id Tool executions through the shipped dsh Web profile. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot, normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import { fixtureUserPrompts, normalizeWebSessionVolatiles, selectedSessionFixture } from './scaffold.ts'
import { connectFreshWorkspace, REPO_ROOT, writeComposerDraft } from './support.ts'

const scenario = fileURLToPath(new URL('../../../snapshots/web/tool-reused-id', import.meta.url))

interface HostMessage {
  kind: string
  url?: string
  turn?: number
  sessionId?: string
  error?: string
}

it.skipIf(process.env.DSH_SNAPSHOT === 'record').each([
  'none', 'before-host', 'after-host', 'reload-before-host', 'reload-after-host',
] as const)
('replays same-id writes through dsh web with complete stored Session comparison: %s', async (loss) => {
  const reload = loss.startsWith('reload-')
  const beforeHost = loss.endsWith('before-host')
  const artifacts = loss === 'none' ? '.artifacts/tool-replay' : `.artifacts/interaction-retry-${loss}`
  const fixture = await selectedSessionFixture(join(scenario, 'session.jsonl'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-replay-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const patch = join(root, 'scenario.patch.yml')
  await writeFile(patch, JSON.stringify([
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true } },
    { id: 'llm-deepseek', disabled: true },
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    { id: 'agent-instructions', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'open-in-app', disabled: true },
    { id: 'ui-open-in-app', disabled: true },
    { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false } },
    { id: 'skill-filesystem', config: {
      dshHome: join(root, 'skills'), agentsHome: join(root, 'agents'), bundledSkillDir: join(root, 'bundled'), watch: false,
    } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'replay-picker', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-replay-picker', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
      { id: 'tool-replay-fixture', name: new URL('./tool-reused-id.fixture.ts', import.meta.url).href,
        config: { file: fixture, browserApproval: loss !== 'none', finalTurn: 4 } },
    ] },
  ]))
  const child = spawn(process.execPath, [
    '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href,
    join(REPO_ROOT, 'apps/cli/src/bin.ts'), '--profile', 'web', '--patch', patch,
  ], {
    cwd: workspace, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: '',
      DSH_AGENTS_HOME: join(root, 'agents'), DSH_BUNDLED_SKILL_DIR: join(root, 'bundled'),
      NODE_OPTIONS: '', TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json') },
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
  const reloadReplyReady = Promise.withResolvers<undefined>()
  const releaseReply = Promise.withResolvers<undefined>()
  try {
    await expect.poll(() => messages.some(message => message.kind === 'ready'), { timeout: 60_000 }).toBe(true)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    const replies: { clientId: string; eventId: string; interactionRevision: number; outcome: unknown }[] = []
    const readyFrames: { clientId: string; pendingInteractionIds: string[] }[] = []
    let approvalClicks = 0
    if (loss !== 'none') {
      await page.routeWebSocket('**/api/remote.mux', (socket) => {
        const server = socket.connectToServer()
        server.onMessage((message) => {
          const frame = JSON.parse(message.toString()) as {
            type?: string
            value?: { type?: string; clientId: string; pendingInteractionIds: string[] }
          }
          if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames.push(frame.value)
          socket.send(message)
        })
      })
      await page.route('**/api/$events/result', async (route) => {
        const request = route.request().postDataJSON() as { payload: { args: typeof replies[number] } }
        replies.push(request.payload.args)
        if (replies.length !== 1) { await route.continue(); return }
        if (loss.endsWith('after-host')) {
          const accepted = await route.fetch()
          expect(await accepted.json()).toMatchObject({ result: { ok: true } })
        }
        if (reload) {
          reloadReplyReady.resolve(undefined)
          await releaseReply.promise
          return
        }
        await route.abort('connectionfailed')
      })
    }
    page.on('pageerror', (error) => { failures.push(error) })
    page.on('console', (message) => {
      if (message.text().includes('received more than one start Match')) failures.push(new Error(message.text()))
    })
    await page.goto(messages.find(message => message.kind === 'ready')!.url!, { waitUntil: 'load' })
    await connectFreshWorkspace(page, workspace)
    const expected = await readFile(fixture, 'utf8')
    const prompts = fixtureUserPrompts(expected)
    expect(prompts).toHaveLength(4)
    const presets = ['read-only', 'danger-full-access', 'workspace-write', 'read-only']
    const labels = ['Read Only', 'Full access', 'Workspace Write', 'Read Only']
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    for (const [index, prompt] of prompts.entries()) {
      await writeComposerDraft(page, input, `/permission ${presets[index]}`)
      await input.press('Enter')
      await page.getByRole('button', { name: `Access mode, current: ${labels[index]}` }).waitFor()
      await writeComposerDraft(page, input, prompt)
      await input.press('Enter')
      if (index === 3 && loss !== 'none') {
        const panel = page.locator('[data-approval-key]')
        await panel.waitFor()
        await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
        approvalClicks++
        if (reload) {
          await reloadReplyReady.promise
          expect(new URL(page.url()).searchParams.has('token')).toBe(false)
          const reloaded = await page.reload({ waitUntil: 'load' })
          expect(reloaded?.status()).toBe(200)
          releaseReply.resolve(undefined)
          if (beforeHost) {
            await panel.waitFor({ timeout: 30_000 })
            expect(replies).toHaveLength(1)
            expect(messages.some(message => message.kind === 'turn/end' && message.turn === 4)).toBe(false)
            await page.screenshot({ path: `${artifacts}-pending.png`, fullPage: true })
            await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
            approvalClicks++
          }
        }
      }
      await expect.poll(() => {
        const failed = messages.find(message => message.kind === 'failure')
        if (failed !== undefined) throw new Error(failed.error)
        return messages.some(message => message.kind === 'turn/end' && message.turn === index + 1)
      }, { timeout: 30_000 }).toBe(true)
    }
    if (loss !== 'none') {
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(2)
      expect(replies).toHaveLength(beforeHost ? 2 : 1)
      expect(approvalClicks).toBe(reload && beforeHost ? 2 : 1)
      expect(readyFrames[1]!.pendingInteractionIds).toEqual(beforeHost ? [replies[0]!.eventId] : [])
      if (beforeHost) {
        expect(replies[1]).toEqual({ ...replies[0], clientId: replies[1]!.clientId })
        expect(replies[1]!.clientId).not.toBe(replies[0]!.clientId)
      }
      await expect.poll(() => page.locator('[data-approval-key]').count()).toBe(0)
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
        const calls = events.filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call' && event.data.name === 'write')
        expect(calls).toHaveLength(2)
        expect(calls[0]!.data.callId).toBe(calls[1]!.data.callId)
        expect(calls.map(call => [call.data.turn, call.data.step])).toEqual([[4, 1], [4, 2]])
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
    expect(await captureWorkspaceSnapshot(sessionWorkspace)).toEqual(await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected')))
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    const writes = page.locator('tr[data-kind="tool"]').filter({ hasText: 'write' })
    await expect.poll(() => writes.count()).toBe(2)
    expect(await writes.nth(0).getAttribute('data-error')).toBe('true')
    expect(await writes.nth(1).getAttribute('data-error')).toBeNull()
    expect(await writes.nth(0).textContent()).toContain('SANDBOX')
    expect(await writes.nth(1).textContent()).toContain('Created file')
    await page.screenshot({ path: `${artifacts}-trajectory.png`, fullPage: true })
    for (const step of [2, 1]) {
      await page.getByRole('tab', { name: 'Chat', exact: true }).click()
      const processToggle = page.locator('[data-turn-process="4"][aria-expanded="false"]')
      if (await processToggle.count() > 0) await processToggle.click()
      const tool = page.locator('[data-chat-flow-kind="tool-call"] [data-tool="write"]').nth(step - 1)
      const collapsed = tool.locator('[aria-expanded="false"]')
      if (await collapsed.count() > 0) await collapsed.first().click()
      await tool.getByRole('button', { name: 'Inspect', exact: true }).click()
      const details = page.getByRole('complementary', { name: 'Event details' })
      await expect.poll(() => details.textContent()).toContain(`Turn 4 · Step ${step}`)
      await details.getByRole('tab', { name: 'Result', exact: true }).click()
      await expect.poll(() => details.textContent()).toContain(step === 1 ? 'SANDBOX' : 'Created file')
      await page.screenshot({ path: `${artifacts}-inspect-${step}.png`, fullPage: true })
    }
    await writeFile(`${artifacts}-observation.json`, JSON.stringify({
      profile: 'web', keyless: true, fullSessionCompared: true, workspaceCompared: true,
      replayConsumed: true, reusedCallCoordinates: [[4, 1], [4, 2]], inspectedOccurrences: 2,
      answerLoss: loss, answerRequests: replies.length, readyGenerations: readyFrames.length,
      browserApprovalClicks: approvalClicks, pageReloaded: reload, cookieAuthenticatedReload: reload,
    }, null, 2) + '\n')
  } catch (error) {
    failures.push(error)
    console.error('Recorded replay progress', messages.map(({ kind, turn, error }) => ({ kind, turn, error })))
    await writeFile(`${artifacts}-child.log`, output)
    await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `${artifacts}-failure.png`, fullPage: true })
  } finally {
    releaseReply.resolve(undefined)
    child.kill('SIGKILL')
    await exited.catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Recorded Tool replay verification failed')
}, 180_000)

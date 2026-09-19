/** Recorded Question answers across HTTP loss and competing Clients through the shipped Web profile. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { captureWorkspaceSnapshot, normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import { fixtureUserPrompts, normalizeWebSessionVolatiles, selectedSessionFixture } from './scaffold.ts'
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
  'incompatible-before-host', 'fatal-before-host',
  'authentication-discovery-before-host', 'authentication-prompt-before-host',
  'authentication-answer-before-host',
  'authentication-answer-after-host', 'authentication-answer-competing',
  'host-slow-before-host', 'host-timeout-before-host', 'connection-phases-before-host',
  'authenticating-before-host',
  'host-identity-before-host',
] as const)
('recovers a recorded Question through dsh web: %s', async (loss) => {
  const discoveryFailure = loss.startsWith('incompatible-') ? 'incompatible' : loss.startsWith('fatal-') ? 'fatal' : undefined
  const connectionPhases = loss === 'connection-phases-before-host'
  const authenticating = loss === 'authenticating-before-host'
  const hostIdentity = loss === 'host-identity-before-host'
  const answerAuthentication = loss.startsWith('authentication-answer-')
  const competing = loss === 'competing' || loss === 'authentication-answer-competing'
  const hostReadiness = loss === 'host-slow-before-host' ? 'slow' : loss === 'host-timeout-before-host' ? 'timeout' : undefined
  const reload = loss.startsWith('reload-')
  const beforeHost = loss.endsWith('before-host')
  const artifacts = `.artifacts/question-retry-${loss}`
  const fixture = await selectedSessionFixture(join(scenario, 'session.jsonl'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-question-retry-'))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const patch = join(root, 'scenario.patch.yml')
  await writeFile(patch, JSON.stringify([
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    ...(connectionPhases || authenticating ? [{ id: 'connection', config: { recovery: { generationReadyWarnMs: 15_000, generationReadyTimeoutMs: 30_000 } } }] : []),
    ...(hostReadiness === undefined ? [] : [{ id: 'connection', config: { recovery: {
      generationReadyWarnMs: 1_500, generationReadyTimeoutMs: 8_000,
    } } }]),
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
        config: { file: fixture, browserApproval: true, finalTurn: 1 } },
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
  const releaseLosingReply = Promise.withResolvers<undefined>()
  const reloadReplyReady = Promise.withResolvers<undefined>()
  const rosterReads: Promise<unknown>[] = []
  const authenticationChecks: (() => void)[] = []
  try {
    await expect.poll(() => messages.some(message => message.kind === 'ready'), { timeout: 60_000 }).toBe(true)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    const page = await context.newPage()
    if (connectionPhases) await page.clock.install()
    page.on('response', (response) => {
      if (!/preset.*\/list$/i.test(new URL(response.url()).pathname)) return
      rosterReads.push(response.json().then((body: { result?: {
        ok?: boolean
        error?: { code?: string }
        value?: { presets?: { id: string; trust?: string; name?: string; broken?: string }[] }
      } }) => ({ status: response.status(), ok: body.result?.ok, error: body.result?.error?.code,
        standard: body.result?.value?.presets?.filter(preset => preset.id === 'standard')
          .map(preset => ({ id: preset.id, trust: preset.trust, name: preset.name, broken: preset.broken !== undefined })),
      })).catch(() => ({ status: response.status(), unavailable: true })))
    })
    const discoveryRequests: string[] = []
    if (authenticating) await page.route('**/api/host/describe', async (route) => {
      if (authenticationChecks.length < 2) {
        const release = Promise.withResolvers<undefined>()
        authenticationChecks.push(() => { release.resolve(undefined) })
        await release.promise
      }
      await route.continue()
    })
    let rejectDiscovery = discoveryFailure !== undefined
    let replaceHostIdentity = false
    if (hostIdentity) await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      if (!replaceHostIdentity) { await route.fulfill({ response }); return }
      const envelope = await response.json() as { result: { ok: boolean; value: Record<string, unknown> } }
      expect(envelope.result.ok).toBe(true)
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...envelope.result.value, hostId: '00000000-0000-4000-8000-000000000002',
      } } } })
    })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (rejectDiscovery && path.startsWith('/api/')) discoveryRequests.push(path)
    })
    if (discoveryFailure !== undefined) await page.route('**/api/host/describe', async (route) => {
      const response = await route.fetch()
      if (!rejectDiscovery) { await route.fulfill({ response }); return }
      const envelope = await response.json() as { result: { ok: boolean; value: Record<string, unknown> } }
      expect(envelope.result.ok).toBe(true)
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...envelope.result.value, apiProtocolVersion: discoveryFailure === 'incompatible' ? 999 : 'invalid',
      } } } })
    })
    const replies: { clientId: string; eventId: string; interactionRevision: number; outcome: unknown }[] = []
    let promptRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/session/prompt') promptRequests++
    })
    const authenticationRejections: { path: string; status: number }[] = []
    const sockets: WebSocketRoute[] = []
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (path.startsWith('/api/') && response.status() === 401) authenticationRejections.push({ path, status: 401 })
    })
    const phaseReady: (() => void)[] = []
    let releaseHostReady: (() => void) | undefined
    let handshakeAttempts: number | undefined
    const initialRequests: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (readyFrames.length === 0 && path.startsWith('/api/')) initialRequests.push(path)
    })
    const readyFrames: { clientId: string; pendingInteractionIds: string[] }[] = []
    const losingReplyReady = Promise.withResolvers<undefined>()
    const secondReplies: unknown[] = []
    let firstClientSubmissions = 0
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      sockets.push(socket)
      const server = socket.connectToServer()
      server.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as {
          type?: string
          value?: { type?: string; clientId: string; pendingInteractionIds: string[] }
        }
        if (frame.type === 'item' && frame.value?.type === 'ready') {
          const opening = frame.value
          if (connectionPhases && sockets.length <= 2) {
            phaseReady.push(() => { readyFrames.push(opening); socket.send(message) })
            return
          }
          if (hostReadiness !== undefined && sockets.length === 1 && releaseHostReady === undefined) {
            releaseHostReady = () => { readyFrames.push(opening); socket.send(message) }
            return
          }
          readyFrames.push(opening)
        }
        // Keep the losing HTTP request unresolved until the winning Client completes.
        if (loss === 'competing' && frame.type === 'item' && frame.value?.type === 'cancel') return
        socket.send(message)
      })
    })
    await page.route('**/api/$events/result', async (route) => {
      const request = route.request().postDataJSON() as { payload: { args: typeof replies[number] } }
      replies.push(request.payload.args)
      if (replies.length !== 1) { await route.continue(); return }
      if (hostIdentity) replaceHostIdentity = true
      if (answerAuthentication && !loss.endsWith('after-host')) {
        await context.clearCookies()
        const response = await page.request.post(route.request().url(), {
          data: route.request().postDataBuffer()!, headers: { 'content-type': 'application/json' },
        })
        expect(response.status()).toBe(401)
        await route.fulfill({ response })
        return
      }
      if (loss.endsWith('after-host')) {
        const accepted = await route.fetch()
        expect(await accepted.json()).toMatchObject({ result: { ok: true } })
        if (answerAuthentication) await context.clearCookies()
      }
      if (reload) {
        reloadReplyReady.resolve(undefined)
        await releaseLosingReply.promise
        return
      }
      if (loss === 'competing') {
        losingReplyReady.resolve(undefined)
        await releaseLosingReply.promise
      }
      await route.abort('connectionfailed')
    })
    page.on('pageerror', (error) => { failures.push(error) })
    page.on('console', (message) => {
      if (message.text().includes('received more than one start Match')) failures.push(new Error(message.text()))
    })
    async function recoverAuthentication(): Promise<void> {
      const action = 'Open this Host using its current launch link to authenticate, then reconnect'
      const control = page.getByRole('button', { name: action, exact: true })
      await control.waitFor({ timeout: 30_000 })
      const rejected = authenticationRejections.length
      expect(rejected).toBeGreaterThan(0)
      await page.waitForTimeout(1_100)
      expect(authenticationRejections).toHaveLength(rejected)
      expect(readyFrames).toHaveLength(1)
      if (loss !== 'authentication-answer-after-host') expect(messages.some(message => message.kind === 'turn/end')).toBe(false)
      if (answerAuthentication) expect(replies).toHaveLength(1)
      await page.screenshot({ path: artifacts + '-authentication.png', fullPage: true, animations: 'disabled' })
      if (loss === 'authentication-answer-competing') {
        await answer(other!, false)
        await expect.poll(() => messages.some(message => message.kind === 'turn/end'), { timeout: 30_000 }).toBe(true)
        expect(replies).toHaveLength(1)
        await control.waitFor()
      }
      if (loss === 'authentication-answer-after-host') {
        await expect.poll(() => messages.some(message => message.kind === 'turn/end'), { timeout: 30_000 }).toBe(true)
      }
      const login = await context.newPage()
      await login.goto(messages.find(message => message.kind === 'ready')!.url!, { waitUntil: 'load' })
      expect(new URL(login.url()).searchParams.has('token')).toBe(false)
      await control.click()
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(2)
      if (!answerAuthentication) readyFrames.shift()
      await login.close()
      await page.waitForTimeout(1_100)
      expect(promptRequests).toBe(answerAuthentication || loss === 'authentication-prompt-before-host' ? 1 : 0)
      expect(await page.locator('[data-question-key]').count()).toBe(0)
    }
    await page.goto(messages.find(message => message.kind === 'ready')!.url!, { waitUntil: 'load' })
    if (authenticating) {
      const action = 'Checking authentication with Host, reconnect now'
      const control = page.getByRole('button', { name: action, exact: true })
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect.poll(() => authenticationChecks.length, { timeout: 30_000 }).toBe(attempt + 1)
        await control.waitFor()
        expect(readyFrames).toHaveLength(attempt)
        expect(promptRequests).toBe(0)
        await page.screenshot({ path: `${artifacts}-authenticating-${attempt + 1}.png`, fullPage: true, animations: 'disabled' })
        if (attempt === 0) {
          expect(initialRequests).toEqual(['/api/host/describe'])
          await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
          await expect.poll(async () => (await control.boundingBox())?.width).toBe(36)
          await page.screenshot({ path: artifacts + '-authenticating-rail.png', fullPage: true, animations: 'disabled' })
          await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
        }
        authenticationChecks[attempt]!()
        await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(attempt + 1)
        if (attempt === 0) await sockets.at(-1)!.close()
      }
      readyFrames.shift()
    }
    if (connectionPhases) {
      const initial = page.getByRole('button', { name: 'Connecting to Host, reconnect now', exact: true })
      await initial.waitFor({ timeout: 30_000 })
      await expect.poll(() => phaseReady.length).toBe(1)
      expect(readyFrames).toHaveLength(0)
      expect(promptRequests).toBe(0)
      await page.screenshot({ path: artifacts + '-connecting.png', fullPage: true, animations: 'disabled' })
      phaseReady[0]!()
      await page.getByRole('status', { name: 'Connected', exact: true }).waitFor()
      await page.screenshot({ path: artifacts + '-ready.png', fullPage: true, animations: 'disabled' })
      await context.setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      const offline = page.getByRole('button', { name: 'Offline, reconnect now', exact: true })
      await offline.waitFor()
      await page.clock.fastForward(60_000)
      expect(sockets).toHaveLength(1)
      expect(promptRequests).toBe(0)
      await page.screenshot({ path: artifacts + '-offline.png', fullPage: true, animations: 'disabled' })
      await context.setOffline(false)
      await page.getByRole('button', { name: 'Reconnecting automatically, reconnect now', exact: true }).waitFor()
      await expect.poll(() => phaseReady.length).toBe(2)
      expect(readyFrames).toHaveLength(1)
      await page.screenshot({ path: artifacts + '-reconnecting.png', fullPage: true, animations: 'disabled' })
      phaseReady[1]!()
      await expect.poll(() => readyFrames.length).toBe(2)
      await page.getByRole('status', { name: 'Connected', exact: true }).waitFor()
      readyFrames.shift()
    }
    if (hostReadiness !== undefined) {
      const action = 'Host readiness is delayed. Waiting and retrying automatically; reconnect now'
      const control = page.getByRole('button', { name: action, exact: true })
      await control.waitFor({ timeout: 30_000 })
      expect(readyFrames).toHaveLength(0)
      expect(promptRequests).toBe(0)
      expect(initialRequests.every(path => path === '/api/host/describe' || path === '/api/host/negotiate')).toBe(true)
      expect(releaseHostReady).toBeDefined()
      await page.screenshot({ path: artifacts + '-host-not-ready.png', fullPage: true, animations: 'disabled' })
      if (hostReadiness === 'slow') {
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
        await expect.poll(async () => (await control.boundingBox())?.width).toBe(36)
        await page.screenshot({ path: artifacts + '-host-not-ready-rail.png', fullPage: true, animations: 'disabled' })
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
        releaseHostReady!()
      }
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(1)
      handshakeAttempts = sockets.length
      expect(handshakeAttempts).toBe(hostReadiness === 'slow' ? 1 : 2)
      await expect.poll(() => control.count()).toBe(0)
    }
    if (loss === 'authentication-discovery-before-host') {
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(1)
      await context.clearCookies()
      await sockets.at(-1)!.close()
      await recoverAuthentication()
    }
    if (discoveryFailure !== undefined) {
      const action = discoveryFailure === 'incompatible'
        ? 'Host and Client are incompatible. Update the application, then reconnect'
        : 'Host data is invalid or unavailable. Automatic retries are paused; check Host, then reconnect'
      const control = page.getByRole('button', { name: action, exact: true })
      await control.waitFor({ timeout: 30_000 })
      expect(await control.getAttribute('title')).toBe(action)
      // Exceed the first retry cap to reject a continuously retrying discovery path.
      await page.waitForTimeout(1_100)
      expect(discoveryRequests).toEqual(['/api/host/describe'])
      expect(readyFrames).toEqual([])
      await page.screenshot({ path: artifacts + '-blocked.png', fullPage: true })
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      await expect.poll(async () => (await control.boundingBox())?.width).toBe(36)
      await page.screenshot({ path: artifacts + '-blocked-rail.png', fullPage: true, animations: 'disabled' })
      rejectDiscovery = false
      await control.click()
      await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(1)
    }
    await connectFreshWorkspace(page, workspace)
    const expected = await readFile(fixture, 'utf8')
    const prompts = fixtureUserPrompts(expected)
    expect(prompts).toHaveLength(1)
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    if (loss === 'authentication-prompt-before-host') {
      await page.getByText('Standard mode', { exact: true }).waitFor({ timeout: 15_000 })
      let rejectPrompt = true
      await page.route('**/api/session/prompt', async (route) => {
        if (!rejectPrompt) { await route.continue(); return }
        rejectPrompt = false
        // Forward the intercepted mutation through the same cookie jar after cookie removal, not a fabricated 401.
        await context.clearCookies()
        const response = await page.request.post(route.request().url(), {
          data: route.request().postDataBuffer()!, headers: { 'content-type': 'application/json' },
        })
        expect(response.status()).toBe(401)
        await route.fulfill({ response })
      })
      await writeComposerDraft(page, input, prompts[0]!)
      await input.press('Enter')
      await recoverAuthentication()
      expect(authenticationRejections).toContainEqual({ path: '/api/session/prompt', status: 401 })
    }
    await writeComposerDraft(page, input, prompts[0]!)
    await input.press('Enter')
    async function answer(target: Page, competing: boolean): Promise<void> {
      const panel = target.locator('[data-question-key]')
      await panel.waitFor({ timeout: 30_000 })
      const selected = panel.getByRole('checkbox', { name: competing ? 'Green' : 'Blue' })
      if (await selected.getAttribute('aria-checked') !== 'true') await selected.click()
      await panel.getByRole('textbox').fill(competing ? 'Discard this losing answer' : 'Include accessibility notes')
      await panel.getByRole('textbox').press('Enter')
      if (target === page) firstClientSubmissions++
    }
    let other: Page | undefined
    if (competing) {
      const otherContext = answerAuthentication
        ? await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' }) : context
      other = await otherContext.newPage()
      other.on('pageerror', (error) => { failures.push(error) })
      other.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/api/$events/result')) secondReplies.push(request.postDataJSON())
      })
      await other.goto(answerAuthentication ? messages.find(message => message.kind === 'ready')!.url! : page.url(), { waitUntil: 'load' })
      await other.locator('[role="treeitem"]').filter({ hasText: 'Use the ask_user_question tool to' }).first().click()
      await other.locator('[data-question-key]').waitFor({ timeout: 30_000 })
    }
    await answer(page, competing)
    if (answerAuthentication) {
      await recoverAuthentication()
      expect(authenticationRejections).toContainEqual({
        path: loss === 'authentication-answer-after-host' ? '/api/host/describe' : '/api/$events/result', status: 401,
      })
    }
    if (hostIdentity) {
      await expect.poll(() => readyFrames.length, { timeout: 30_000 }).toBe(2)
      await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })
      expect(replies).toHaveLength(1)
      expect(messages.some(message => message.kind === 'turn/end')).toBe(false)
      await page.screenshot({ path: artifacts + '-pending.png', fullPage: true, animations: 'disabled' })
      await answer(page, false)
    }
    if (reload) {
      await reloadReplyReady.promise
      expect(new URL(page.url()).searchParams.has('token')).toBe(false)
      const reloaded = await page.reload({ waitUntil: 'load' })
      expect(reloaded?.status()).toBe(200)
      releaseLosingReply.resolve(undefined)
      if (beforeHost) {
        await page.locator('[data-question-key]').waitFor({ timeout: 30_000 })
        expect(replies).toHaveLength(1)
        expect(messages.some(message => message.kind === 'turn/end')).toBe(false)
        await page.screenshot({ path: `${artifacts}-pending.png`, fullPage: true })
        await answer(page, false)
      }
    }
    if (other !== undefined && !answerAuthentication) {
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
    expect(firstClientSubmissions).toBe((reload || hostIdentity) && beforeHost ? 2 : 1)
    expect(replies[0]!.outcome).toEqual({ kind: 'result', value: { answers: [{ id: 'color',
      selected: [competing ? 'Green' : 'Blue'],
      custom: competing ? 'Discard this losing answer' : 'Include accessibility notes',
    }] } })
    expect(secondReplies).toHaveLength(competing ? 1 : 0)
    expect(readyFrames[1]!.pendingInteractionIds).toEqual(beforeHost ? [replies[0]!.eventId] : [])
    if (beforeHost) {
      expect(replies[1]).toEqual({ ...replies[0], clientId: replies[1]!.clientId })
      expect(replies[1]!.clientId).not.toBe(replies[0]!.clientId)
    }
    await expect.poll(() => page.locator('[data-question-key]').count()).toBe(0)
    if (other !== undefined) {
      const late = await page.request.post(new URL('/api/$events/result', page.url()).href, { data: {
        type: 'client-request', rpcId: 'late-losing-answer', method: '$events/result', payload: {
          apiProtocolVersion: 2, args: { ...replies[0], clientId: readyFrames[1]!.clientId },
        },
      } })
      expect(await late.json()).toMatchObject({ result: { ok: false, error: { code: 'interaction-closed' } } })
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
    await page.getByText('Standard mode', { exact: true }).waitFor({ timeout: 15_000 })
    await page.locator('[data-turn-process="1"][aria-expanded="false"]').click()
    await page.getByRole('button', { name: 'Ask question 1/1 answered', exact: true }).click()
    await page.getByText('Include accessibility notes', { exact: true }).waitFor()
    expect(await page.getByText('Discard this losing answer', { exact: true }).count()).toBe(0)
    await page.screenshot({ path: `${artifacts}-answered.png`, fullPage: true })
    await page.getByRole('tab', { name: 'Trajectory', exact: true }).click()
    const rows = page.locator('tr[data-kind="tool"]')
    await expect.poll(() => rows.count()).toBe(1)
    expect(await rows.first().getAttribute('data-error')).toBeNull()
    await page.screenshot({ path: `${artifacts}-trajectory.png`, fullPage: true })
    await writeFile(`${artifacts}-observation.json`, JSON.stringify({
      profile: 'web', keyless: true, fullSessionCompared: true, workspaceCompared: true, replayConsumed: true,
      normalizedRecords: normalizedActual?.trimEnd().split('\n').length,
      connectionPhases, authenticating, hostReadiness, handshakeAttempts, initialRequests,
      promptRequests, authenticationRejections, authenticationRecovery: loss.startsWith('authentication-'),
      completedAnswerAuthenticationRecovery: answerAuthentication,
      discoveryFailure, blockedDiscoveryRequests: discoveryRequests,
      answerLoss: loss, answerRequests: replies.length, secondClientAnswerRequests: secondReplies.length,
      readyGenerations: readyFrames.length + Number(loss.startsWith('authentication-') && !answerAuthentication) + Number(connectionPhases || authenticating), firstClientSubmissions, toolCalls: 1, toolResults: 1,
      pageReloaded: reload, cookieAuthenticatedReload: reload,
      winningAnswer: { selected: ['Blue'], custom: 'Include accessibility notes' },
      losingAnswerRejected: competing,
    }, null, 2) + '\n')
  } catch (error) {
    failures.push(error)
    await writeFile(`${artifacts}-roster.json`, JSON.stringify(await Promise.all(rosterReads), null, 2) + '\n')
    console.error('Recorded replay progress', messages.map(({ kind, turn, error }) => ({ kind, turn, error })))
    await writeFile(`${artifacts}-child.log`, output)
    await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `${artifacts}-failure.png`, fullPage: true })
  } finally {
    for (const release of authenticationChecks) release()
    releaseLosingReply.resolve(undefined)
    child.kill('SIGKILL')
    await exited.catch((error: unknown) => { failures.push(error) })
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Recorded Question retry verification failed')
}, 180_000)

/** Projection-backed child discovery, refused continuation, and observed-turn interruption. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentActivation, SubagentInterruptTurnRequest } from '@deepseek-ai/dsh-subagent'
import type { RemoteEventDownlinkFrame } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { launchWebScaffold } from './scaffold.ts'

it('retains a refused child draft across reconnect and interrupts its observed turn once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-subagent-control-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let activation: SubagentActivation | undefined
  let readyFrames = 0
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const ready = join(root, 'ready')
  const output = '.artifacts/subagent-capability-browser'
  try {
    await writeFile(join(root, `session.v${SESSION_FORMAT_VERSION}.jsonl`), JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: 'primary', createdAt: 0, isSeeded: false, delegationDepth: 0 }) + '\n')
    await writeFile(join(root, 'replay.override.json'), JSON.stringify([{ kind: 'hang', readyFile: ready }]))
    scaffold = await launchWebScaffold({ replayFixture: join(root, `session.v${SESSION_FORMAT_VERSION}.jsonl`), replayOverride: join(root, 'replay.override.json') })
    const path = join(scaffold.workspaceCwd, 'Subagent control')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const parent = scaffold.ctx.agents.get(sessionId)
    if (parent === undefined) throw new Error('Subagent fixture has no parent')
    parent.session.append('turn/start', { turn: 1 })
    parent.session.append('step/start', { turn: 1, step: 1 })
    parent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Subagent parent fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    parent.session.append('step/end', { turn: 1, step: 1 })
    parent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Subagent parent' })
    await scaffold.ctx.sessions.flush(parent.session)
    // Caller delivery keeps this controlled child result from prompting the parent.
    activation = await scaffold.ctx.subagents.startActivation({
      provider: 'spawn', delivery: 'caller', label: 'Control worker', signal: new AbortController().signal,
      parent, prompt: [{ type: 'text', text: 'Hold this child turn for the control check.' }],
    })
    const childId = activation.childId
    const child = scaffold.ctx.agents.get(childId)
    if (child === undefined) throw new Error('Subagent fixture has no live child')
    await expect.poll(() => {
      const end = child.session.snapshotEvents().find(event => event.type === 'turn/end')
      if (end !== undefined) throw new Error('Child ended before model replay: ' + JSON.stringify(end))
      return existsSync(ready)
    }, { timeout: 30_000 }).toBe(true)
    const turnStart = child.session.snapshotEvents().find(event => event.type === 'turn/start')
    if (turnStart === undefined) throw new Error('Held child has no open turn')
    const inboxEvents = () => child.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced')
    const inboxBeforePrompt = inboxEvents()
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/subagents/')) calls.push(endpoint)
    })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/subagents/prompt', async (route) => {
      const request = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
        ok: false, error: { code: 'future/subagent-unavailable', message: 'Child prompt unavailable', details: {} },
      } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').filter({ hasText: 'Subagent parent' }).click({ timeout: 30_000 })
    await page.getByText('Subagent parent fixture', { exact: true }).waitFor()
    await expect.poll(() => readyFrames).toBe(1)
    expect(await page.getByRole('navigation', { name: 'Session hierarchy' }).getByText('Subagent parent', { exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: /1 subagent/u }).click()
    await page.getByRole('treeitem', { name: /Control worker/u }).click()
    await page.getByText(/^Hold this child turn for the control check\./u).waitFor()
    expect(calls).toEqual([])
    const input = page.locator('[data-composer-input]')
    const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
    const observations: Array<{ stage: string; editable: boolean; stop: number }> = []
    const observe = async (stage: string) => {
      observations.push({ stage, editable: await input.getAttribute('contenteditable') === 'true', stop: await stop.count() })
    }
    const reconnect = async () => {
      const target = readyFrames + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => readyFrames, { timeout: 10_000 }).toBe(target)
    }
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await stop.waitFor()
    const draft = 'retain this child draft'
    await input.fill(draft)
    await observe('ready')
    await input.press('Enter')
    const notice = page.getByText('Child prompt unavailable (future/subagent-unavailable)', { exact: true })
    await notice.waitFor()
    expect(await input.textContent()).toBe(draft)
    expect(inboxEvents()).toEqual(inboxBeforePrompt)
    expect(child.status).toBe('running')
    await observe('refused')
    await reconnect()
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await stop.waitFor()
    expect(await input.textContent()).toBe(draft)
    expect(calls).toEqual(['/api/subagents/prompt'])
    expect(inboxEvents()).toEqual(inboxBeforePrompt)
    await observe('reconnected')
    const interruptRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/subagents/interruptTurnByParent')
    await stop.click()
    const request = await interruptRequest
    const payload = request.postDataJSON() as { payload: { args: { request: SubagentInterruptTurnRequest } } }
    expect(payload.payload.args.request).toEqual({ parentSessionId: sessionId, childSessionId: childId, mode: 'continuable', turnStartSeq: turnStart.seq })
    await expect.poll(() => child.status, { timeout: 15_000 }).toBe('idle')
    expect(child.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('aborted')
    await reconnect()
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await expect.poll(() => stop.count()).toBe(0)
    expect(await input.textContent()).toBe(draft)
    await observe('idle')
    expect(calls).toEqual(['/api/subagents/prompt', '/api/subagents/interruptTurnByParent'])
    expect(child.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/restored.png`, fullPage: true })
    const actual = { observations, catalogFromProjection: true, retainedDraft: true, refusedPromptHasNoInboxMutation: true,
      promptRequests: 1, interruptRequests: 1, observedTurnAddressed: true, childTurnAborted: true, noAutomaticReplay: true }
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/subagent.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } catch (error: unknown) {
    console.error(error)
    throw error
  } finally {
    const failures: unknown[] = []
    await page?.unrouteAll({ behavior: 'wait' }).catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await activation?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Subagent fixture teardown failed')
  }
}, 120_000)

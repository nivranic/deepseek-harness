/** Real Subagent control with a scripted held model turn and controlled discovery advertisements. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'

it('separates addressed discovery, prompting and interruption across capability withdrawal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-subagent-capability-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  const capabilities = ['subagent.catalog.v1', 'subagent.prompt.v1', 'subagent.interrupt.v1', 'subagent.interrupt-turn.v1']
  let supported: string[] = []
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const ready = join(root, 'ready')
  const output = '.artifacts/subagent-capability-browser'
  try {
    await writeFile(join(root, `session.v${SESSION_FORMAT_VERSION}.jsonl`), JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: 'primary', createdAt: 0, isSeeded: false, delegationDepth: 0 }) + '\n')
    await writeFile(join(root, 'replay.override.json'), JSON.stringify([{ kind: 'hang', readyFile: ready }]))
    scaffold = await launchWebScaffold({ replayFixture: join(root, `session.v${SESSION_FORMAT_VERSION}.jsonl`), replayOverride: join(root, 'replay.override.json') })
    const path = join(scaffold.workspaceCwd, 'Subagent capabilities')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const parent = scaffold.ctx.agents.get(sessionId)
    if (parent === undefined) throw new Error('Subagent fixture has no parent')
    parent.session.append('turn/start', { turn: 1 })
    parent.session.append('step/start', { turn: 1, step: 1 })
    parent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Capability parent fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    parent.session.append('step/end', { turn: 1, step: 1 })
    parent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Capability parent' })
    await scaffold.ctx.sessions.flush(parent.session)
    const started = await scaffold.ctx.subagents.startContinuable({
      provider: 'spawn', label: 'Capability worker', signal: new AbortController().signal,
      request: { parent, prompt: [{ type: 'text', text: 'Hold this child turn for the capability check.' }] },
    })
    const child = scaffold.ctx.agents.get(started.childId)
    if (child === undefined) throw new Error('Subagent fixture has no live child')
    await expect.poll(() => {
      const end = child.session.snapshotEvents().find(event => event.type === 'turn/end')
      if (end !== undefined) throw new Error('Child ended before model replay: ' + JSON.stringify(end))
      return existsSync(ready)
    }, { timeout: 30_000 }).toBe(true)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/subagents/')) calls.push(endpoint)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Subagent discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining(capabilities))
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !capabilities.includes(id) || supported.includes(id)),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const parentRow = page.getByRole('treeitem').filter({ hasText: 'Capability parent' })
    await parentRow.click({ timeout: 30_000 })
    await page.getByText('Capability parent fixture', { exact: true }).waitFor()
    expect(await page.getByRole('navigation', { name: 'Session hierarchy' }).getByText('Capability parent', { exact: true }).count()).toBe(1)
    expect(await page.getByRole('button', { name: /1 subagent/u }).count()).toBe(0)
    expect(calls).toEqual([])
    const reconnect = async (next: string[]) => {
      supported = next
      const target = negotiations + 1
      await expect.poll(() => sockets.length).toBeGreaterThan(0)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    await reconnect(['subagent.catalog.v1'])
    await page.getByRole('button', { name: /1 subagent/u }).click()
    await page.getByRole('treeitem', { name: /Capability worker/u }).click()
    await page.getByText(/^Hold this child turn for the capability check\./u).waitFor()
    const input = page.locator('[data-composer-input]')
    const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
    const send = page.getByRole('button', { name: /^(Send|Queue|Steer) message$/u })
    const observations: Array<{ stage: string; editable: boolean; send: number; stop: number }> = []
    const observe = async (stage: string) => {
      observations.push({ stage, editable: await input.getAttribute('contenteditable') === 'true', send: await send.count(), stop: await stop.count() })
    }
    await expect.poll(() => send.count()).toBe(0)
    expect(await stop.count()).toBe(0)
    await observe('catalog-only')
    await reconnect(capabilities)
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await stop.waitFor()
    await input.fill('retain this child draft')
    await observe('ready')
    await reconnect(['subagent.catalog.v1', 'subagent.interrupt.v1'])
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('false')
    await stop.waitFor()
    expect(await send.count()).toBe(0)
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' })
    expect(child.status).toBe('running')
    await observe('interrupt-only')
    await reconnect(['subagent.interrupt.v1'])
    await stop.waitFor()
    expect(await input.textContent()).toBe('retain this child draft')
    await observe('catalog-withdrawn')
    await stop.click()
    await expect.poll(() => child.status, { timeout: 15_000 }).toBe('idle')
    expect(child.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('aborted')
    await reconnect(capabilities)
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    await expect.poll(() => stop.count()).toBe(0)
    expect(await input.textContent()).toBe('retain this child draft')
    await observe('restored-idle')
    expect(calls.filter(endpoint => endpoint === '/api/subagents/prompt')).toEqual([])
    expect(calls.filter(endpoint => endpoint === '/api/subagents/interruptByParent')).toHaveLength(1)
    expect(child.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    const actual = { observations, initialCatalogHidden: true, retainedDraft: true, promptRequests: 0, interruptRequests: 1,
      childTurnAborted: true, noAutomaticReplay: true, discoveryControlled: true, modelScripted: true }
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/subagent.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } catch (error: unknown) {
    console.error(error)
    throw error
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  }
}, 120_000)

/** File UI negotiation through the shipped Client and isolated real Host. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold } from './scaffold.ts'

it('admits native file metadata, open and reveal independently through the generated Remote', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const sockets: WebSocketRoute[] = []
  let supported: string[] = []
  let stage = 'absent'
  let negotiations = 0
  const calls: Array<{ stage: string; method: string }> = []
  const output = '.artifacts/native-file-actions-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Native actions')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'native-note.md'), '# Native action fixture\n')
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('native action fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Native action capability fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('deliverables/presented', { turn: 1, callId: ToolCallId('native-fixture'), files: [{ path: 'native-note.md' }] })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Native action session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const baseline = JSON.stringify(agent.session.snapshotEvents())
    const retired: Array<{ method: string; anonymous: number; authenticated: number; directGateway: string }> = []
    for (const method of ['canOpenWorkspacePath', 'openWorkspacePath', 'workspaceDesktop']) {
      // An empty path prevents native effects if a retired entry regresses; an exposed method still fails the 404 assertion.
      const args = method === 'openWorkspacePath' ? { request: { path: '' } } : {}
      const request: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `retired-${method}`, method: `session/${method}`, payload: { args } }),
      }
      const anonymous = (await fetch(new URL(`/api/session/${method}`, scaffold.baseUrl), request)).status
      const authenticated = (await scaffold.hostFetch(`/api/session/${method}`, request)).status
      expect(anonymous).toBe(401)
      expect(authenticated).toBe(404)
      await expect(scaffold.ctx.typertGateway.invoke({ namespace: 'session', method, args }))
        .rejects.toMatchObject({ code: 'gateway/invocation-unavailable' })
      retired.push({ method, anonymous, authenticated, directGateway: 'gateway/invocation-unavailable' })
    }
    await mkdir('.artifacts/session-native-retirement-browser', { recursive: true })
    const retirement = JSON.stringify(retired, null, 2) + '\n'
    await writeFile('.artifacts/session-native-retirement-browser/actual.json', retirement)
    expect(retirement).toBe(await readFile(new URL('./expected/host-capability/session-native-retirement.expected.json', import.meta.url), 'utf8'))
    const invalidRequest: RequestInit = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'invalid-native-action', method: 'presentedFiles/open',
        payload: { args: { request: { sessionId, seq: 3, index: -1 } } } }),
    }
    expect((await fetch(new URL('/api/presentedFiles/open', scaffold.baseUrl), invalidRequest)).status).toBe(401)
    const invalid = await scaffold.hostFetch('/api/presentedFiles/open', invalidRequest)
    expect(await invalid.json()).toMatchObject({ result: { ok: false, error: { code: 'gateway/bad-request' } } })
    const malformed = await scaffold.hostFetch('/api/presentedFiles/open', { ...invalidRequest,
      body: JSON.stringify({ type: 'client-request', rpcId: 'malformed-native-action', method: 'presentedFiles/open', payload: { args: { request: {} } } }),
    })
    expect(await malformed.json()).toMatchObject({ result: { ok: false, error: { code: 'gateway/input-invalid' } } })
    expect((await scaffold.hostFetch('/api/present.host')).status).toBe(404)
    expect((await scaffold.hostFetch('/api/present.open', { method: 'POST' })).status).toBe(404)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/presentedFiles/')) calls.push({ stage, method: endpoint.split('/').at(-1)! })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('native capability discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining([
        'presented-file.desktop.v1', 'presented-file.open.v1', 'presented-file.reveal.v1',
      ]))
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !id.startsWith('presented-file.') || supported.includes(id)),
      } } } })
    })
    await page.route('**/api/presentedFiles/*', (route) => {
      const request = route.request().postDataJSON() as { rpcId: string }
      const metadata = new URL(route.request().url()).pathname.endsWith('/desktop')
      return route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
        ok: true, value: metadata ? { name: 'fixture-desktop', available: true, fileManager: 'finder' } : { completed: true },
      } } })
    })
    const reconnect = async (name: string, methods: string[]) => {
      const next = negotiations + 1
      stage = name
      supported = methods.map(method => `presented-file.${method}.v1`)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(next)
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.waitFor({ timeout: 30_000 })
    const group = page.getByRole('treeitem').filter({ hasText: 'Native actions' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'Native action session' }).click()
    const card = page.locator('[data-presented-file]')
    await card.waitFor()
    await input.fill('retain native draft')
    const menu = card.getByRole('button', { name: 'More file actions for native-note.md' })
    const observations: Array<{ stage: string; menu: number; open: number; reveal: number }> = []
    const observe = async () => {
      observations.push({ stage, menu: await menu.count(),
        open: await page.getByRole('menuitem', { name: 'Open in default app' }).count(),
        reveal: await page.getByRole('menuitem', { name: 'Show in Finder' }).count(),
      })
    }
    expect(await menu.count()).toBe(0)
    expect(calls).toEqual([])
    await observe()
    await reconnect('actions-without-metadata', ['open', 'reveal'])
    expect(await menu.count()).toBe(0)
    await observe()
    expect(calls).toEqual([])
    await reconnect('metadata-only', ['desktop'])
    await expect.poll(() => calls.some(call => call.stage === stage && call.method === 'desktop')).toBe(true)
    expect(await menu.count()).toBe(0)
    await observe()
    await reconnect('open-only', ['desktop', 'open'])
    await menu.click()
    await observe()
    expect(await page.getByRole('menuitem', { name: 'Show in Finder' }).count()).toBe(0)
    await page.getByRole('menuitem', { name: 'Open in default app' }).click()
    await card.getByText('Opened in default app', { exact: true }).waitFor()
    await reconnect('reveal-only', ['desktop', 'reveal'])
    await menu.click()
    await observe()
    expect(await page.getByRole('menuitem', { name: 'Open in default app' }).count()).toBe(0)
    await page.getByRole('menuitem', { name: 'Show in Finder' }).click()
    await card.getByText('Requested display in file manager', { exact: true }).waitFor()
    await menu.click()
    await reconnect('withdrawn', [])
    await expect.poll(() => menu.count()).toBe(0)
    expect(await page.getByRole('menuitem').count()).toBe(0)
    await observe()
    await reconnect('restored', ['desktop', 'open', 'reveal'])
    await menu.click()
    await observe()
    expect(await input.textContent()).toBe('retain native draft')
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(baseline)
    expect(calls.filter(call => ['absent', 'actions-without-metadata', 'withdrawn'].includes(call.stage))).toEqual([])
    expect(calls.filter(call => call.method === 'open').map(call => call.stage)).toEqual(['open-only'])
    expect(calls.filter(call => call.method === 'reveal').map(call => call.stage)).toEqual(['reveal-only'])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
    const actual = JSON.stringify(observations, null, 2) + '\n'
    await writeFile(join(output, 'actual.json'), actual)
    expect(actual).toBe(await readFile(new URL('./expected/host-capability/native-file-actions.expected.json', import.meta.url), 'utf8'))
    await writeFile(join(output, 'observation.json'), JSON.stringify({ status: 'PASS', retainedDraft: true,
      unchangedSession: true, authenticatedGateway: true, invalidCoordinatesRejected: true, retiredRoutesAbsent: true,
      nativeResponsesControlled: true, calls, observations,
    }, null, 2) + '\n')
  } catch (error) {
    await mkdir(output, { recursive: true })
    const page = browser?.contexts()[0]?.pages()[0]
    await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true })
    if (page !== undefined) await writeFile(join(output, 'failure-aria.txt'), await page.locator('body').ariaSnapshot())
    throw error
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 180_000)

it('admits file, session and skill discovery independently without losing retained references', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const sockets: WebSocketRoute[] = []
  const discovery = ['file-reference.list.v1', 'session-reference.candidates.v1', 'skill.catalog.v1']
  let capabilities: string[] = []
  let stage = 'absent'
  let negotiations = 0
  const calls: Array<{ stage: string; endpoint: string }> = []
  const output = '.artifacts/reference-discovery-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Reference discovery')
    const skill = join(path, '.agents', 'skills', 'discovery-review')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), '---\nname: discovery-review\ndescription: Discovery fixture\n---\n# Discovery skill\n')
    await writeFile(join(path, 'discovery-note.md'), '# Discovery note\n')
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('discovery fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Discovery capability fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Discovery source' })
    await scaffold.ctx.sessions.flush(agent.session)
    const baseline = JSON.stringify(agent.session.snapshotEvents())
    const target = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const targetAgent = scaffold.ctx.agents.get(target.sessionId)
    if (targetAgent === undefined) throw new Error('discovery target has no Agent')
    targetAgent.session.append('turn/start', { turn: 1 })
    targetAgent.session.append('step/start', { turn: 1, step: 1 })
    targetAgent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Discovery target fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    targetAgent.session.append('step/end', { turn: 1, step: 1 })
    targetAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId: target.sessionId, title: 'Discovery target' })
    await scaffold.ctx.sessions.flush(targetAgent.session)
    const targetBaseline = JSON.stringify(targetAgent.session.snapshotEvents())
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (/^\/api\/(fileReferences\/list|sessionReferenceResolver\/candidates|skills\/list)$/u.test(endpoint)) {
        calls.push({ stage, endpoint })
      }
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('discovery fixture failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining(discovery))
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !discovery.includes(id) || capabilities.includes(id)),
      } } } })
    })
    const reconnect = async (name: string, supported: string[]) => {
      const next = negotiations + 1
      stage = name
      capabilities = supported
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(next)
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.waitFor({ timeout: 30_000 })
    const group = page.getByRole('treeitem').filter({ hasText: 'Reference discovery' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'Discovery target' }).click()
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    const file = menu.getByRole('option', { name: /discovery-note\.md/u })
    const session = menu.getByRole('option', { name: /Discovery source/u })
    const skillOption = menu.getByRole('option', { name: /discovery-review/u })
    const observations: Array<{ stage: string; files: number; sessions: number; skills: number }> = []
    const observe = async () => {
      observations.push({ stage, files: await file.count(), sessions: await session.count(), skills: await skillOption.count() })
    }
    await input.fill('@discovery')
    await expect.poll(() => menu.count()).toBe(0)
    await observe()
    expect(calls).toEqual([])
    await reconnect('files', ['file-reference.list.v1'])
    await input.fill('@discovery-')
    await file.waitFor()
    await observe()
    expect(await session.count()).toBe(0)
    await file.click()
    const draft = await input.textContent()
    await reconnect('sessions', ['session-reference.candidates.v1'])
    expect(await input.textContent()).toBe(draft)
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    await input.locator('[data-composer-chip]').click()
    await page.locator('[data-sidebar-right-panel]').getByText('Discovery note', { exact: true }).waitFor()
    await input.press('End')
    await input.pressSequentially('@Discovery')
    await session.waitFor()
    await observe()
    expect(await file.count()).toBe(0)
    await reconnect('withdrawn', [])
    await expect.poll(() => menu.count()).toBe(0)
    await observe()
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    await reconnect('skills', ['skill.catalog.v1'])
    await input.fill('/discovery')
    await skillOption.waitFor()
    await observe()
    await skillOption.click()
    await expect.poll(() => input.textContent()).toBe('/discovery-review ')
    await input.locator('[data-composer-text-ref]').waitFor()
    const skillDraft = await input.textContent()
    await reconnect('skills-withdrawn', [])
    await expect.poll(() => input.locator('[data-composer-text-ref]').count()).toBe(0)
    expect(await input.textContent()).toBe(skillDraft)
    await reconnect('restored', discovery)
    await input.locator('[data-composer-text-ref]').waitFor()
    expect(await input.textContent()).toBe(skillDraft)
    await input.fill('@discovery')
    await file.waitFor()
    await session.waitFor()
    await observe()
    for (const call of calls) {
      const allowed = call.stage === 'restored'
        || (call.stage === 'files' && call.endpoint === '/api/fileReferences/list')
        || (call.stage === 'sessions' && call.endpoint === '/api/sessionReferenceResolver/candidates')
        || (call.stage === 'skills' && call.endpoint === '/api/skills/list')
      expect(allowed, JSON.stringify(call)).toBe(true)
    }
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(baseline)
    expect(JSON.stringify(targetAgent.session.snapshotEvents())).toBe(targetBaseline)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
    const actual = JSON.stringify(observations, null, 2) + '\n'
    await writeFile(join(output, 'actual.json'), actual)
    expect(actual).toBe(await readFile(new URL('./expected/host-capability/reference-discovery.expected.json', import.meta.url), 'utf8'))
    await writeFile(join(output, 'observation.json'), JSON.stringify({ status: 'PASS', independentAdmission: true, retainedDraft: true, unchangedSession: true, calls, observations }, null, 2) + '\n')
  } catch (error) {
    await mkdir(output, { recursive: true })
    const page = browser?.contexts()[0]?.pages()[0]
    await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true })
    if (page !== undefined) await writeFile(join(output, 'failure-aria.txt'), await page.locator('body').ariaSnapshot())
    throw error
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 180_000)

it('admits listing, text, complete files and HTML dependencies independently across real connections', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const sockets: WebSocketRoute[] = []
  let negotiations = 0
  let stage = 'absent'
  let operations: string[] = []
  const calls: Array<{ stage: string; method: string }> = []
  const output = '.artifacts/file-ui-capabilities-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'File UI')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'note.txt'), 'FILE_UI_TEXT')
    await writeFile(join(path, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>')
    await writeFile(join(path, 'page.html'), '<!doctype html><script src="./child.js"></script><h1>File HTML</h1>')
    await writeFile(join(path, 'child.js'), 'document.documentElement.dataset.relatedLoaded="yes"')
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('file UI fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'File UI capability fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'File UI session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/workspaceFiles/')) calls.push({ stage, method: endpoint.split('/').at(-1)! })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('file UI discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !id.startsWith('workspace-files.') || operations.includes(id)),
      } } } })
    })
    const reconnect = async (name: string, supported: string[]) => {
      const next = negotiations + 1
      stage = name
      operations = supported.map(method => `workspace-files.${method}.v1`)
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(next)
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    const group = page.getByRole('treeitem').filter({ hasText: 'File UI' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'File UI session' }).click()
    await page.getByText('File UI capability fixture', { exact: true }).waitFor()
    await page.locator('[data-sidebar-right-expand]').click()
    const guide = page.locator('[data-sidebar-right-guide]')
    await guide.waitFor()
    expect(await guide.locator('[data-sidebar-right-guide-entry="files"]').count()).toBe(0)
    expect(calls).toEqual([])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'absent.png'), fullPage: true })

    await reconnect('listing-only', ['list'])
    await guide.locator('[data-sidebar-right-guide-entry="files"]').click()
    const rows = page.locator('[data-files-entry="file"]')
    await rows.getByText('note.txt', { exact: true }).waitFor()
    expect(await rows.locator('button').count()).toBe(0)
    await page.screenshot({ path: join(output, 'listing-only.png'), fullPage: true })

    const filesTab = page.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
    const openFile = async (name: string) => {
      await filesTab.click()
      await rows.getByRole('button', { name, exact: true }).click()
    }
    const preview = page.locator('[data-document-preview]')
    await reconnect('text-only', ['list', 'stat', 'read-text'])
    await openFile('note.txt')
    await preview.getByText('FILE_UI_TEXT', { exact: true }).waitFor()
    await openFile('page.html')
    await expect.poll(() => preview.locator('[data-document-viewer-menu]').innerText()).toBe('Code')
    await preview.locator('[data-document-viewer-menu]').click()
    expect(await page.getByText('HTML', { exact: true }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: join(output, 'text-only.png'), fullPage: true })

    await reconnect('complete-only', ['list', 'stat', 'read-all'])
    await filesTab.click()
    await rows.getByText('page.html', { exact: true }).waitFor()
    expect(await rows.getByRole('button', { name: 'page.html', exact: true }).count()).toBe(0)
    expect(await rows.getByRole('button', { name: 'note.txt', exact: true }).count()).toBe(0)
    await openFile('picture.svg')
    await preview.locator('img').waitFor()
    await expect.poll(() => preview.locator('[data-document-viewer-menu]').innerText()).toBe('Image')
    await page.screenshot({ path: join(output, 'complete-only.png'), fullPage: true })

    await reconnect('html', ['list', 'stat', 'read-all', 'read-related'])
    await openFile('page.html')
    const frame = page.frameLocator('[data-html-preview]')
    await frame.getByRole('heading', { name: 'File HTML', exact: true }).waitFor()
    expect(await frame.locator('html').getAttribute('data-related-loaded')).toBe('yes')
    expect(calls.some(call => call.stage === 'html' && call.method === 'readRelated')).toBe(true)
    await reconnect('preview-without-list', ['stat', 'read-all', 'read-related'])
    await frame.getByRole('heading', { name: 'File HTML', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'preview-without-list.png'), fullPage: true })

    const observation = {
      absentCalls: calls.filter(call => call.stage === 'absent').length,
      listingOnlyNonListCalls: calls.filter(call => call.stage === 'listing-only' && call.method !== 'list').length,
      textOnlyCompleteCalls: calls.filter(call => call.stage === 'text-only' && ['readAll', 'readRelated'].includes(call.method)).length,
      completeOnlyTextOrRelatedCalls: calls.filter(call => call.stage === 'complete-only' && ['read', 'readRelated'].includes(call.method)).length,
      htmlRelatedRead: calls.some(call => call.stage === 'html' && call.method === 'readRelated'),
      previewWithoutListCalls: calls.filter(call => call.stage === 'preview-without-list' && call.method === 'list').length,
      htmlRestoredWithoutList: true,
    }
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/file-ui.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('updates draft and sent reference preview actions across Host capability replacement', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const sockets: WebSocketRoute[] = []
  let readable = false
  let negotiations = 0
  let reads = 0
  const output = '.artifacts/transcript-file-previews-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Reference previews')
    const skillPath = join(path, '.agents', 'skills', 'preview-review')
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), '---\nname: preview-review\ndescription: Preview eligibility fixture\n---\n# Skill preview fixture\n')
    await writeFile(join(path, 'note.md'), '# File preview fixture\n')
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('reference preview fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Preview @note.md /preview-review' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Skill preview instructions' }],
      source: { kind: 'skill-invocation', name: 'preview-review', form: 'instructions' },
    }), { surfaceOp: 'append' })
    const callId = ToolCallId('preview-write')
    const args = JSON.stringify({ file_path: 'note.md', content: '# File preview fixture\n' })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'write', arguments: args }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    const call = agent.session.append('tool/call', { turn: 1, step: 1, callId, name: 'write', arguments: args })
    agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
      callId, content: [{ type: 'text', text: 'Created note.md' }], isError: false,
    }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    agent.session.append('deliverables/presented', { turn: 1, callId, files: [{ path: 'note.md', description: 'Declared preview fixture' }] })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('step/start', { turn: 1, step: 2 })
    agent.session.append('assistant/message', { stream: [], turn: 1, step: 2, message: createAssistantMessage({
      content: [{ type: 'text', text: 'Created `note.md`.' }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }) }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 2 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Reference preview session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const before = JSON.stringify(agent.session.snapshotEvents())
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      if (/\/api\/workspaceFiles\/(stat|readText|readAll|readRelated)$/u.test(new URL(request.url()).pathname)) reads++
    })
    await page.route('**/api/presentedFiles/desktop', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      await route.fulfill({ response, json: { ...envelope, result: {
        ok: true, value: { name: 'fixture-native-host', available: true, fileManager: 'directory' },
      } } })
    })
    await page.route('**/api/presentedFiles/open', (route) => {
      const request = route.request().postDataJSON() as { rpcId: string }
      return route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
        ok: false, error: { code: 'presented-file/path-unavailable', message: 'No verified native path', details: {} },
      } } })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('reference preview discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => readable || !id.startsWith('workspace-files.') || id === 'workspace-files.list.v1'),
      } } } })
    })
    const reconnect = async (available: boolean) => {
      const next = negotiations + 1
      readable = available
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(next)
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    const group = page.getByRole('treeitem').filter({ hasText: 'Reference previews' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'Reference preview session' }).click()
    const processControl = page.locator('[data-turn-process]')
    await processControl.waitFor()
    if (await processControl.getAttribute('aria-expanded') !== 'true') await processControl.click()
    const tool = page.locator('[data-tool="write"]')
    const produced = page.locator('[data-produced-files-row]')
    const presented = page.locator('[data-presented-file]')
    const prose = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'Created' })
    await presented.waitFor()
    const transcriptSnapshots: Array<{ available: boolean; tool: number; produced: number; presented: number; prose: number }> = []
    const assertTranscriptActions = async (available: boolean) => {
      await expect.poll(() => tool.getByRole('button', { name: 'note.md', exact: true }).count()).toBe(available ? 1 : 0)
      await expect.poll(() => produced.locator('button').count()).toBe(available ? 1 : 0)
      await expect.poll(() => presented.locator('button').count()).toBe(available ? 3 : 1)
      await expect.poll(() => prose.getByRole('button', { name: 'Open note.md in sidebar', exact: true }).count()).toBe(available ? 1 : 0)
      expect(await produced.innerText()).toContain('note.md')
      expect(await presented.innerText()).toContain('note.md')
      transcriptSnapshots.push({
        available,
        tool: await tool.getByRole('button', { name: 'note.md', exact: true }).count(),
        produced: await produced.locator('button').count(),
        presented: await presented.locator('button').count(),
        prose: await prose.getByRole('button', { name: 'Open note.md in sidebar', exact: true }).count(),
      })
    }
    await assertTranscriptActions(false)
    await presented.getByRole('button', { name: 'More file actions for note.md' }).click()
    await page.getByRole('menuitem', { name: 'Open in default app' }).click()
    await expect.poll(() => presented.getByRole('status').innerText()).toBe('This file has no available Host path.')
    const sent = page.locator('[data-chat-flow-kind="user"]')
    await sent.locator('[data-ref-chip="skill"]').waitFor()
    expect(await sent.locator('button[data-ref-chip]').count()).toBe(0)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('/preview-review draft @note')
    await page.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /note\.md/u }).click()
    await input.locator('[data-composer-text-ref]').waitFor()
    const draft = await input.textContent()
    expect(await input.locator('[data-reference-openable]').count()).toBe(0)
    await input.locator('[data-composer-chip]').click()
    expect(reads).toBe(0)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'unavailable.png'), fullPage: true })

    await reconnect(true)
    await expect.poll(() => sent.locator('button[data-ref-chip="file"]').count()).toBe(1)
    // Catalog refresh belongs to the normal trigger menu; preview queries never fetch it.
    await input.press('Home')
    await input.press('ArrowRight')
    await page.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /preview-review/u }).waitFor()
    await input.press('Escape')
    await expect.poll(() => sent.locator('button[data-ref-chip]').count()).toBe(2)
    await assertTranscriptActions(true)
    await expect.poll(() => input.locator('[data-reference-openable]').count()).toBe(2)
    expect(await input.textContent()).toBe(draft)
    for (const action of [
      tool.getByRole('button', { name: 'note.md', exact: true }),
      produced.getByRole('button'),
      presented.getByRole('button', { name: 'Open note.md in sidebar', exact: true }),
      prose.getByRole('button', { name: 'Open note.md in sidebar', exact: true }),
    ]) {
      await action.click()
      await page.locator('[data-document-markdown]').getByRole('heading', { name: 'File preview fixture' }).waitFor()
    }
    await sent.locator('button[data-ref-chip="file"]').click()
    await page.locator('[data-document-markdown]').getByRole('heading', { name: 'File preview fixture' }).waitFor()
    await sent.locator('button[data-ref-chip="skill"]').click()
    await page.locator('[data-document-markdown]').getByRole('heading', { name: 'Skill preview fixture' }).waitFor()
    await page.screenshot({ path: join(output, 'available.png'), fullPage: true })

    await reconnect(false)
    await expect.poll(() => sent.locator('button[data-ref-chip]').count()).toBe(0)
    await expect.poll(() => input.locator('[data-reference-openable]').count()).toBe(0)
    expect(await input.textContent()).toBe(draft)
    await assertTranscriptActions(false)
    const beforeUnavailableClick = reads
    await input.locator('[data-composer-text-ref]').click()
    await input.locator('[data-composer-chip]').click()
    expect(reads).toBe(beforeUnavailableClick)
    await page.screenshot({ path: join(output, 'withdrawn.png'), fullPage: true })
    await reconnect(true)
    await expect.poll(() => sent.locator('button[data-ref-chip="file"]').count()).toBe(1)
    // Catalog refresh belongs to the normal trigger menu; preview queries never fetch it.
    await input.press('Home')
    await input.press('ArrowRight')
    await page.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /preview-review/u }).waitFor()
    await input.press('Escape')
    await expect.poll(() => sent.locator('button[data-ref-chip]').count()).toBe(2)
    await assertTranscriptActions(true)
    await expect.poll(() => input.locator('[data-reference-openable]').count()).toBe(2)
    expect(await input.textContent()).toBe(draft)
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(before)
    const expectedTranscript = JSON.parse(await readFile(
      new URL('./expected/host-capability/transcript-previews.expected.json', import.meta.url), 'utf8',
    )) as unknown
    expect(transcriptSnapshots).toEqual(expectedTranscript)
    await writeFile(join(output, 'transcript-actual.json'), JSON.stringify(transcriptSnapshots, null, 2) + '\n')
    await writeFile(join(output, 'observation.json'), JSON.stringify({
      status: 'PASS', controlledDiscovery: true, isolatedRealHost: true,
      stages: ['unavailable', 'available', 'withdrawn', 'restored'],
      retainedDraft: true, unchangedSession: true, readRequests: reads,
      controlledNativePathRefusal: true, toolPaths: true, producedFiles: true, presentedFiles: true, proseMentions: true,
    }, null, 2) + '\n')
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})


it('admits Session content search independently and withdraws old Host results', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const sockets: WebSocketRoute[] = []
  let supported: string[] = []
  let stage = 'absent'
  let negotiations = 0
  const calls: string[] = []
  const output = '.artifacts/session-extra-capabilities-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Session discovery')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const agents = []
    for (const title of ['Quartzneedle local title', 'Content result']) {
      const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
      const agent = scaffold.ctx.agents.get(sessionId)
      if (agent === undefined) throw new Error('Session search fixture has no Agent')
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('step/start', { turn: 1, step: 1 })
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'quartzneedle payload' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      agent.session.append('step/end', { turn: 1, step: 1 })
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await scaffold.ctx.sessionController.rename({ sessionId, title })
      await scaffold.ctx.sessions.flush(agent.session)
      agents.push(agent)
    }
    const baseline = agents.map(agent => JSON.stringify(agent.session.snapshotEvents()))
    const invalidRequest: RequestInit = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'invalid-search', method: 'session/search', payload: { args: { request: {} } } }),
    }
    expect((await fetch(new URL('/api/session/search', scaffold.baseUrl), invalidRequest)).status).toBe(401)
    expect(await (await scaffold.hostFetch('/api/session/search', invalidRequest)).json())
      .toMatchObject({ result: { ok: false, error: { code: 'gateway/input-invalid' } } })
    const attachmentRequest: RequestInit = { ...invalidRequest,
      body: JSON.stringify({ type: 'client-request', rpcId: 'invalid-attachment', method: 'session/attachment', payload: { args: { request: {} } } }),
    }
    expect((await fetch(new URL('/api/session/attachment', scaffold.baseUrl), attachmentRequest)).status).toBe(401)
    expect(await (await scaffold.hostFetch('/api/session/attachment', attachmentRequest)).json())
      .toMatchObject({ result: { ok: false, error: { code: 'gateway/input-invalid' } } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/session/search') calls.push(stage)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Session capability discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities).toEqual(expect.arrayContaining(['session.search.v1', 'session.attachment.v1']))
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !['session.search.v1', 'session.attachment.v1'].includes(id) || supported.includes(id)),
      } } } })
    })
    const reconnect = async (name: string, capabilities: string[]) => {
      const next = negotiations + 1
      stage = name
      supported = capabilities
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(next)
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const composer = page.locator('[data-composer-input][contenteditable="true"]')
    await composer.waitFor({ timeout: 30_000 })
    const group = page.getByRole('treeitem').filter({ hasText: 'Session discovery' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'Quartzneedle local title' }).click()
    await composer.fill('retain Session search draft')
    await page.getByRole('button', { name: 'Search sessions', exact: true }).click()
    const query = page.getByPlaceholder('Search sessions...')
    await query.fill('quartzneedle')
    const results = page.getByRole('tree', { name: 'Search results' })
    const local = results.getByRole('treeitem').filter({ hasText: 'Quartzneedle local title' })
    const content = results.getByRole('treeitem').filter({ hasText: 'Content result' })
    const warning = page.getByText('Content search is temporarily unavailable. Showing name matches.', { exact: true })
    const observations: Array<{ stage: string; local: number; content: number; unavailable: boolean }> = []
    const observe = async (available: boolean) => {
      await expect.poll(() => local.count()).toBe(1)
      await expect.poll(() => content.count(), { timeout: 30_000 }).toBe(available ? 1 : 0)
      await expect.poll(() => warning.count()).toBe(available ? 0 : 1)
      observations.push({ stage, local: await local.count(), content: await content.count(), unavailable: await warning.count() === 1 })
    }
    await observe(false)
    expect(calls).toEqual([])
    await reconnect('search-only', ['session.search.v1'])
    await observe(true)
    await reconnect('attachment-only', ['session.attachment.v1'])
    await observe(false)
    await reconnect('both', ['session.search.v1', 'session.attachment.v1'])
    await observe(true)
    expect(calls).toEqual(['search-only', 'both'])
    expect(await query.inputValue()).toBe('quartzneedle')
    expect(await composer.textContent()).toBe('retain Session search draft')
    expect(agents.map(agent => JSON.stringify(agent.session.snapshotEvents()))).toEqual(baseline)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
    const actual = JSON.stringify(observations, null, 2) + '\n'
    await writeFile(join(output, 'actual.json'), actual)
    expect(actual).toBe(await readFile(new URL('./expected/host-capability/session-extra-capabilities.expected.json', import.meta.url), 'utf8'))
    await writeFile(join(output, 'observation.json'), JSON.stringify({ status: 'PASS', observations, calls,
      retainedDraft: true, unchangedSessions: true, authenticatedGateway: true,
      invalidSearchAndAttachmentRejected: true, discoveryResponsesControlled: true, searchResponsesControlled: false,
    }, null, 2) + '\n')
  } catch (error) {
    await mkdir(output, { recursive: true })
    const page = browser?.contexts()[0]?.pages()[0]
    await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true })
    if (page !== undefined) await writeFile(join(output, 'failure-aria.txt'), await page.locator('body').ariaSnapshot())
    throw error
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

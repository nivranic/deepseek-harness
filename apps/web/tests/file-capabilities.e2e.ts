/** File actions and independent discovery recovery through the shipped Client and an isolated Host. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Locator, type Page, type Route } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { ToolCallId, createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

/** Observe physical Connection generations and close both carrier sides on replacement. */
async function watchConnections(page: Page): Promise<() => Promise<void>> {
  let generations = 0
  const sockets: Array<() => Promise<void>> = []
  await page.routeWebSocket('**/api/remote.mux', (socket) => {
    const server = socket.connectToServer()
    server.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as { type?: string; value?: { type?: string } }
      if (frame.type === 'item' && frame.value?.type === 'ready') generations++
      socket.send(message)
    })
    sockets.push(async () => { await server.close(); await socket.close() })
  })
  return async () => {
    await expect.poll(() => generations, { timeout: 30_000 }).toBeGreaterThan(0)
    const next = generations + 1
    await sockets.at(-1)!()
    await expect.poll(() => generations, { timeout: 30_000 }).toBe(next)
  }
}

/** Wait for intercepted handlers before releasing their request contexts. */
async function closeBrowser(browser: Browser | undefined): Promise<void> {
  if (browser === undefined) return
  try {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) await page.unrouteAll({ behavior: 'wait' })
    }
  } finally { await browser.close() }
}

/** Preserve the failing browser state before its owner closes the page. */
async function captureFailure(browser: Browser | undefined, output: string): Promise<void> {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page === undefined) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  await writeFile(join(output, 'failure-aria.txt'), await page.locator('body').ariaSnapshot())
}

/** Open one recorded Session through its Workspace row. */
async function openRecordedSession(page: Page, scaffold: WebScaffold, workspace: string, title: string): Promise<Locator> {
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const input = page.locator('[data-composer-input][contenteditable="true"]')
  await input.waitFor({ timeout: 30_000 })
  const group = page.getByRole('treeitem').filter({ hasText: workspace }).first()
  if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByRole('treeitem').filter({ hasText: title }).click()
  return input
}

/** Refuse one controlled Remote operation through its ordinary response envelope. */
async function refuseOperation(route: Route, endpoint: string): Promise<void> {
  const request = route.request().postDataJSON() as { rpcId: string }
  await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
    ok: false, error: { code: 'gateway/invocation-unavailable', message: 'Fixture operation unavailable', details: { endpoint } },
  } } })
}

it('keeps authenticated native file routes usable and reports refused file actions without changing the Session', async () => {
  const scaffold = await launchWebScaffold({
    openInAppEnvironment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22' } }]),
  })
  let browser: Browser | undefined
  let available = false
  let refuse = false
  let stage = 'unavailable'
  const calls: Array<{ stage: string; action: string }> = []
  const output = '.artifacts/native-file-actions-browser'
  const peer = scaffold.ctx.connection.createPeer({ principal: { kind: 'owner' } })
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
    const checks: Array<{ method: string; anonymous: number; authenticated: number }> = []
    for (const method of ['canOpenWorkspacePath', 'openWorkspacePath', 'workspaceDesktop']) {
      const args = method === 'openWorkspacePath' ? { request: { path: '' } } : {}
      const request: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'native-' + method, method: 'session/' + method, payload: { args } }),
      }
      const anonymous = await fetch(new URL('/api/session/' + method, scaffold.baseUrl), request)
      const authenticated = await scaffold.hostFetch('/api/session/' + method, request)
      expect(anonymous.status).toBe(401)
      if (method === 'workspaceDesktop') {
        expect(authenticated.status).toBe(404)
        await expect(scaffold.ctx.typertGateway.invoke({ peer, namespace: 'session', method, args }))
          .rejects.toMatchObject({ code: 'gateway/invocation-unavailable' })
      } else {
        expect(authenticated.status).toBe(200)
        const envelope = await authenticated.json() as ServerResponse
        if (method === 'canOpenWorkspacePath') {
          if (!envelope.result.ok) throw new Error('native availability query failed')
          expect(typeof envelope.result.value).toBe('boolean')
        } else expect(envelope.result.ok).toBe(false)
      }
      checks.push({ method, anonymous: anonymous.status, authenticated: authenticated.status })
    }
    const invalid = '/api/present.open?sessionId=' + encodeURIComponent(sessionId) + '&seq=3&index=-1'
    expect((await fetch(new URL('/api/present.host', scaffold.baseUrl))).status).toBe(401)
    expect((await scaffold.hostFetch('/api/present.host')).status).toBe(200)
    expect((await fetch(new URL(invalid, scaffold.baseUrl), { method: 'POST' })).status).toBe(401)
    expect((await scaffold.hostFetch(invalid, { method: 'POST' })).status).toBe(400)
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'route-checks.json'), JSON.stringify(checks, null, 2) + '\n')
    expect(checks).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/session-native-retirement.expected.json', import.meta.url), 'utf8')))

    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const reconnect = await watchConnections(page)
    await page.route('**/api/present.host', route => route.fulfill({
      json: { name: 'fixture-desktop', available, fileManager: 'directory' },
    }))
    await page.route('**/api/present.open?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [{ id: 'fixture-app', name: 'Fixture app', default: true, icon: null }] })
        return
      }
      const action = new URL(route.request().url()).searchParams.get('action') ?? 'open'
      calls.push({ stage, action })
      await route.fulfill({ status: refuse ? 422 : 204, body: refuse ? 'No verified Host path.' : '' })
    })
    const input = await openRecordedSession(page, scaffold, 'Native actions', 'Native action session')
    const card = page.locator('[data-presented-file]')
    await card.waitFor()
    await input.fill('retain native draft')
    const primary = card.getByRole('button', { name: 'Open in Fixture app', exact: true })
    const observations: Array<{ stage: string; native: number; preview: number }> = []
    const observe = async (native: number) => {
      await expect.poll(() => card.locator('[data-open-target]').count()).toBe(native)
      observations.push({ stage, native: await card.locator('[data-open-target]').count(),
        preview: await card.getByRole('button', { name: 'Preview native-note.md in sidebar', exact: true }).count() })
    }
    await observe(0)
    expect(calls).toEqual([])
    available = true
    stage = 'available'
    await reconnect()
    await primary.waitFor()
    await observe(1)
    await primary.click()
    await expect.poll(() => calls.map(call => call.action)).toEqual(['open'])
    await card.locator('[data-open-target][data-state="idle"]').waitFor()
    await card.getByRole('button', { name: 'More ways to open', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Show file location', exact: true }).click()
    await expect.poll(() => calls.map(call => call.action)).toEqual(['open', 'reveal'])
    await card.locator('[data-open-target][data-state="idle"]').waitFor()
    stage = 'refused'
    refuse = true
    await primary.click()
    await card.getByText('This file has no available Host path. Preview it in the sidebar.', { exact: true }).waitFor()
    await observe(1)
    stage = 'restored'
    refuse = false
    await reconnect()
    await primary.click()
    await expect.poll(() => calls.map(call => call.action)).toEqual(['open', 'reveal', 'open', 'open'])
    await expect.poll(() => card.locator('[data-presented-description][data-error="true"]').count()).toBe(0)
    await observe(1)
    expect(await input.textContent()).toBe('retain native draft')
    expect(await readFile(join(path, 'native-note.md'), 'utf8')).toBe('# Native action fixture\n')
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(baseline)
    await writeFile(join(output, 'actual.json'), JSON.stringify(observations, null, 2) + '\n')
    expect(observations).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/native-file-actions.expected.json', import.meta.url), 'utf8')))
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } catch (error) {
    await captureFailure(browser, output)
    throw error
  } finally {
    try { await closeBrowser(browser) } finally {
      try { await peer.dispose() } finally { await scaffold.close() }
    }
  }
}, 180_000)

it('recovers file, Session and skill discovery independently while retaining existing references', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let stage = 'absent'
  let available = new Set<string>()
  const calls: Array<{ stage: string; endpoint: string; served: boolean }> = []
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
    const reconnect = await watchConnections(page)
    for (const endpoint of ['fileReferences/list', 'sessionReferenceResolver/candidates', 'skills/list']) {
      await page.route('**/api/' + endpoint, async (route) => {
        const served = available.has(endpoint)
        calls.push({ stage, endpoint, served })
        if (served) await route.continue()
        else await refuseOperation(route, endpoint)
      })
    }
    const input = await openRecordedSession(page, scaffold, 'Reference discovery', 'Discovery target')
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    const file = menu.getByRole('option', { name: /discovery-note\.md/u })
    const session = menu.getByRole('option', { name: /Discovery source/u })
    const skillOption = menu.getByRole('option', { name: /discovery-review/u })
    const observations: Array<{ stage: string; files: number; sessions: number; skills: number }> = []
    const observe = async (files: number, sessions: number, skills: number) => {
      await expect.poll(() => file.count()).toBe(files)
      await expect.poll(() => session.count()).toBe(sessions)
      await expect.poll(() => skillOption.count()).toBe(skills)
      observations.push({ stage, files: await file.count(), sessions: await session.count(), skills: await skillOption.count() })
    }
    await input.fill('@discovery')
    await expect.poll(() => calls.some(call => call.endpoint === 'fileReferences/list')).toBe(true)
    await expect.poll(() => calls.some(call => call.endpoint === 'sessionReferenceResolver/candidates')).toBe(true)
    await observe(0, 0, 0)
    stage = 'files'
    available = new Set(['fileReferences/list'])
    await reconnect()
    await input.fill('@discovery-')
    await observe(1, 0, 0)
    await file.click()
    const draft = await input.textContent()
    stage = 'sessions'
    available = new Set(['sessionReferenceResolver/candidates'])
    await reconnect()
    expect(await input.textContent()).toBe(draft)
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    await input.locator('[data-composer-chip]').click()
    await page.getByRole('heading', { name: 'Discovery note', exact: true }).waitFor()
    await input.press('End')
    await input.pressSequentially('@Discovery')
    await observe(0, 1, 0)
    stage = 'withdrawn'
    available = new Set()
    await reconnect()
    await input.press('End')
    await input.pressSequentially(' ')
    await input.press('Backspace')
    await observe(0, 0, 0)
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    stage = 'skills'
    available = new Set(['skills/list'])
    await reconnect()
    await input.fill('/discovery')
    await observe(0, 0, 1)
    await skillOption.click()
    await expect.poll(() => input.textContent()).toBe('/discovery-review ')
    const skillDraft = await input.textContent()
    stage = 'skills-withdrawn'
    available = new Set()
    await reconnect()
    expect(await input.textContent()).toBe(skillDraft)
    stage = 'restored'
    available = new Set(['fileReferences/list', 'sessionReferenceResolver/candidates', 'skills/list'])
    await reconnect()
    expect(await input.textContent()).toBe(skillDraft)
    await input.fill('@discovery')
    await observe(1, 1, 0)
    for (const endpoint of available) expect(calls.some(call => call.endpoint === endpoint && call.served)).toBe(true)
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(baseline)
    expect(JSON.stringify(targetAgent.session.snapshotEvents())).toBe(targetBaseline)
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'actual.json'), JSON.stringify(observations, null, 2) + '\n')
    expect(observations).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/reference-discovery.expected.json', import.meta.url), 'utf8')))
    await writeFile(join(output, 'requests.json'), JSON.stringify(calls, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } catch (error) {
    await captureFailure(browser, output)
    throw error
  } finally {
    try { await closeBrowser(browser) } finally { await scaffold.close() }
  }
}, 180_000)

it('recovers directory, text, byte and HTML dependency reads through their current Remote operations', async () => {
  const scaffold = await launchWebScaffold({ developerTools: true })
  let browser: Browser | undefined
  let stage = 'metadata-absent'
  let metadata = false
  let listing = true
  let text = false
  let bytes = false
  let related = false
  const calls: Array<{ stage: string; method: string; baseFile?: string; served: boolean }> = []
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
    const baseline = JSON.stringify(agent.session.snapshotEvents())
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const reconnect = await watchConnections(page)
    await page.route('**/api/host/describe', async (route) => {
      const admitted = metadata
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('file metadata discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => admitted || id !== 'workspace-files.stat.v1'),
      } } } })
    })
    await page.route('**/api/workspaceFiles/*', async (route) => {
      const method = new URL(route.request().url()).pathname.split('/').at(-1)!
      const request = route.request().postDataJSON() as { payload: { args: { options?: { baseFile?: string } } } }
      const baseFile = request.payload.args.options?.baseFile
      let served = true
      if (method === 'list') served = listing
      if (method === 'read') served = text
      if (method === 'readBytes') served = baseFile === undefined ? bytes : related
      calls.push({ stage, method, ...(baseFile === undefined ? {} : { baseFile }), served })
      if (served) await route.continue()
      else await refuseOperation(route, 'workspaceFiles/' + method)
    })
    const input = await openRecordedSession(page, scaffold, 'File UI', 'File UI session')
    await input.fill('retain file reading draft')
    await page.locator('[data-sidebar-right-expand]').click()
    const entry = page.locator('[data-sidebar-right-guide-entry="files"]')
    await entry.waitFor()
    await entry.click()
    const rows = page.locator('[data-files-entry="file"]')
    await rows.getByText('note.txt', { exact: true }).waitFor()
    const filesTab = page.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
    const openFile = async (name: string) => {
      await filesTab.click()
      await rows.getByRole('button', { name, exact: true }).click()
    }
    await openFile('note.txt')
    await page.getByText('The file resource service is unavailable.', { exact: true }).waitFor()
    expect(calls.some(call => call.method === 'read')).toBe(false)
    metadata = true
    stage = 'text-refused'
    await reconnect()
    const preview = page.locator('[data-document-preview]')
    await preview.locator('[data-textpreview-failed]').waitFor()
    expect(calls.some(call => call.method === 'read' && !call.served)).toBe(true)
    stage = 'text-restored'
    text = true
    await preview.locator('[data-textpreview-tool="reload"]').click()
    await preview.getByText('FILE_UI_TEXT', { exact: true }).waitFor()
    stage = 'bytes-refused'
    await openFile('picture.svg')
    await preview.locator('[data-textpreview-failed]').waitFor()
    expect(calls.some(call => call.method === 'readBytes' && call.baseFile === undefined && !call.served)).toBe(true)
    stage = 'bytes-restored'
    bytes = true
    await preview.locator('[data-textpreview-tool="reload"]').click()
    await preview.locator('img').waitFor()
    stage = 'related-refused'
    await openFile('page.html')
    await expect.poll(() => calls.some(call => call.baseFile !== undefined && !call.served)).toBe(true)
    await preview.getByRole('alert').waitFor()
    stage = 'html-restored'
    related = true
    await preview.locator('[data-textpreview-tool="reload"]').click()
    const frame = page.frameLocator('[data-html-preview]')
    await frame.getByRole('heading', { name: 'File HTML', exact: true }).waitFor()
    await expect.poll(() => frame.locator('html').getAttribute('data-related-loaded')).toBe('yes')
    stage = 'listing-refused'
    listing = false
    await filesTab.click()
    await page.locator('[data-files-reload]').click()
    await expect.poll(() => calls.some(call => call.stage === 'listing-refused' && call.method === 'list' && !call.served)).toBe(true)
    await page.locator('[data-dockkit-tab]').filter({ has: page.getByText('page.html', { exact: true }) }).click()
    await frame.getByRole('heading', { name: 'File HTML', exact: true }).waitFor()
    stage = 'listing-restored'
    listing = true
    await filesTab.click()
    await page.locator('[data-files-reload]').click()
    await rows.getByText('note.txt', { exact: true }).waitFor()
    expect(calls.some(call => call.stage === 'listing-restored' && call.method === 'list' && call.served)).toBe(true)
    expect(await input.textContent()).toBe('retain file reading draft')
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(baseline)
    const observation = {
      filesEntryWithoutMetadata: true, metadataReadDeferred: true, textRecovered: true, byteReadRecovered: true,
      relatedReadRecovered: true, htmlRelatedRead: calls.some(call => call.baseFile !== undefined && call.served),
      listingRecovered: true, previewRetainedDuringListingFailure: true, retainedDraft: true,
    }
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
    expect(observation).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/file-ui.expected.json', import.meta.url), 'utf8')))
    await writeFile(join(output, 'requests.json'), JSON.stringify(calls, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } catch (error) {
    await captureFailure(browser, output)
    throw error
  } finally {
    try { await closeBrowser(browser) } finally { await scaffold.close() }
  }
}, 180_000)

it('retains transcript and draft preview actions while file metadata admission changes', async () => {
  const scaffold = await launchWebScaffold({
    openInAppEnvironment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22' } }]),
  })
  let browser: Browser | undefined
  let metadata = false
  let reads = 0
  let refusedNative = 0
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
    const reconnect = await watchConnections(page)
    page.on('request', (request) => {
      if (/\/api\/workspaceFiles\/(stat|read|readBytes)$/u.test(new URL(request.url()).pathname)) reads++
    })
    await page.route('**/api/present.host', route => route.fulfill({
      json: { name: 'fixture-native-host', available: true, fileManager: 'directory' },
    }))
    await page.route('**/api/present.open?**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [{ id: 'fixture-app', name: 'Fixture app', default: true, icon: null }] })
      } else {
        refusedNative++
        await route.fulfill({ status: 422, body: 'No verified Host path.' })
      }
    })
    await page.route('**/api/host/describe', async (route) => {
      const admitted = metadata
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('reference preview discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => admitted || id !== 'workspace-files.stat.v1'),
      } } } })
    })
    const input = await openRecordedSession(page, scaffold, 'Reference previews', 'Reference preview session')
    const processControl = page.locator('[data-turn-process]')
    await processControl.waitFor()
    if (await processControl.getAttribute('aria-expanded') !== 'true') await processControl.click()
    const tool = page.locator('[data-tool="write"]')
    const presented = page.locator('[data-presented-file]')
    const prose = page.locator('[data-chat-flow-kind="assistant-step"]').filter({ hasText: 'Created' })
    const sent = page.locator('[data-chat-flow-kind="user"]')
    await presented.waitFor()
    const actions = [
      tool.getByRole('button', { name: 'note.md', exact: true }),
      presented.getByRole('button', { name: 'Preview note.md in sidebar', exact: true }),
      prose.getByRole('button', { name: 'Open note.md in sidebar', exact: true }),
    ]
    const transcriptSnapshots: Array<{ metadata: boolean; tool: number; presented: number; prose: number }> = []
    const observe = async () => {
      if (await processControl.getAttribute('aria-expanded') !== 'true') await processControl.click()
      const writeGroup = page.getByRole('button', { name: 'Wrote files', exact: true })
      if (await writeGroup.getAttribute('aria-expanded') !== 'true') await writeGroup.click()
      for (const action of actions) await action.waitFor()
      transcriptSnapshots.push({ metadata, tool: await actions[0]!.count(),
        presented: await actions[1]!.count(), prose: await actions[2]!.count() })
    }
    await observe()
    await presented.getByRole('button', { name: 'Open in Fixture app', exact: true }).click()
    await presented.getByText('This file has no available Host path. Preview it in the sidebar.', { exact: true }).waitFor()
    expect(refusedNative).toBe(1)
    expect(await readFile(join(path, 'note.md'), 'utf8')).toBe('# File preview fixture\n')
    await input.fill('/preview-review draft @note')
    await page.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /note\.md/u }).click()
    await input.locator('[data-composer-text-ref]').waitFor()
    const draft = await input.textContent()
    await input.locator('[data-composer-chip]').click()
    await page.getByText('The file resource service is unavailable.', { exact: true }).waitFor()
    expect(reads).toBe(0)

    metadata = true
    await reconnect()
    await observe()
    for (const action of actions) {
      await action.click()
      await page.locator('[data-document-markdown]').getByRole('heading', { name: 'File preview fixture' }).waitFor()
    }
    await sent.locator('button[data-ref-chip="file"]').click()
    await page.locator('[data-document-markdown]').getByRole('heading', { name: 'File preview fixture' }).waitFor()
    await input.press('Home')
    await input.press('ArrowRight')
    await page.getByRole('listbox', { name: 'Trigger suggestions' }).getByRole('option', { name: /preview-review/u }).waitFor()
    await input.press('Escape')
    await sent.locator('button[data-ref-chip="skill"]').click()
    await page.locator('[data-document-markdown]').getByRole('heading', { name: 'Skill preview fixture' }).waitFor()
    expect(await input.textContent()).toBe(draft)
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    expect(await input.locator('[data-composer-text-ref]').count()).toBe(1)
    metadata = false
    await reconnect()
    await observe()
    expect(await input.locator('[data-composer-text-ref]').count()).toBe(0)
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    const beforeUnavailableClick = reads
    await input.locator('[data-composer-chip]').click()
    expect(reads).toBe(beforeUnavailableClick)
    expect(await input.textContent()).toBe(draft)
    metadata = true
    await reconnect()
    await observe()
    await sent.locator('button[data-ref-chip="file"]').click()
    await page.locator('[data-document-markdown]').getByRole('heading', { name: 'File preview fixture' }).waitFor()
    await sent.locator('button[data-ref-chip="skill"]').click()
    await page.locator('[data-document-markdown]').getByRole('heading', { name: 'Skill preview fixture' }).waitFor()
    await input.locator('[data-composer-text-ref]').waitFor()
    expect(await input.locator('[data-composer-chip]').count()).toBe(1)
    expect(await input.textContent()).toBe(draft)
    expect(JSON.stringify(agent.session.snapshotEvents())).toBe(before)
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'transcript-actual.json'), JSON.stringify(transcriptSnapshots, null, 2) + '\n')
    expect(transcriptSnapshots).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/transcript-previews.expected.json', import.meta.url), 'utf8')))
    await writeFile(join(output, 'observation.json'), JSON.stringify({
      retainedDraft: true, unchangedSession: true, readRequests: reads, refusedNative,
      toolPaths: true, presentedFiles: true, proseMentions: true, retainedReferences: true,
    }, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } catch (error) {
    await captureFailure(browser, output)
    throw error
  } finally {
    try { await closeBrowser(browser) } finally { await scaffold.close() }
  }
}, 180_000)

it('keeps Session name matches and the draft when content search fails, then recovers the content results', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let available = false
  let stage = 'unavailable'
  let settled = 0
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
    const reconnect = await watchConnections(page)
    await page.route('**/api/session/search', async (route) => {
      calls.push(stage)
      if (available) {
        const response = await route.fetch()
        await route.fulfill({ response })
      } else await refuseOperation(route, 'session/search')
      settled++
    })
    const composer = await openRecordedSession(page, scaffold, 'Session discovery', 'Quartzneedle local title')
    await composer.fill('retain Session search draft')
    await page.getByRole('button', { name: 'Search sessions', exact: true }).click()
    const query = page.getByPlaceholder('Search session names')
    const results = page.getByRole('tree', { name: 'Search results' })
    const local = results.getByRole('treeitem').filter({ hasText: 'Quartzneedle local title' })
    const content = results.getByRole('treeitem').filter({ hasText: 'Content result' })
    const observations: Array<{ stage: string; local: number; content: number; warning: number }> = []
    const search = async () => {
      const beforeSearch = settled
      await query.fill('')
      await expect.poll(() => results.count()).toBe(0)
      await query.fill('quartzneedle')
      await expect.poll(() => settled).toBeGreaterThan(beforeSearch)
      await expect.poll(() => results.locator('..').getByRole('status').count()).toBe(0)
      await expect.poll(() => local.count()).toBe(1)
      await expect.poll(() => content.count()).toBe(available ? 1 : 0)
      observations.push({ stage, local: await local.count(), content: await content.count(),
        warning: await page.getByText('Content search is temporarily unavailable. Showing name matches.', { exact: true }).count() })
    }
    await search()
    stage = 'search-restored'
    available = true
    await reconnect()
    await search()
    stage = 'unavailable-again'
    available = false
    await reconnect()
    await search()
    stage = 'restored'
    available = true
    await reconnect()
    await search()
    expect(calls).toEqual(['unavailable', 'search-restored', 'unavailable-again', 'restored'])
    expect(await query.inputValue()).toBe('quartzneedle')
    expect(await composer.textContent()).toBe('retain Session search draft')
    expect(agents.map(agent => JSON.stringify(agent.session.snapshotEvents()))).toEqual(baseline)
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'actual.json'), JSON.stringify(observations, null, 2) + '\n')
    expect(observations).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/session-extra-capabilities.expected.json', import.meta.url), 'utf8')))
    await writeFile(join(output, 'observation.json'), JSON.stringify({
      retainedDraft: true, unchangedSessions: true, authenticatedGateway: true,
      invalidSearchAndAttachmentRejected: true, calls, observations,
    }, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } catch (error) {
    await captureFailure(browser, output)
    throw error
  } finally {
    try { await closeBrowser(browser) } finally { await scaffold.close() }
  }
}, 180_000)

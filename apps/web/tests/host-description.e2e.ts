/** Authenticated Host discovery through the shipped Web Loader and HTTP carrier. */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

/** Controlled Host advertisement and physical browser carrier for capability cases. */
interface CapabilityConnection {
  stage: string
  withdrawn: Set<string>
  negotiations: number
  sockets: WebSocketRoute[]
}

/** Replace the physical connection after changing the controlled capability advertisement. */
async function reconnectCapabilities(connection: CapabilityConnection, stage: string, absent: string[]): Promise<void> {
  const next = connection.negotiations + 1
  connection.stage = stage
  connection.withdrawn = new Set(absent)
  await connection.sockets.at(-1)!.close()
  await expect.poll(() => connection.negotiations, { timeout: 30_000 }).toBe(next)
}

it('negotiates file metadata independently from observations and refreshes held resources after replacement', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const connection: CapabilityConnection = {
    stage: 'absent', withdrawn: new Set(['workspace-files.stat.v1', 'workspace-files.changes.v1']), negotiations: 0, sockets: [],
  }
  const calls: Array<{ stage: string; method: string }> = []
  const output = '.artifacts/file-capabilities-browser'
  try {
    const workspace = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspace, { recursive: true })
    const path = join(workspace, 'capability.txt')
    await writeFile(path, 'FILE_CAPABILITY_INITIAL')
    const created = await scaffold.ctx.workspaceController.create({ path: workspace })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: created.workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('file capability fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'File capability resource fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'File capability session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint.startsWith('/api/workspaceFiles/')) calls.push({ stage: connection.stage, method: endpoint.split('/').at(-1)! })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; endpoint?: string }
        if (frame.type === 'open' && frame.endpoint === 'workspaceFiles/changes') calls.push({ stage: connection.stage, method: 'changes' })
        server.send(message)
      })
      connection.sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('file capability fixture discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) connection.negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !connection.withdrawn.has(id)),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    const group = page.getByRole('treeitem').filter({ hasText: 'workspace' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'File capability session' }).click()
    await page.getByText('File capability resource fixture', { exact: true }).waitFor()
    await page.locator('[data-sidebar-right-expand]').click()
    await page.locator('[data-files-entry="file"]').getByText('capability.txt', { exact: true }).waitFor()
    expect(await page.locator('[data-files-entry="file"] button').count()).toBe(0)
    const absentCalls = calls.filter(call => call.method !== 'list').length
    expect(absentCalls).toBe(0)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'absent.png'), fullPage: true })

    await reconnectCapabilities(connection, 'metadata-only', ['workspace-files.changes.v1'])
    await page.locator('[data-files-entry="file"]').getByRole('button', { name: 'capability.txt', exact: true }).click()
    const preview = page.locator('[data-document-preview]')
    await preview.getByText('FILE_CAPABILITY_INITIAL', { exact: true }).waitFor()
    expect(calls.filter(call => call.method === 'changes')).toEqual([])
    const target = await scaffold.ctx.fs.resolve(path)
    await scaffold.ctx.fs.writeText(target, 'FILE_CAPABILITY_RECONNECTED')
    await reconnectCapabilities(connection, 'refreshed-metadata', ['workspace-files.changes.v1'])
    await preview.getByText('FILE_CAPABILITY_RECONNECTED', { exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'metadata-only.png'), fullPage: true })

    await reconnectCapabilities(connection, 'observed', [])
    await expect.poll(() => calls.filter(call => call.method === 'changes').length).toBe(1)
    // A stat follows the subscription's ready frame, proving the Host observer is active.
    await expect.poll(() => calls.filter(call => call.stage === 'observed' && call.method === 'stat').length).toBe(1)
    const written = await scaffold.ctx.fs.writeText(target, 'FILE_CAPABILITY_OBSERVED')
    scaffold.ctx.emit('fs/observed', target, { kind: 'present', version: written.version }, undefined)
    await preview.locator('[data-textpreview-changed]').waitFor()
    await preview.locator('[data-textpreview-reload-now]').click()
    await preview.getByText('FILE_CAPABILITY_OBSERVED', { exact: true }).waitFor()
    await reconnectCapabilities(connection, 'withdrawn', ['workspace-files.stat.v1', 'workspace-files.changes.v1'])
    await preview.waitFor({ state: 'detached' })
    await reconnectCapabilities(connection, 'restored', ['workspace-files.changes.v1'])
    await expect.poll(() => calls.filter(call => call.stage === 'restored' && call.method === 'stat').length).toBe(1)
    await preview.getByText('FILE_CAPABILITY_OBSERVED', { exact: true }).waitFor()
    const observation = {
      absentCalls,
      metadataWithoutFeed: calls.some(call => call.stage === 'metadata-only' && call.method === 'stat'),
      refreshedAfterReplacement: calls.some(call => call.stage === 'refreshed-metadata' && call.method === 'stat'),
      changeStreams: calls.filter(call => call.method === 'changes').length,
      withdrawnCalls: calls.filter(call => call.stage === 'withdrawn' && call.method !== 'list').length,
      restoredMetadata: true,
    }
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/file-resources.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('admits directory browsing independently and preserves creation committed before connection replacement', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const connection: CapabilityConnection = {
    stage: 'absent', withdrawn: new Set(['directory-picker.browse.v1', 'directory-picker.create.v1']), negotiations: 0, sockets: [],
  }
  const calls: Array<{ stage: string; endpoint: string }> = []
  const navigationCalls: string[] = []
  const navigationFailures: string[] = []
  const created = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const responseReleased = Promise.withResolvers<undefined>()
  let creationRequestCancelled = false
  const output = '.artifacts/directory-capabilities-browser'
  try {
    const existing = join(scaffold.workspaceCwd, 'Existing directory')
    const newFolder = join(scaffold.workspaceCwd, 'Created directory')
    await mkdir(existing, { recursive: true })
    expect(scaffold.ctx.directoryPickerController.typertRemote.capabilities?.map(capability => capability.id)).toEqual([
      'directory-picker.browse.v1', 'directory-picker.create.v1',
    ])
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    const captureSelectionFailure = async () => {
      await mkdir(output, { recursive: true })
      await page.screenshot({ path: join(output, 'selection-failure.png'), fullPage: true })
      await writeFile(join(output, 'selection-failure.json'), JSON.stringify({
        navigationCalls, navigationFailures,
        workspaces: scaffold.ctx.workspaceRegistry.list().map(item => ({ title: item.title, sessions: item.sessionIds.length })),
        selectedRows: await page.locator('[role="treeitem"][aria-selected="true"]').allTextContents(),
      }, null, 2) + '\n')
    }
    page.on('console', (message) => {
      if (message.text().startsWith('new session failed:')) navigationFailures.push(message.text())
    })
    page.on('request', (request) => {
      const endpoint = new URL(request.url()).pathname
      if (endpoint === '/api/session/create') navigationCalls.push(connection.stage)
      if (endpoint.startsWith('/api/directoryPicker/') || endpoint === '/api/workspace/create') calls.push({ stage: connection.stage, endpoint })
    })
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/api/directoryPicker/createDirectory') creationRequestCancelled = true
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      connection.sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('directory capability fixture discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) connection.negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !connection.withdrawn.has(id)),
      } } } })
    })
    await page.route('**/api/directoryPicker/createDirectory', async (route) => {
      const response = await route.fetch()
      created.resolve(undefined)
      await release.promise
      await route.fulfill({ response })
      responseReleased.resolve(undefined)
    })
    const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
    const browseTo = async (path: string) => {
      await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
      await dialog.waitFor()
      await dialog.getByRole('button', { name: 'Edit path', exact: true }).click()
      const input = dialog.getByRole('textbox', { name: 'Edit path', exact: true })
      await input.fill(path)
      await page.keyboard.press('Enter')
      await input.waitFor({ state: 'detached' })
      await expect.poll(() => dialog.getByRole('button', { name: 'Open', exact: true }).isEnabled()).toBe(true)
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input]').waitFor({ timeout: 30_000 })
    expect(await page.getByRole('button', { name: 'Add workspace', exact: true }).count()).toBe(0)
    expect(calls).toEqual([])
    await reconnectCapabilities(connection, 'browse-only', ['directory-picker.create.v1'])
    await browseTo(existing)
    expect(await dialog.getByRole('button', { name: 'New folder', exact: true }).count()).toBe(0)
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'browse-only.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await expect.poll(() => scaffold.ctx.workspaceRegistry.resolveByPath(existing)).not.toBeUndefined()
    await expect.poll(() => page.locator('[data-composer-input][contenteditable="true"]')
      .evaluate(element => element === document.activeElement)).toBe(true)
    await reconnectCapabilities(connection, 'draft', [])
    await browseTo(scaffold.workspaceCwd)
    await dialog.getByRole('button', { name: 'New folder', exact: true }).click()
    await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Discarded draft')
    await reconnectCapabilities(connection, 'withdrawn', ['directory-picker.create.v1'])
    await dialog.waitFor({ state: 'hidden' })
    expect(await page.getByRole('textbox', { name: 'Folder name', exact: true }).count()).toBe(0)
    await reconnectCapabilities(connection, 'creating', [])
    await browseTo(scaffold.workspaceCwd)
    expect(await page.getByRole('textbox', { name: 'Folder name', exact: true }).count()).toBe(0)
    await dialog.getByRole('button', { name: 'New folder', exact: true }).click()
    await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Created directory')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await created.promise
    expect((await stat(newFolder)).isDirectory()).toBe(true)
    await reconnectCapabilities(connection, 'replaced', ['directory-picker.browse.v1', 'directory-picker.create.v1'])
    await dialog.waitFor({ state: 'hidden' })
    release.resolve(undefined)
    await responseReleased.promise
    await expect.poll(() => creationRequestCancelled).toBe(true)
    await expect.poll(() => page.getByRole('button', { name: 'Add workspace', exact: true }).count()).toBe(0)
    expect(await scaffold.ctx.workspaceRegistry.resolveByPath(newFolder)).toBeUndefined()
    await page.screenshot({ path: join(output, 'replaced.png'), fullPage: true })
    await reconnectCapabilities(connection, 'restored', [])
    await browseTo(newFolder)
    await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await expect.poll(() => scaffold.ctx.workspaceRegistry.resolveByPath(newFolder)).not.toBeUndefined()
    const restoredGroup = page.getByRole('treeitem').filter({ hasText: 'Created directory' }).first()
    const restoredSection = restoredGroup.locator('xpath=ancestor::*[contains(@class, "groupSection")][1]')
    try {
      await restoredSection.locator('[role="treeitem"][aria-selected="true"]').waitFor()
    } catch (error) {
      await captureSelectionFailure()
      throw error
    }
    const observation = {
      absentCalls: calls.filter(call => call.stage === 'absent').length,
      nativeCalls: calls.filter(call => call.endpoint.endsWith('/pick')).length,
      creationCalls: calls.filter(call => call.endpoint.endsWith('/createDirectory')).length,
      workspaceCreates: calls.filter(call => call.endpoint === '/api/workspace/create').length,
      callsAfterReplacement: calls.filter(call => call.stage === 'replaced').length,
      creationRequestCancelled,
      existingRegistered: await scaffold.ctx.workspaceRegistry.resolveByPath(existing) !== undefined,
      createdDirectoryRetained: (await stat(newFolder)).isDirectory(),
      explicitAdoptionAfterRestoration: await scaffold.ctx.workspaceRegistry.resolveByPath(newFolder) !== undefined,
      selectedAfterRestoration: await restoredSection.locator('[role="treeitem"][aria-selected="true"]').count() === 1,
    }
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/directory-operations.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } finally {
    release.resolve(undefined)
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('separates Workspace registry, session organization and follow capabilities across real connections', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const connection: CapabilityConnection = {
    stage: 'registry-absent', withdrawn: new Set(['workspace.manage.v1']), negotiations: 0, sockets: [],
  }
  const follows: string[] = []
  const mutations: string[] = []
  const output = '.artifacts/workspace-capabilities-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Capability Workspace')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Workspace capability fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Workspace capability fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Workspace capability session' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (/\/api\/workspace\/(create|rename|delete|insertBefore|archiveSession|insertSessionBefore)$/u.test(pathname)) {
        mutations.push(pathname)
      }
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; endpoint?: string }
        if (frame.type === 'open' && frame.endpoint === 'workspace/follow') follows.push(connection.stage)
        server.send(message)
      })
      connection.sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Workspace capability fixture discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) connection.negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !connection.withdrawn.has(id)),
      } } } })
    })
    const group = page.getByRole('treeitem').filter({ hasText: 'Capability Workspace' }).first()
    const expand = async () => {
      await group.waitFor()
      if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    }
    const workspaceMenu = page.getByRole('button', { name: 'Workspace actions for Capability Workspace', exact: true, includeHidden: true })
    const openSessionMenu = async () => {
      await expand()
      await page.getByRole('treeitem').filter({ hasText: 'Workspace capability session' }).hover()
      await page.getByRole('button', { name: 'Session actions for Workspace capability session', exact: true }).click()
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    await expand()
    expect(await workspaceMenu.count()).toBe(0)
    expect(await group.getAttribute('draggable')).not.toBe('true')
    expect(await page.getByRole('button', { name: 'Add workspace', exact: true }).count()).toBe(0)
    await openSessionMenu()
    await page.getByRole('menuitem', { name: 'Archive session', exact: true }).waitFor()
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'registry-absent.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await reconnectCapabilities(connection, 'organization-absent', ['workspace.sessions.v1'])
    await workspaceMenu.waitFor({ state: 'attached' })
    await openSessionMenu()
    expect(await page.getByRole('menuitem', { name: 'Archive session', exact: true }).count()).toBe(0)
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).waitFor()
    expect(await page.getByRole('treeitem').filter({ hasText: 'Workspace capability session' }).getAttribute('draggable')).not.toBe('true')
    await page.keyboard.press('Escape')
    await group.hover()
    await workspaceMenu.click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await page.getByRole('dialog', { name: 'Rename workspace', exact: true }).waitFor()
    await reconnectCapabilities(connection, 'follow-absent', ['workspace.follow.v1', 'workspace.manage.v1', 'workspace.sessions.v1'])
    await expect.poll(() => group.count()).toBe(0)
    expect(await page.getByRole('dialog', { name: 'Rename workspace', exact: true }).count()).toBe(0)
    expect(follows.filter(value => value === 'follow-absent')).toEqual([])
    await page.screenshot({ path: join(output, 'follow-absent.png'), fullPage: true })
    await reconnectCapabilities(connection, 'restored', [])
    await expand()
    expect(await page.getByRole('dialog', { name: 'Rename workspace', exact: true }).count()).toBe(0)
    await group.hover()
    await workspaceMenu.click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename workspace', exact: true })
    await rename.getByRole('textbox').fill('Workspace restored')
    await rename.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('treeitem').filter({ hasText: 'Workspace restored' }).first().waitFor()
    const observation = { follows, mutations, retainedSession: await page.getByRole('treeitem').filter({ hasText: 'Workspace capability session' }).count() }
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/workspace-operations.expected.json', import.meta.url), 'utf8')) as unknown
    expect(observation).toEqual(expected)
    await writeFile(join(output, 'observation.json'), JSON.stringify(observation, null, 2) + '\n')
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('withdraws workspace and preset Session-management actions and restores real rename', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let advertised = true
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const mutations: string[] = []
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('management fixture has no Agent')
    // Seed before Client admission so the initial Session list reads a closed, non-blank fixture without a model request.
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Capability fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessionController.rename({ sessionId: agent.session.id, title: 'Capability row' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/\/api\/session\/(create|rename|renameAt|fork)$/u.test(path)) mutations.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('management fixture discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: advertised ? descriptor.capabilities
          : descriptor.capabilities.filter(id => id !== 'session.manage.v1'),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 15_000 })
    await page.getByRole('treeitem').filter({ hasText: 'New Session' }).waitFor()
    const group = page.getByRole('treeitem').filter({ hasText: 'workspace' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    const rowMenu = page.getByRole('button', { name: 'Session actions for Capability row', exact: true, includeHidden: true })
    const openRowMenu = async () => {
      await page.getByRole('treeitem').filter({ hasText: 'Capability row' }).hover()
      await rowMenu.click()
    }
    await openRowMenu()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    await page.getByRole('dialog', { name: 'Rename session', exact: true }).waitFor()
    mutations.length = 0
    advertised = false
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => page.getByRole('dialog', { name: 'Rename session', exact: true }).count()).toBe(0)
    await openRowMenu()
    const absent = {
      create: await page.getByRole('button', { name: /^New session in /u, includeHidden: true }).count(),
      rename: await page.getByRole('menuitem', { name: 'Rename', exact: true }).count(),
      fork: await page.getByRole('menuitem', { name: 'Fork session', exact: true }).count(),
      archive: await page.getByRole('menuitem', { name: 'Archive session', exact: true }).count(),
    }
    await mkdir('.artifacts/workspace-management-browser', { recursive: true })
    await page.screenshot({ path: '.artifacts/workspace-management-browser/absent-row.png', fullPage: true })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
    await settings.getByRole('button', { name: 'New task default: Standard mode', exact: true }).waitFor()
    const creator = settings.getByRole('button', { name: 'Draft a custom preset with Creator mode', exact: true })
    const expected = JSON.parse(await readFile(
      new URL('./expected/host-capability/workspace-management.expected.json', import.meta.url), 'utf8',
    )) as Record<string, unknown>
    expect({ ...absent, creator: await creator.count(), mutations: mutations.length }).toEqual(expected.absent)
    await page.screenshot({ path: '.artifacts/workspace-management-browser/absent-preset.png', fullPage: true })
    advertised = true
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(3)
    await creator.waitFor()
    const restoredCreator = await creator.count()
    await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
    expect(await page.getByRole('dialog', { name: 'Rename session', exact: true }).count()).toBe(0)
    await openRowMenu()
    const restored = {
      create: await page.getByRole('button', { name: /^New session in /u, includeHidden: true }).count(),
      rename: await page.getByRole('menuitem', { name: 'Rename', exact: true }).count(),
      fork: await page.getByRole('menuitem', { name: 'Fork session', exact: true }).count(),
      archive: await page.getByRole('menuitem', { name: 'Archive session', exact: true }).count(),
    }
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename session', exact: true })
    await rename.getByRole('textbox', { name: 'Session name', exact: true }).fill('Capability restored')
    await rename.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('treeitem').filter({ hasText: 'Capability restored' }).waitFor()
    expect({ ...restored, creator: restoredCreator, mutations: mutations.length }).toEqual(expected.restored)
    expect(mutations).toEqual(['/api/session/renameAt'])
    await page.screenshot({ path: '.artifacts/workspace-management-browser/restored.png', fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('updates sidebar creation shortcuts when Session management capability changes', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let advertised = true
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const mutations: string[] = []
  try {
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/\/api\/session\/(create|rename|renameAt|fork)$/u.test(path)) mutations.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Session management discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: advertised ? descriptor.capabilities
          : descriptor.capabilities.filter(id => id !== 'session.manage.v1'),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const shortcuts = page.getByRole('button', { name: 'New session', exact: true })
    await expect.poll(() => shortcuts.count()).toBe(2)
    advertised = false
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => shortcuts.count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).count()).toBe(1)
    const brand = page.locator('[class*="brandIdentity"]').locator('..')
    expect(await brand.evaluate(element => ({ tag: element.tagName, cursor: getComputedStyle(element).cursor })))
      .toEqual({ tag: 'DIV', cursor: 'default' })
    const expected = JSON.parse(await readFile(
      new URL('./expected/host-capability/sidebar-management.expected.json', import.meta.url), 'utf8',
    )) as Record<string, unknown>
    expect({ shortcuts: await shortcuts.count(), mutations }).toEqual(expected.absent)
    await mkdir('.artifacts/session-management-browser', { recursive: true })
    await page.screenshot({ path: '.artifacts/session-management-browser/absent.png', fullPage: true })
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).waitFor()
    expect(await shortcuts.count()).toBe(0)
    advertised = true
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(3)
    await expect.poll(() => shortcuts.count()).toBe(1)
    expect({ shortcuts: await shortcuts.count(), mutations }).toEqual(expected.restoredRail)
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
    await expect.poll(() => shortcuts.count()).toBe(2)
    expect({ shortcuts: await shortcuts.count(), mutations }).toEqual(expected.restoredExpanded)
    await page.screenshot({ path: '.artifacts/session-management-browser/restored.png', fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('preserves a browser draft across control capability loss and recovery', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url)),
  })
  let browser: Browser | undefined
  let advertised = true
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const mutations: string[] = []
  const controlOpens: boolean[] = []
  try {
    await scaffold.ctx.settings.update('llm-pi-ai', { providers: {
      'origin-gateway': { displayName: 'Capability test', api: 'openai-completions',
        baseURL: 'https://capability.invalid/v1', models: [{ id: 'origin-large', name: 'Origin Large' }] },
    } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/\/api\/session\/(prompt|cancel|updateQueue)$/u.test(path)) mutations.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; endpoint?: string }
        if (frame.type === 'open' && frame.endpoint === 'session/control') controlOpens.push(advertised)
        server.send(message)
      })
      sockets.push(socket)
    })
    // Project a smaller operation set onto real Host discovery; business traffic remains real.
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('control capability fixture discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: advertised ? descriptor.capabilities
          : descriptor.capabilities.filter(id => id !== 'session.control.v1'),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await expect.poll(() => controlOpens.length).toBe(1)
    const input = page.locator('[data-composer-input]')
    const expected = JSON.parse(await readFile(
      new URL('./expected/host-capability/session-control.expected.json', import.meta.url), 'utf8',
    )) as Record<string, unknown>
    const observed = async () => ({
      editable: await input.getAttribute('contenteditable'), draft: await input.innerText(),
      sendControls: await page.getByRole('button', { name: 'Send message', exact: true }).count(),
      stopControls: await page.getByRole('button', { name: 'Stop generating', exact: true }).count(),
      mutations: [...mutations],
    })
    await input.fill('Draft retained across capability changes')
    advertised = false
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(2)
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('false')
    expect(await input.innerText()).toBe('Draft retained across capability changes')
    expect(await page.getByRole('button', { name: /^(Send message|Stop generating)$/u }).count()).toBe(0)
    await input.press('Enter')
    expect(mutations).toEqual([])
    expect(await observed()).toEqual(expected.absent)
    expect(controlOpens).toEqual([true])
    await mkdir('.artifacts/session-capability-browser', { recursive: true })
    await page.screenshot({ path: '.artifacts/session-capability-browser/absent.png', fullPage: true })
    advertised = true
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(3)
    await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
    expect(await input.innerText()).toBe('Draft retained across capability changes')
    await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
    expect(mutations).toEqual([])
    expect(await observed()).toEqual(expected.restored)
    await expect.poll(() => controlOpens.length).toBe(2)
    expect(controlOpens).toEqual([true, true])
    await page.screenshot({ path: '.artifacts/session-capability-browser/restored.png', fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('describes live Host capabilities through authenticated Remote and refuses anonymous discovery', async () => {
  const scaffold = await launchWebScaffold()
  const request: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'host-description-read', method: 'host/describe', payload: { args: {} },
    }),
  }
  try {
    const anonymous = await fetch(new URL('/api/host/describe', scaffold.baseUrl), request)
    expect(anonymous.status).toBe(401)
    const response = await scaffold.hostFetch('/api/host/describe', request)
    expect(response.status).toBe(200)
    const envelope = await response.json() as ServerResponse
    expect(envelope.type).toBe('server-response')
    expect(envelope.rpcId).toBe('host-description-read')
    if (!envelope.result.ok) throw new Error(`Host discovery failed: ${envelope.result.error.code}: ${envelope.result.error.message}`)
    const descriptor = envelope.result.value as HostDescriptor
    expect(Object.keys(descriptor).sort()).toEqual([
      'apiProtocolVersion', 'arch', 'capabilities', 'displayName', 'hostId', 'platform',
      'productVersion', 'runtimeMode', 'serverTime', 'sessionFormatVersion', 'supportedApiProtocolVersions', 'transports',
    ])
    expect(descriptor).toMatchObject({
      displayName: 'DeepSeek Harness', runtimeMode: 'full',
      apiProtocolVersion: 1, sessionFormatVersion: 3,
      platform: process.platform, arch: process.arch, transports: ['http', 'websocket'],
    })
    expect(descriptor.productVersion).toMatch(/^\d+\.\d+\.\d+/u)
    expect(descriptor.serverTime).toBeGreaterThan(0)
    expect(descriptor.hostId).toBe((await readFile(join(scaffold.harnessHome, '.host-id'), 'utf8')).trimEnd())
    expect(descriptor.capabilities).toEqual([
      'agent-preset.catalog.v1', 'agent-preset.manage.v1', 'agent-preset.select.v1',
      'host.describe.v1', 'host.negotiate.v1', 'model.catalog.v1', 'model.select.v1', 'session.cancel-turn.v1',
      'session.control.v1', 'session.follow.v1', 'session.list.v1', 'session.manage.v1', 'session.rename-at.v1',
      'settings.agent-preset-directory.v1', 'settings.document-open.v1', 'settings.read.v1', 'settings.write.v1',
    ])
  } finally {
    await scaffold.close()
  }
})

it('prepares the real browser connection before business calls and event streams', async () => {
  const scaffold = await launchWebScaffold()
  const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
  let browser: Browser | undefined
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let releaseNegotiation!: () => void
  const negotiatedHeld = new Promise<void>((resolve) => { releaseNegotiation = resolve })
  let negotiated: HostDescriptor | undefined
  let descriptor: HostDescriptor | undefined
  const requests: string[] = []
  const streams: string[] = []
  const streamProtocols: unknown[] = []
  try {
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/')) requests.push(path)
    })
    page.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; endpoint?: string; payload?: { apiProtocolVersion?: number } }
        if (frame.type === 'open' && frame.endpoint !== undefined) {
          streams.push(frame.endpoint)
          streamProtocols.push(frame.payload?.apiProtocolVersion)
        }
      })
    })
    await page.route('**/api/host/describe', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('authenticated browser discovery failed')
      descriptor = envelope.result.value as HostDescriptor
      await held
      await route.fulfill({ response })
    })
    await page.route('**/api/host/negotiate', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('authenticated browser negotiation failed')
      negotiated = envelope.result.value as HostDescriptor
      await negotiatedHeld
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await expect.poll(() => descriptor, { timeout: 30_000 }).toBeDefined()
    await page.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) }))
    expect(requests).toEqual(['/api/host/describe'])
    expect(streams).toEqual([])
    expect(descriptor?.hostId).toBe((await readFile(join(scaffold.harnessHome, '.host-id'), 'utf8')).trimEnd())
    release()
    await expect.poll(() => negotiated, { timeout: 30_000 }).toBeDefined()
    expect(negotiated).toMatchObject({ hostId: descriptor?.hostId, apiProtocolVersion: 2 })
    expect(requests).toEqual(['/api/host/describe', '/api/host/negotiate'])
    expect(streams).toEqual([])
    releaseNegotiation()
    await expect.poll(() => streams, { timeout: 30_000 }).toContain('$events')
    await expect.poll(() => requests.some(path => path !== '/api/host/describe'), { timeout: 30_000 }).toBe(true)
    expect(streams[0]).toBe('$events')
    expect(streamProtocols[0]).toBe(2)
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  } finally {
    release()
    releaseNegotiation()
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)


it.each([true, false])('renders model selection only for advertised Host capability: %s', async (supported) => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url)),
  })
  let browser: Browser | undefined
  const modelRequests: string[] = []
  let advertised = supported
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  try {
    await scaffold.ctx.settings.update('llm-pi-ai', { providers: {
      'origin-gateway': { displayName: 'Capability test', api: 'openai-completions',
        baseURL: 'https://capability.invalid/v1', models: [{ id: 'origin-large', name: 'Origin Large' }] },
    } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path === '/api/session/modelCatalog' || path === '/api/session/selectModel') modelRequests.push(path)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    {
      // A controlled wire advertisement represents a Host with a smaller operation set; all traffic still reaches the real Loader.
      await page.route('**/api/host/*', async (route) => {
        const response = await route.fetch()
        const envelope = await response.json() as ServerResponse
        if (!envelope.result.ok) throw new Error('capability fixture discovery failed')
        const descriptor = envelope.result.value as HostDescriptor
        if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations += 1
        if (advertised) { await route.fulfill({ response }); return }
        await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
          ...descriptor, capabilities: descriptor.capabilities.filter(id => id !== 'model.select.v1'),
        } } } })
      })
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const selector = page.getByRole('button', { name: /^Select model/ })
    if (supported) {
      await selector.waitFor({ state: 'visible', timeout: 15_000 })
      expect(modelRequests).toContain('/api/session/modelCatalog')
    } else {
      expect(await selector.count()).toBe(0)
      expect(modelRequests).toEqual([])
    }
    await page.locator('[data-composer-input][contenteditable="true"]').fill('/mo')
    await page.getByRole('listbox').waitFor({ timeout: 15_000 })
    expect(await page.getByRole('option').filter({ hasText: 'Model' }).count()).toBe(supported ? 1 : 0)
    const expected = JSON.parse(await readFile(new URL('./expected/host-capability/model-selection.expected.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect({ modelControls: await selector.count(),
      modelCommands: await page.getByRole('option').filter({ hasText: 'Model' }).count(),
      modelCatalogCalls: modelRequests.filter(path => path === '/api/session/modelCatalog').length,
    }).toEqual(expected[String(supported)])
    await mkdir('.artifacts/model-capability-browser', { recursive: true })
    await page.screenshot({ path: `.artifacts/model-capability-browser/${supported ? 'supported' : 'absent'}.png`, fullPage: true })
    if (!supported) expect(modelRequests).toEqual([])
    if (supported) {
      await page.locator('[data-composer-input][contenteditable="true"]').fill('')
      await selector.click()
      await page.getByRole('menu', { name: 'Model and reasoning effort' }).waitFor()
      const before = modelRequests.length
      advertised = false
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(2)
      await expect.poll(() => selector.count()).toBe(0)
      expect(await page.getByRole('menu', { name: 'Model and reasoning effort' }).count()).toBe(0)
      expect(modelRequests).toHaveLength(before)
      advertised = true
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(3)
      await selector.waitFor({ state: 'visible', timeout: 15_000 })
      await expect.poll(() => modelRequests.length).toBe(before + 1)
    }
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

it('retains history while follow is unavailable and catches up after real reconnection', async () => {
  const expected = JSON.parse(await readFile(new URL('./expected/host-capability/session-follow.expected.json', import.meta.url), 'utf8')) as { absent: Record<string, unknown>; restored: Record<string, unknown> }
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let advertised = true
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const followOpens: boolean[] = []
  const pages: boolean[] = []
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('follow fixture has no Agent')
    const appendTurn = (turn: number, text: string) => {
      agent.session.append('turn/start', { turn })
      agent.session.append('step/start', { turn, step: 1 })
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      agent.session.append('step/end', { turn, step: 1 })
      agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    appendTurn(1, 'History retained before withdrawal')
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Follow capability fixture' })
    await scaffold.ctx.sessions.flush(agent.session)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/session/page')) pages.push(advertised)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = JSON.parse(message.toString()) as { type?: string; endpoint?: string }
        if (frame.type === 'open' && frame.endpoint === 'session/follow') followOpens.push(advertised)
        server.send(message)
      })
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('follow fixture discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: advertised ? descriptor.capabilities
          : descriptor.capabilities.filter(id => id !== 'session.follow.v1'),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 30_000 })
    await page.getByRole('treeitem').filter({ hasText: 'New Session' }).waitFor()
    const group = page.getByRole('treeitem').filter({ hasText: 'workspace' }).first()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await page.getByRole('treeitem').filter({ hasText: 'Follow capability fixture' }).click()
    const cached = page.getByText('History retained before withdrawal', { exact: true })
    await cached.waitFor()
    const input = page.locator('[data-composer-input]')
    await input.fill('Draft survives follow withdrawal')
    const before = followOpens.length
    advertised = false
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(2)
    const notice = page.getByText('This Host cannot currently provide session history. Loaded content remains available and will sync when support returns.', { exact: true })
    await notice.waitFor()
    await cached.waitFor()
    expect(await input.innerText()).toBe('Draft survives follow withdrawal')
    appendTurn(2, 'History caught up after restoration')
    await scaffold.ctx.sessions.flush(agent.session)
    expect(await page.getByText('History caught up after restoration', { exact: true }).count()).toBe(0)
    expect(followOpens).toHaveLength(before)
    expect(followOpens).not.toContain(false)
    expect(pages).not.toContain(false)
    expect({ notice: await notice.innerText(), cachedHistory: await cached.count(),
      newHistory: await page.getByText('History caught up after restoration', { exact: true }).count(),
      draft: await input.innerText(), unavailableFollowRequests: followOpens.filter(value => !value).length,
      unavailablePageRequests: pages.filter(value => !value).length }).toEqual(expected.absent)
    await mkdir('.artifacts/session-follow-ui-browser', { recursive: true })
    await page.screenshot({ path: '.artifacts/session-follow-ui-browser/absent.png', fullPage: true })
    advertised = true
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(3)
    await page.getByText('History caught up after restoration', { exact: true }).waitFor()
    await cached.waitFor()
    expect(await notice.count()).toBe(0)
    expect(await input.innerText()).toBe('Draft survives follow withdrawal')
    expect(followOpens.length).toBeGreaterThan(before)
    expect(followOpens).not.toContain(false)
    expect({ notice: await notice.count(), cachedHistory: await cached.count(),
      newHistory: await page.getByText('History caught up after restoration', { exact: true }).count(),
      draft: await input.innerText() }).toEqual(expected.restored)
    await page.screenshot({ path: '.artifacts/session-follow-ui-browser/restored.png', fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)


it('waits for management before startup creation and withdraws the open workspace picker', async () => {
  const expected = JSON.parse(await readFile(new URL('./expected/host-capability/workspace-admission.expected.json', import.meta.url), 'utf8')) as Record<string, unknown>
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let advertised = false
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const creations: boolean[] = []
  try {
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    await scaffold.ctx.workspaceController.create({ path: workspacePath })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/api/session/create')) creations.push(advertised)
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      socket.connectToServer()
      sockets.push(socket)
    })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('workspace admission discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: advertised ? descriptor.capabilities
          : descriptor.capabilities.filter(id => id !== 'session.manage.v1'),
      } } } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const input = page.locator('[data-composer-input]')
    await input.waitFor({ timeout: 30_000 })
    await page.getByText('This Host cannot currently create sessions', { exact: true }).waitFor()
    const chip = page.getByRole('button', { name: 'Choose workspace', exact: true })
    expect(await chip.count()).toBe(0)
    expect(creations).toEqual([])
    expect({ creations: creations.length, picker: await chip.count(), message: await page.getByText('This Host cannot currently create sessions', { exact: true }).innerText() }).toEqual(expected.initial)
    advertised = true
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(2)
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    await chip.waitFor()
    expect(creations).toEqual([true])
    await input.fill('Draft before workspace capability withdrawal')
    await chip.click()
    await page.getByRole('menuitem', { name: 'workspace', exact: true }).waitFor()
    advertised = false
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(3)
    await expect.poll(() => chip.count()).toBe(0)
    expect(await page.getByRole('menuitem', { name: 'workspace', exact: true }).count()).toBe(0)
    expect(await input.innerText()).toBe('Draft before workspace capability withdrawal')
    expect(creations).toEqual([true])
    expect({ creations: creations.length, picker: await chip.count(), menu: await page.getByRole('menuitem', { name: 'workspace', exact: true }).count(), draft: await input.innerText() }).toEqual(expected.absent)
    await mkdir('.artifacts/workspace-admission-browser', { recursive: true })
    await page.screenshot({ path: '.artifacts/workspace-admission-browser/absent.png', fullPage: true })
    advertised = true
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(4)
    await chip.waitFor()
    expect(await page.getByRole('menuitem', { name: 'workspace', exact: true }).count()).toBe(0)
    await chip.click()
    await page.getByRole('menuitem', { name: 'workspace', exact: true }).click()
    expect(await input.innerText()).toBe('Draft before workspace capability withdrawal')
    expect(creations).toEqual([true])
    expect({ creations: creations.length, picker: await chip.count(), menu: await page.getByRole('menuitem', { name: 'workspace', exact: true }).count(), draft: await input.innerText() }).toEqual(expected.restored)
    await page.screenshot({ path: '.artifacts/workspace-admission-browser/restored.png', fullPage: true })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)


it('withdraws permission settings before rediscovery and keeps a late write in its originating generation', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  const sockets: WebSocketRoute[] = []
  let stage = 'ready'
  let readOnly = false
  let negotiations = 0
  let gate: Promise<void> | undefined
  const discovery = Promise.withResolvers<undefined>()
  const oldWrite = Promise.withResolvers<undefined>()
  let committed = false
  let oldResponseReleased = false
  const writes: string[] = []
  const output = '.artifacts/settings-generation-repair-browser'
  try {
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      await gate
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Settings capability discovery failed')
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      const descriptor = envelope.result.value as HostDescriptor
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !readOnly || id !== 'settings.write.v1'),
      } } } })
    })
    await page.route('**/api/settings/mutate', async (route) => {
      const request = route.request().postDataJSON() as { payload: { args: { ns: string } } }
      if (request.payload.args.ns !== 'permission') throw new Error('unexpected settings mutation')
      writes.push(stage)
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Settings mutation refused')
      if (writes.length === 1) {
        committed = true
        await oldWrite.promise
        oldResponseReleased = true
      }
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const composer = page.locator('[data-composer-input][contenteditable="true"]')
    await composer.waitFor({ timeout: 30_000 })
    await composer.fill('retain settings generation draft')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.waitFor()
    const row = dialog.getByText('Choose the default permission mode for new sessions', { exact: true }).locator('..').locator('..')
    const button = row.getByRole('button')
    const observations: Array<{ stage: string; label: string; disabled: boolean }> = []
    const observe = async (label: string, disabled: boolean) => {
      await expect.poll(() => button.textContent(), { timeout: 30_000 }).toBe(label)
      await expect.poll(() => button.isDisabled()).toBe(disabled)
      observations.push({ stage, label: (await button.textContent())!, disabled: await button.isDisabled() })
    }
    await observe('Workspace Write', false)
    stage = 'old-saving'
    await button.click()
    await page.getByRole('menuitem', { name: 'Read Only', exact: true }).click()
    await expect.poll(() => committed).toBe(true)
    await observe('Workspace Write', true)
    const priorNegotiations = negotiations
    stage = 'withdrawn'
    readOnly = true
    gate = discovery.promise
    await sockets.at(-1)!.close()
    await observe('Loading', true)
    expect(negotiations).toBe(priorNegotiations)
    expect(await page.getByRole('menu').count()).toBe(0)
    stage = 'read-only'
    discovery.resolve(undefined)
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(priorNegotiations + 1)
    await observe('Read Only', true)
    stage = 'restored'
    readOnly = false
    await sockets.at(-1)!.close()
    await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(priorNegotiations + 2)
    await observe('Read Only', false)
    stage = 'new-saving'
    await button.click()
    await page.getByRole('menuitem', { name: 'Workspace Write', exact: true }).click()
    await observe('Workspace Write', false)
    stage = 'late-old'
    oldWrite.resolve(undefined)
    await expect.poll(() => oldResponseReleased).toBe(true)
    await observe('Workspace Write', false)
    expect(writes).toEqual(['old-saving', 'new-saving'])
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('defaultPreset: workspace-write')
    expect(await composer.textContent()).toBe('retain settings generation draft')
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: join(output, 'restored.png'), fullPage: true })
    const actual = JSON.stringify(observations, null, 2) + '\n'
    await writeFile(join(output, 'actual.json'), actual)
    expect(actual).toBe(await readFile(new URL('./expected/host-capability/settings-generation-repair.expected.json', import.meta.url), 'utf8'))
    await writeFile(join(output, 'observation.json'), JSON.stringify({ status: 'PASS', observations, writes,
      realHostMutations: true, discoveryResponsesControlled: true, firstMutationResponseDelayed: true,
      withdrawalBeforeRediscovery: true, noMutationReplay: true, retainedDraft: true,
    }, null, 2) + '\n')
  } catch (error) {
    await mkdir(output, { recursive: true })
    const page = browser?.contexts()[0]?.pages()[0]
    await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true })
    if (page !== undefined) await writeFile(join(output, 'failure-aria.txt'), await page.locator('body').ariaSnapshot())
    throw error
  } finally {
    discovery.resolve(undefined)
    oldWrite.resolve(undefined)
    await browser?.close()
    await scaffold.close()
  }
}, 120_000)

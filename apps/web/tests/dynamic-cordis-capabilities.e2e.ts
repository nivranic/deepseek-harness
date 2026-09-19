/** Real Dynamic Cordis controls with controlled discovery and delayed Stop delivery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type WebSocketRoute } from 'playwright'
import { expect, it, onTestFailed } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { saveFailureShot } from './support.ts'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'

it('separates Dynamic Cordis controls and withdraws page activations and old acknowledgements on reconnect', async () => {
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Browser | undefined
  let operations: string[] = []
  let negotiations = 0
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  let holdStop = false
  let cancelledStops = 0
  const held = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const delivered = Promise.withResolvers<undefined>()
  const output = '.artifacts/dynamic-cordis-ui-browser'
  try {
    scaffold = await launchWebScaffold({ cordisTools: true })
    const path = join(scaffold.workspaceCwd, 'Cordis capability proof')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Cordis fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Cordis capability fixture' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Cordis capability session' })
    const runner = scaffold.ctx.dynamicCordisRunner
    const host = runner.define({ sessionId, plugin: { kind: 'new', idPrefix: 'host' }, name: 'Host proof', purpose: 'Host-only capability proof', code: { host: 'return { apply() {} }' } })
    const clientCode = 'return { inject: ["slots"], apply(ctx) { ctx.slots.register({ name: "shell.overlay", id: "capability-proof" }, () => React.createElement("div", { "data-dynamic-capability-proof": "loaded" })) } }'
    const dual = runner.define({ sessionId, plugin: { kind: 'new', idPrefix: 'dual' }, name: 'Dual proof', purpose: 'Two-half capability proof', code: { host: 'return { apply() {} }', client: clientCode } })
    const second = runner.define({ sessionId, plugin: { kind: 'existing', pluginId: dual.pluginId }, name: 'Dual second', purpose: 'Replacement selection', code: { host: 'return { apply() {} }', client: clientCode } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    onTestFailed(() => saveFailureShot(page, 'dynamic-cordis-ui-failure'))
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (pathname.startsWith('/api/dynamicCordisRunner/')) calls.push(pathname.split('/').at(-1)!)
    })
    page.on('requestfailed', (request) => { if (new URL(request.url()).pathname.endsWith('/stopFromPanel')) cancelledStops++ })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/host/*', async (route) => {
      const response = await route.fetch()
      const envelope = await response.json() as ServerResponse
      if (!envelope.result.ok) throw new Error('Cordis discovery failed')
      const descriptor = envelope.result.value as HostDescriptor
      expect(descriptor.capabilities.filter(id => id.startsWith('dynamic-cordis.'))).toHaveLength(12)
      if (new URL(route.request().url()).pathname.endsWith('/negotiate')) negotiations++
      await route.fulfill({ response, json: { ...envelope, result: { ok: true, value: {
        ...descriptor, capabilities: descriptor.capabilities.filter(id => !id.startsWith('dynamic-cordis.') || operations.some(op => id === 'dynamic-cordis.' + op + '.v1')),
      } } } })
    })
    await page.route('**/api/dynamicCordisRunner/stopFromPanel', async (route) => {
      const response = await route.fetch()
      if (holdStop) { held.resolve(undefined); await release.promise }
      await route.fulfill({ response })
      if (holdStop) delivered.resolve(undefined)
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').filter({ hasText: 'Cordis capability session' }).click({ timeout: 30_000 })
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('retain Cordis draft')
    const badge = page.locator('[data-cordis-badge]')
    const panel = page.locator('[data-cordis-panel]')
    const hostRow = page.locator(`[data-cordis-row="${host.pluginId}"]`)
    const dualRow = page.locator(`[data-cordis-row="${dual.pluginId}"]`)
    const marker = page.locator('[data-dynamic-capability-proof]')
    expect(await badge.count()).toBe(0)
    expect(calls).toEqual([])
    const reconnect = async (next: string[]) => {
      operations = next
      const target = negotiations + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => negotiations, { timeout: 30_000 }).toBe(target)
    }
    const open = async () => { await badge.waitFor(); if (await panel.count() === 0) await badge.click() }
    await reconnect(['inventory'])
    await open()
    await hostRow.waitFor()
    expect(await panel.getByRole('button', { name: /^(Run|Stop|Remove|Decline|Allow)/u }).count()).toBe(0)
    await reconnect(['inventory', 'run'])
    await open()
    expect(await dualRow.getByRole('button', { name: 'Run', exact: true }).count()).toBe(0)
    await hostRow.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(() => runner.inventory().find(row => row.pluginId === host.pluginId)?.activeRun).toBeDefined()
    expect(await hostRow.getByRole('button', { name: 'Stop', exact: true }).count()).toBe(0)
    await reconnect(['inventory', 'stop'])
    await open()
    const firstStop = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/stopFromPanel'))
    await hostRow.getByRole('button', { name: 'Stop', exact: true }).click()
    expect(await (await firstStop).finished()).toBeNull()
    await expect.poll(() => runner.inventory().find(row => row.pluginId === host.pluginId)?.activeRun).toBeUndefined()
    expect(cancelledStops).toBe(0)
    await reconnect(['inventory', 'resolve-run'])
    await runner.run(agent, dual.pluginId, dual.packageId, 'run')
    await open()
    await dualRow.getByRole('button', { name: 'Decline', exact: true }).waitFor()
    expect(await dualRow.locator('[data-cordis-approve]').count()).toBe(0)
    await reconnect(['inventory', 'resolve-run'])
    await open()
    await dualRow.getByRole('button', { name: 'Decline', exact: true }).waitFor()
    expect(await dualRow.locator('[data-cordis-approve]').count()).toBe(0)
    await dualRow.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect.poll(() => calls.filter(call => call === 'resolveRequestRun').length).toBe(1)
    const supported = ['inventory', 'run', 'client-code', 'settle-run', 'stop', 'undefine']
    await reconnect(supported)
    await open()
    await dualRow.locator('select').selectOption(dual.packageId)
    await dualRow.getByRole('button', { name: 'Run', exact: true }).click()
    await marker.waitFor({ state: 'attached' })
    await expect.poll(() => calls.filter(call => call === 'settleUserRun').length).toBe(1)
    const starts = calls.filter(call => call === 'runHostHalf').length
    await reconnect(supported)
    await expect.poll(() => marker.count()).toBe(0)
    await open()
    expect(calls.filter(call => call === 'runHostHalf')).toHaveLength(starts)
    await dualRow.locator('select').selectOption(dual.packageId)
    await dualRow.getByRole('button', { name: 'Run', exact: true }).click()
    await marker.waitFor({ state: 'attached' })
    await expect.poll(() => calls.filter(call => call === 'settleUserRun').length).toBe(2)
    holdStop = true
    await dualRow.getByRole('button', { name: 'Stop', exact: true }).click()
    await held.promise
    await reconnect(supported)
    await expect.poll(() => cancelledStops).toBe(1)
    await open()
    await dualRow.locator('select').selectOption(second.packageId)
    release.resolve(undefined)
    await delivered.promise
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await panel.count()).toBe(1)
    expect(await dualRow.locator('select').inputValue()).toBe(second.packageId)
    expect(await dualRow.getByRole('alert').count()).toBe(0)
    await hostRow.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(() => runner.inventory().some(row => row.pluginId === host.pluginId)).toBe(false)
    expect(await input.textContent()).toBe('retain Cordis draft')
    const mutations = calls.filter(call => call !== 'inventory')
    expect(mutations).toEqual(['runHostHalf', 'stopFromPanel', 'resolveRequestRun', 'runHostHalf', 'getClientCode', 'settleUserRun', 'runHostHalf', 'getClientCode', 'settleUserRun', 'stopFromPanel', 'undefineFromPanel'])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: output + '/restored.png', fullPage: true })
    await reconnect([])
    await expect.poll(() => badge.count()).toBe(0)
    expect(await marker.count()).toBe(0)
    const actual = { noUnsupportedProbe: true, readOnlyControls: true, hostOnlyRunIndependent: true, declineWithoutRun: true,
      pendingDeclineRestoredFromInventory: true,
      clientActivationWithdrawn: true, explicitReattach: true, noAutomaticMutationReplay: true, cancelledStops,
      replacementSelectionRetained: true, staleActionErrorSuppressed: true, composerDraftRetained: true,
      mutations, modelRequests: 0, discoveryControlled: true, stopDeliveryControlled: true }
    await writeFile(output + '/actual.json', JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(await readFile(new URL('./expected/host-capability/dynamic-cordis.expected.json', import.meta.url), 'utf8')))
  } finally {
    release.resolve(undefined)
    try { await browser?.close() } finally { await scaffold?.close() }
  }
}, 180_000)

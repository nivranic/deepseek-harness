/** Real Dynamic Cordis inventory, activation refusals, and delayed Stop acknowledgements. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright'
import { expect, it, onTestFailed } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RemoteEventDownlinkFrame } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import { launchWebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

it('refreshes Dynamic Cordis inventory and retains page activations and pending actions across reconnect', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Browser | undefined
  let page: Page | undefined
  let readyFrames = 0
  let refuseRun = true
  let holdStop = false
  let cancelledStops = 0
  const sockets: WebSocketRoute[] = []
  const calls: string[] = []
  const held = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const output = '.artifacts/dynamic-cordis-ui-browser'
  try {
    const path = join(scaffold.workspaceCwd, 'Cordis lifecycle proof')
    await mkdir(path, { recursive: true })
    const { workspace } = await scaffold.ctx.workspaceController.create({ path })
    const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
    const agent = scaffold.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Cordis fixture has no Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Cordis lifecycle fixture' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await scaffold.ctx.sessionController.rename({ sessionId, title: 'Cordis lifecycle session' })
    const runner = scaffold.ctx.dynamicCordisRunner
    const host = runner.define({ sessionId, plugin: { kind: 'new', idPrefix: 'host' }, name: 'Host proof', purpose: 'Host-only activation proof', code: { host: 'return { apply() {} }' } })
    const clientCode = 'return { inject: ["slots"], apply(ctx) { ctx.slots.register({ name: "shell.overlay", id: "capability-proof" }, () => React.createElement("div", { "data-dynamic-capability-proof": "loaded" })) } }'
    const dual = runner.define({ sessionId, plugin: { kind: 'new', idPrefix: 'dual' }, name: 'Dual proof', purpose: 'Two-half activation proof', code: { host: 'return { apply() {} }', client: clientCode } })
    const second = runner.define({ sessionId, plugin: { kind: 'existing', pluginId: dual.pluginId }, name: 'Dual second', purpose: 'Replacement selection', code: { host: 'return { apply() {} }', client: clientCode } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
    const currentPage = page
    onTestFailed(() => saveFailureShot(currentPage, 'dynamic-cordis-ui-failure'))
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (pathname.startsWith('/api/dynamicCordisRunner/')) calls.push(pathname.split('/').at(-1)!)
    })
    page.on('requestfailed', (request) => { if (new URL(request.url()).pathname.endsWith('/stopFromPanel')) cancelledStops++ })
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(payload.toString()) as { type?: string; value?: RemoteEventDownlinkFrame }
        if (frame.type === 'item' && frame.value?.type === 'ready') readyFrames++
      })
    })
    await page.routeWebSocket('**/api/remote.mux', (socket) => { socket.connectToServer(); sockets.push(socket) })
    await page.route('**/api/dynamicCordisRunner/runHostHalf', async (route) => {
      if (!refuseRun) {
        await route.continue()
        return
      }
      const request = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result: {
        ok: false, error: { code: 'future/cordis-unavailable', message: 'Host activation unavailable', details: {} },
      } } })
    })
    await page.route('**/api/dynamicCordisRunner/stopFromPanel', async (route) => {
      const response = await route.fetch()
      if (holdStop) {
        held.resolve(undefined)
        await release.promise
      }
      await route.fulfill({ response })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').filter({ hasText: 'Cordis lifecycle session' }).click({ timeout: 30_000 })
    await expect.poll(() => readyFrames).toBe(1)
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.fill('retain Cordis draft')
    const badge = page.locator('[data-cordis-badge]')
    const panel = page.locator('[data-cordis-panel]')
    const hostRow = page.locator(`[data-cordis-row="${host.pluginId}"]`)
    const dualRow = page.locator(`[data-cordis-row="${dual.pluginId}"]`)
    const marker = page.locator('[data-dynamic-capability-proof]')
    const reconnect = async () => {
      const target = readyFrames + 1
      await sockets.at(-1)!.close()
      await expect.poll(() => readyFrames, { timeout: 10_000 }).toBe(target)
    }
    const open = async () => {
      await badge.waitFor()
      if (await panel.count() === 0) await badge.click()
    }
    await open()
    await hostRow.waitFor()
    await dualRow.getByRole('button', { name: 'Run', exact: true }).waitFor()
    await hostRow.getByRole('button', { name: 'Run', exact: true }).click()
    await hostRow.getByRole('alert').waitFor()
    const refusal = await hostRow.getByRole('alert').textContent()
    expect(refusal).toContain('future/cordis-unavailable')
    expect(refusal).toContain('Host activation unavailable')
    expect(runner.inventory().find(row => row.pluginId === host.pluginId)?.activeRun).toBeUndefined()
    expect(calls.filter(call => call === 'runHostHalf')).toHaveLength(1)
    expect(await input.textContent()).toBe('retain Cordis draft')
    refuseRun = false
    await hostRow.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(() => runner.inventory().find(row => row.pluginId === host.pluginId)?.activeRun).toBeDefined()
    await expect.poll(() => hostRow.getByRole('alert').count()).toBe(0)
    expect(calls.filter(call => call === 'getClientCode' || call === 'settleUserRun')).toEqual([])
    await hostRow.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(() => runner.inventory().find(row => row.pluginId === host.pluginId)?.activeRun).toBeUndefined()
    const pending = await runner.run(agent, dual.pluginId, dual.packageId, 'run')
    expect(pending).toMatchObject({ ok: true, status: 'awaiting-approval' })
    await dualRow.getByRole('button', { name: 'Decline', exact: true }).waitFor()
    await reconnect()
    await open()
    await dualRow.getByRole('button', { name: 'Decline', exact: true }).waitFor()
    expect(await dualRow.locator('[data-cordis-approve]').count()).toBe(1)
    const runsBeforeDecline = calls.filter(call => call === 'runHostHalf').length
    await dualRow.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect.poll(() => runner.inventory().find(row => row.pluginId === dual.pluginId)?.latestRun?.status).toBe('rejected')
    await expect.poll(() => panel.count()).toBe(0)
    expect(calls.filter(call => call === 'runHostHalf')).toHaveLength(runsBeforeDecline)
    expect(await marker.count()).toBe(0)
    await open()
    await dualRow.locator('select').selectOption(dual.packageId)
    await dualRow.getByRole('button', { name: 'Run', exact: true }).click()
    await marker.waitFor({ state: 'attached' })
    await expect.poll(() => calls.filter(call => call === 'settleUserRun').length).toBe(1)
    const startedRun = runner.inventory().find(row => row.pluginId === dual.pluginId)?.activeRun?.pluginRunId
    expect(startedRun).toBeDefined()
    const starts = calls.filter(call => call === 'runHostHalf').length
    await reconnect()
    await open()
    await dualRow.waitFor()
    expect(await marker.count()).toBe(1)
    expect(runner.inventory().find(row => row.pluginId === dual.pluginId)?.activeRun?.pluginRunId).toBe(startedRun)
    expect(calls.filter(call => call === 'runHostHalf')).toHaveLength(starts)
    await dualRow.locator('select').selectOption(second.packageId)
    holdStop = true
    await dualRow.getByRole('button', { name: 'Stop', exact: true }).click()
    await held.promise
    expect(runner.inventory().find(row => row.pluginId === dual.pluginId)?.activeRun).toBeUndefined()
    await marker.waitFor({ state: 'detached' })
    await reconnect()
    await open()
    await dualRow.waitFor()
    expect(await dualRow.locator('select').inputValue()).toBe(second.packageId)
    expect(await dualRow.locator('select').isDisabled()).toBe(true)
    release.resolve(undefined)
    await expect.poll(() => dualRow.locator('select').isDisabled()).toBe(false)
    expect(await dualRow.locator('select').inputValue()).toBe(second.packageId)
    expect(await dualRow.getByRole('alert').count()).toBe(0)
    expect(cancelledStops).toBe(0)
    await hostRow.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(() => runner.inventory().some(row => row.pluginId === host.pluginId)).toBe(false)
    expect(await input.textContent()).toBe('retain Cordis draft')
    const mutations = calls.filter(call => call !== 'inventory' && call !== 'syncInspectManifest')
    expect(mutations).toEqual(['runHostHalf', 'runHostHalf', 'stopFromPanel', 'resolveRequestRun', 'runHostHalf', 'getClientCode', 'settleUserRun', 'stopFromPanel', 'undefineFromPanel'])
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: `${output}/restored.png`, fullPage: true })
    const actual = { refusal, refusalHasNoActivation: true, hostOnlyRunIndependent: true, declineWithoutActivation: true,
      pendingApprovalRetainedAcrossReconnect: true, clientActivationRetainedAcrossReconnect: true,
      noAutomaticMutationReplay: true, cancelledStops, selectionRetainedAcrossLateStop: true,
      lateStopAcknowledged: true, composerDraftRetained: true, mutations }
    await writeFile(`${output}/actual.json`, JSON.stringify(actual, null, 2) + '\n')
    const expected: unknown = JSON.parse(await readFile(new URL('./expected/host-capability/dynamic-cordis.expected.json', import.meta.url), 'utf8'))
    expect(actual).toEqual(expected)
  } finally {
    release.resolve(undefined)
    await page?.unrouteAll({ behavior: 'wait' })
    await browser?.close()
    await scaffold.close()
  }
}, 180_000)

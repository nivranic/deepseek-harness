/** Cordis dynamic-plugin cards, inventory panel, business-view host, and `@pluginId` source. */

import { createElement } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { InputTriggerService, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from './events.ts'
import { CordisActionRow } from './CordisActionRow.tsx'
import { CordisDefineRow } from './CordisDefineRow.tsx'
import { CordisRunRow } from './CordisRunRow.tsx'
import { CordisPanel, type CordisPanelProps } from './CordisPanel.tsx'
import { createCordisInventory } from './inventory.ts'
import { CordisRunCardRegistry } from './run-card-index.ts'
import type { CordisDynamicPort } from './dynamic-port.ts'
import type { CordisCardFace, CordisPanelFace, CordisRunCardFace } from './slots.ts'
import { en, NS, zh } from './locales.ts'

export type { CordisCardFace, CordisPanelFace, CordisRunCardFace, CordisToolViewOwnerProps } from './slots.ts'
export type { CordisActionResult, CordisDynamicPort, CordisInventoryRow } from './dynamic-port.ts'
export type { CordisDefineRowProps } from './CordisDefineRow.tsx'
export type { CordisActionRowProps } from './CordisActionRow.tsx'
export type { CordisRunRowProps } from './CordisRunRow.tsx'
export type {
  CordisRunCardPointer, CordisRunCardStore, CordisToolViewKey,
} from './run-card-index.ts'
export type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  DynamicCordisInventoryRow, DynamicCordisPackage, DynamicCordisRetracted,
} from './events.ts'
export type { CordisKey } from './locales.ts'

/** Required services for the two Tool cards, panel, Remote lifecycle, and Slash source. */
export const inject = [
  'slots', 'locale', 'inputTriggers', 'remote', 'remote.dynamicCordisRunner', 'dynamicCordisRunner', 'connection',
]

/** Mount every Cordis browser surface over the shared Host inventory. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-cordis: dictionaries')

  const lifetime = { disposed: false }
  const connection = ctx.get('connection') as ConnectionHandle
  const currentHost = () => ctx.remote.$host
  const supports = (operation: string): boolean => !lifetime.disposed
    && currentHost().capabilities?.includes('dynamic-cordis.' + operation + '.v1') === true
  const requireSupport = (operation: string): void => {
    if (!supports(operation)) throw new Error('Dynamic Cordis operation unavailable: ' + operation)
  }
  const requireHost = (host: ReturnType<typeof currentHost>): void => {
    if (lifetime.disposed || currentHost() !== host) throw new Error('Dynamic Cordis connection changed')
  }
  const port: CordisDynamicPort = {
    stop: async (sessionId, pluginId) => {
      requireSupport('stop')
      const host = currentHost()
      const answered = await ctx.remote.dynamicCordisRunner.stopFromPanel(sessionId, pluginId)
      requireHost(host)
      if (!answered.ok) return { ok: false, message: `${answered.error.code}: ${answered.error.message}` }
      if (answered.value.ok || answered.value.reason === 'not-running') return { ok: true }
      return { ok: false, message: answered.value.message }
    },
    remove: async (sessionId, pluginId) => {
      requireSupport('undefine')
      const host = currentHost()
      const answered = await ctx.remote.dynamicCordisRunner.undefineFromPanel(sessionId, pluginId)
      requireHost(host)
      if (!answered.ok) return { ok: false, message: `${answered.error.code}: ${answered.error.message}` }
      return answered.value.ok ? { ok: true } : { ok: false, message: answered.value.message }
    },
    inventory: async () => {
      requireSupport('inventory')
      const host = currentHost()
      const answered = await ctx.remote.dynamicCordisRunner.inventory()
      requireHost(host)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
  }
  const inventory = createCordisInventory(port, (error) => {
    console.error('[ui-cordis] reading the Cordis inventory failed:', error)
  })
  const refreshInventory = (): void => { if (supports('inventory')) inventory.refresh() }
  ctx.effect(() => () => { lifetime.disposed = true; inventory.dispose() }, 'ui-cordis: inventory lifetime')
  const runner = ctx.dynamicCordisRunner
  const loaded = { getSnapshot: () => runner.getSnapshot(), subscribe: (fn: () => void) => runner.subscribe(fn) }
  const runCards = new CordisRunCardRegistry()

  ctx.effect(() => inventory.subscribe(() => {
    const snapshot = inventory.getSnapshot()
    if (snapshot.read) runner.reconcileApprovals(snapshot.rows)
  }), 'ui-cordis: reconcile pending approvals')

  ctx.remote.$on('cordis/dynamic-package', () => { refreshInventory() })
  ctx.remote.$on('cordis/dynamic-retract', () => { refreshInventory() })
  ctx.remote.$on('cordis/request-run', (request) => {
    if (!inventory.getSnapshot().rows.some(row => row.pluginId === request.pluginId)) refreshInventory()
  })
  ctx.remote.$on('cordis/request-run-resolved', () => { refreshInventory() })
  ctx.effect(() => connection.generation.subscribe(() => {
    inventory.reset()
    refreshInventory()
  }), 'ui-cordis: inventory connection')

  ctx.slots.inject('sidebar.footer.action', () => {
    let remove: (() => void) | undefined
    const register = (): void => {
      remove?.()
      remove = undefined
      if (!supports('inventory')) return
      const host = currentHost()
      let alive = true
      const current = (): boolean => alive && !lifetime.disposed && currentHost() === host
      const requireCurrent = (): void => { if (!current()) throw new Error('Dynamic Cordis connection changed') }
      const supported = (operation: string): boolean => host.capabilities?.includes('dynamic-cordis.' + operation + '.v1') === true
      const canRun = (client: boolean): boolean => supported('run')
        && (!client || supported('client-code') && supported('settle-run'))
      const PanelForConnection = (props: CordisPanelProps) => createElement(CordisPanel, props)
      const unregister = ctx.slots.register({
        name: 'sidebar.footer.action', id: 'cordis-panel', locale: NS,
        inject: (): CordisPanelFace => ({
          current, canRun, canApprove: ['run', 'client-code', 'resolve-run'].every(supported),
          canDecline: supported('resolve-run'), canStop: supported('stop'), canRemove: supported('undefine'),
          hooks: {
            inventory, activeRuns: runner.activeRuns, runErrors: runner.lastRunError, loaded, renderFailures: runner.renderFailures,
          },
          onApprove: async (requestId, future) => {
            requireCurrent()
            await runner.approve(requestId, future)
            requireCurrent()
          },
          onDecline: async (requestId) => {
            requireCurrent()
            await runner.decline(requestId)
            requireCurrent()
          },
          onRun: async (request) => {
            requireCurrent()
            await runner.startUserRun(request)
            requireCurrent()
          },
          onStop: async (sessionId, pluginId) => {
            requireCurrent()
            const result = await port.stop(sessionId, pluginId)
            requireCurrent()
            refreshInventory()
            return result
          },
          onRemove: async (sessionId, pluginId) => {
            requireCurrent()
            const result = await port.remove(sessionId, pluginId)
            requireCurrent()
            if (result.ok) inventory.retire(pluginId)
            refreshInventory()
            return result
          },
          onRefresh: () => { if (current()) refreshInventory() },
        }),
      }, PanelForConnection)
      remove = () => { alive = false; unregister() }
    }
    register()
    const stop = connection.generation.subscribe(register)
    return () => { stop(); remove?.() }
  })

  const cardFace = (): CordisCardFace => ({ hooks: { inventory, loaded } })
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'cordis_define',
    locale: NS,
    inject: cardFace,
  }, CordisDefineRow))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'cordis_run',
    locale: NS,
    children: { 'tool.view.cordis': { kind: 'keyed', scope: 'session' } },
    inject: (sessionId: SessionId): CordisRunCardFace => {
      const store = runCards.forSession(sessionId)
      return {
        hooks: { inventory, loaded, runCards: store, activeRuns: runner.activeRuns },
        onObserveRunCard: (pointer) => { store.observe(pointer) },
      }
    },
  }, CordisRunRow))

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'cordis_stop', locale: NS,
    }, CordisActionRow)
    yield ctx.slots.register({
      name: 'tool.call.toolview', key: 'cordis_undefine', locale: NS,
    }, CordisActionRow)
  })

  const rowsOf = (sessionId: SessionId, query: string) => inventory.getSnapshot().rows
    .filter(row => row.agentId === sessionId && String(row.pluginId).includes(query))
  const slash = ctx.get('inputTriggers') as InputTriggerService
  ctx.effect(() => {
    let remove: (() => void) | undefined
    const register = (): void => {
      remove?.()
      remove = undefined
      if (!supports('inventory')) return
      const host = currentHost()
      let alive = true
      const current = (): boolean => alive && !lifetime.disposed && currentHost() === host
      const source: InputTriggerSource = {
        trigger: '@',
        name: 'cordis',
        order: 1,
        candidates(session, { query }) {
          const rows = current() ? rowsOf(session.sessionId, query) : []
          return Promise.resolve(rows.map((row) => {
            const packageId = row.nextPackageId ?? row.currentPackageId ?? row.packages.at(-1)?.packageId
            const pkg = packageId === undefined ? undefined : row.packages.find(candidate => candidate.packageId === packageId)
            return {
              name: String(row.pluginId),
              ...pkg === undefined ? {} : { description: pkg.purpose },
            }
          }))
        },
        warm() { if (current()) refreshInventory() },
        lexicon(session) { return (current() ? rowsOf(session.sessionId, '') : []).map(row => String(row.pluginId)) },
        subscribeLexicon(_session, listener) { return inventory.subscribe(listener) },
        onPick({ candidate }) { return current() ? { text: `@${candidate.name} ` } : undefined },
      }
      const unregister = slash.registerSource(source)
      remove = () => { alive = false; unregister() }
    }
    register()
    const stop = connection.generation.subscribe(register)
    return () => { stop(); remove?.() }
  }, 'ui-cordis: @pluginId source')

  refreshInventory()
}

/** §41 health/readiness and §42 sanitized diagnostics payload over the Host owner. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { sessionFormatV0ToV1 } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { sessionFormatV1ToV2 } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import { HostDiagnosticsService } from '../src/index.ts'

const descriptor = (): HostDescriptor => ({
  hostId: 'host-1' as HostDescriptor['hostId'],
  displayName: 'Fixture Host',
  productVersion: '0.0.0-fixture',
  apiProtocolVersion: 1,
  sessionFormatVersion: 3,
  platform: 'linux',
  arch: 'x64',
  runtimeMode: 'full',
  capabilities: ['host.describe.v1'],
  transports: ['websocket'],
  serverTime: 0,
})

interface Bench {
  readonly ctx: Context
  readonly service: HostDiagnosticsService
}

function bench(install?: (ctx: Context) => void): Bench {
  const ctx = new Context()
  ctx.provide('hostDescription', { describe: descriptor })
  install?.(ctx)
  const service = new HostDiagnosticsService(ctx)
  return { ctx, service }
}

describe('HostDiagnosticsService', () => {
  it('reports every component up and ready when the core owners are composed', () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', {})
      ctx.provide('webServer', {})
    })
    const health = service.health()
    expect(health.process.state).toBe('up')
    expect(health.runtime.state).toBe('up')
    expect(health.sessionStore).toEqual({ state: 'up', detail: 'sessionPersistence is composed' })
    expect(health.pluginState.state).toBe('up')
    expect(health.connection.state).toBe('up')
    expect(health.modelProvider.state).toBe('up')
    expect(health.ready).toBe(true)
  })

  it('keeps readiness true without a webserver — a carrier-less profile is still a Host', () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', {})
    })
    const health = service.health()
    expect(health.connection).toEqual({
      state: 'down',
      detail: 'webServer is not composed',
    })
    expect(health.ready).toBe(true)
  })

  it('names the missing owner per component and drops readiness with it', () => {
    const { service } = bench()
    const health = service.health()
    expect(health.sessionStore).toEqual({ state: 'down', detail: 'sessionPersistence is not composed' })
    expect(health.pluginState.state).toBe('down')
    expect(health.modelProvider.state).toBe('down')
    expect(health.ready).toBe(false)
  })

  it('composes the §42 payload from descriptor, inventory, and the released migration chain', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', {})
      ctx.provide('pluginInventory', {
        list: async () => ({
          entries: [
            { moduleName: '@deepseek-ai/dsh-llm', enabled: true, fiberPhase: 'active' },
            { moduleName: '@fixture/retired', enabled: false, fiberPhase: 'disposed' },
          ],
        }),
      })
    })
    const snapshot = await service.describe()
    expect(snapshot.productVersion).toBe('0.0.0-fixture')
    expect(snapshot.sessionFormatVersion).toBe(3)
    expect(snapshot.platform).toBe('linux')
    expect(snapshot.runtimeMode).toBe('full')
    expect(snapshot.nodeVersion).toBe(process.version)
    expect(snapshot.plugins).toEqual([
      { moduleName: '@deepseek-ai/dsh-llm', enabled: true, fiberPhase: 'active' },
      { moduleName: '@fixture/retired', enabled: false, fiberPhase: 'disposed' },
    ])
    expect(snapshot.migrations).toEqual([
      { name: sessionFormatV0ToV1.name, fromVersion: 0, toVersion: 1 },
      { name: sessionFormatV1ToV2.name, fromVersion: 1, toVersion: 2 },
      { name: sessionFormatV2ToV3.name, fromVersion: 2, toVersion: 3 },
    ])
    expect(snapshot.crash).toEqual([])
    expect(snapshot.lastErrors).toEqual([])
    expect(snapshot.health.ready).toBe(true)
  })

  it('enumerates exactly the §42 field set — sanitized by construction, no secret channel', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', {})
    })
    const snapshot = await service.describe()
    expect(Object.keys(snapshot).sort()).toEqual([
      'apiProtocolVersion', 'arch', 'capabilities', 'crash', 'health', 'hostId',
      'lastErrors', 'migrations', 'nodeVersion', 'platform', 'plugins',
      'productVersion', 'runtimeMode', 'sessionFormatVersion', 'transports',
    ])
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/api[-_]?key|bearer|secret|credential|password/iu)
  })

  it('fails loud when the host description owner is not composed', async () => {
    const ctx = new Context()
    const service = new HostDiagnosticsService(ctx)
    await expect(service.describe()).rejects.toMatchObject({
      code: 'gateway/service-unavailable',
      details: { endpoint: 'hostDiagnostics/describe' },
    })
  })
})

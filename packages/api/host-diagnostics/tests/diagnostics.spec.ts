/** §41 health/readiness, §42 sanitized payload with crash/last-error recording, and the §43 bundle over the Host owner. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { sessionFormatV0ToV1 } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { sessionFormatV1ToV2 } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import { HostDiagnosticsService, buildSupportBundle, sessionHeadersBundleEntry, validateSupportBundle } from '../src/index.ts'
import type { SessionHeaderRow } from '../src/index.ts'
import type { DiagnosticsErrorFact } from '../src/index.ts'
import { MAX_CRASH_FACTS, MAX_LAST_ERROR_FACTS } from '../src/recorder.ts'

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
  readonly home: string
}

const homes: string[] = []
afterAll(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** A pid far outside any live process's range, so the boot scan reads it as a dead run. */
const DEAD_PID = 4_194_303

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-diagnostics-home-'))
  homes.push(home)
  return home
}

function boot(install: ((ctx: Context) => void) | undefined, home: string, provideDescription = true): Bench {
  // The recorder resolves $DSH_HOME at construction; pin the bench's home for
  // that window so marker state never touches ~/.dsh or leak between tests.
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const ctx = new Context()
    if (provideDescription) ctx.provide('hostDescription', { describe: descriptor })
    install?.(ctx)
    const service = new HostDiagnosticsService(ctx)
    return { ctx, service, home }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

function bench(install?: (ctx: Context) => void): Bench {
  return boot(install, freshHome())
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
    const { service } = boot(undefined, freshHome(), false)
    await expect(service.describe()).rejects.toMatchObject({
      code: 'gateway/service-unavailable',
      details: { endpoint: 'hostDiagnostics/describe' },
    })
  })
})

describe('Crash and last-error recorder (§42)', () => {
  it('records normalized agent errors into the ring from the agent error relay', async () => {
    const { ctx, service } = bench()
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 3, step: 2, error: new TypeError('boom') })
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 4, step: 1, error: 'plain failure' })
    const snapshot = await service.describe()
    const anyTime = expect.any(Number) as number
    expect(snapshot.lastErrors).toEqual([
      { time: anyTime, name: 'TypeError', message: 'boom', agentId: 'agent-1', turn: 3, step: 2 },
      { time: anyTime, name: 'Error', message: 'plain failure', agentId: 'agent-1', turn: 4, step: 1 },
    ] satisfies DiagnosticsErrorFact[])
  })

  it('keeps only the newest MAX_LAST_ERROR_FACTS errors', async () => {
    const { ctx, service } = bench()
    for (let index = 0; index < MAX_LAST_ERROR_FACTS + 3; index++) {
      ctx.emit('agent/error', { agent: { id: `agent-${index}` } as Agent, turn: 1, step: 1, error: new Error(`e${index}`) })
    }
    const snapshot = await service.describe()
    expect(snapshot.lastErrors).toHaveLength(MAX_LAST_ERROR_FACTS)
    expect(snapshot.lastErrors[0]?.agentId).toBe('agent-3')
    expect(snapshot.lastErrors.at(-1)?.message).toBe(`e${MAX_LAST_ERROR_FACTS + 2}`)
  })

  it('detects an unclean previous shutdown at boot and persists the crash log', async () => {
    const home = freshHome()
    writeFileSync(join(home, 'diagnostics-crash.marker'), `${JSON.stringify({ pid: DEAD_PID, runStartedAt: 123 })}\n`)
    const { service } = boot(undefined, home)
    const snapshot = await service.describe()
    expect(snapshot.crash).toEqual([{ pid: DEAD_PID, runStartedAt: 123 }])
    expect(JSON.parse(readFileSync(join(home, 'diagnostics-crash-log.json'), 'utf8'))).toEqual([{ pid: DEAD_PID, runStartedAt: 123 }])
    const marker = JSON.parse(readFileSync(join(home, 'diagnostics-crash.marker'), 'utf8')) as { pid: number }
    expect(marker.pid).toBe(process.pid)
  })

  it('treats a marker whose pid still lives as a concurrent run, not a crash', async () => {
    const home = freshHome()
    writeFileSync(join(home, 'diagnostics-crash.marker'), `${JSON.stringify({ pid: process.pid, runStartedAt: 123 })}\n`)
    const { service } = boot(undefined, home)
    expect((await service.describe()).crash).toEqual([])
  })

  it('an unparsable marker still records an unclean shutdown with the file mtime', async () => {
    const home = freshHome()
    writeFileSync(join(home, 'diagnostics-crash.marker'), 'not-json')
    const { service } = boot(undefined, home)
    const crash = (await service.describe()).crash
    expect(crash).toHaveLength(1)
    expect(crash[0]?.pid).toBe(0)
    expect(crash[0]?.runStartedAt).toBeGreaterThan(0)
  })

  it('clean disposal removes the boot marker so the next boot records no crash', async () => {
    const home = freshHome()
    const first = boot(undefined, home)
    await first.ctx.fiber.dispose()
    expect(existsSync(join(home, 'diagnostics-crash.marker'))).toBe(false)
    const second = boot(undefined, home)
    expect((await second.service.describe()).crash).toEqual([])
  })

  it('keeps the durable crash log capped at MAX_CRASH_FACTS across boots', async () => {
    const home = freshHome()
    const full = Array.from({ length: MAX_CRASH_FACTS }, (_, index) => ({ pid: 4_000_000 + index, runStartedAt: index }))
    writeFileSync(join(home, 'diagnostics-crash-log.json'), JSON.stringify(full))
    writeFileSync(join(home, 'diagnostics-crash.marker'), `${JSON.stringify({ pid: DEAD_PID, runStartedAt: 123 })}\n`)
    const { service } = boot(undefined, home)
    const crash = (await service.describe()).crash
    expect(crash).toHaveLength(MAX_CRASH_FACTS)
    expect(crash[0]).toEqual({ pid: 4_000_001, runStartedAt: 1 })
    expect(crash.at(-1)).toEqual({ pid: DEAD_PID, runStartedAt: 123 })
  })

  it('a snapshot carrying recorder facts stays bundle-valid and sanitized', async () => {
    const { ctx, service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', { list: async () => [] })
      ctx.provide('loader', {})
      ctx.provide('llm', {})
    })
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 1, step: 1, error: new Error('boom') })
    const bundle = await service.supportBundle()
    expect(() => { validateSupportBundle(bundle) }).not.toThrow()
    const serialized = JSON.stringify(bundle)
    expect(serialized).toContain('boom')
    expect(serialized).not.toMatch(/api[-_]?key|bearer|secret|credential|password/iu)
  })
})

describe('Support bundle (§43)', () => {
  it('produces a deterministic, collector-valid bundle with chained checksums', () => {
    const entry = { kind: 'diagnostics' as const, path: 'diagnostics.json', content: { b: 2, a: 1 } }
    const other = { kind: 'session-headers' as const, path: 'headers.json', content: { rows: [] } }
    const first = buildSupportBundle([entry, other])
    const second = buildSupportBundle([other, entry])
    // Input order never leaks: entries and manifest sort by path.
    expect(second).toEqual(first)
    expect(first.manifest.map(row => row.path)).toEqual(['diagnostics.json', 'headers.json'])
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/u)
    expect(() => { validateSupportBundle(first) }).not.toThrow()
    expect(() => { validateSupportBundle(second) }).not.toThrow()
  })

  it('refuses secret-shaped keys at any depth, duplicate paths, and open kinds', () => {
    expect(() => buildSupportBundle([
      { kind: 'diagnostics', path: 'leak.json', content: { health: { apiKey: 'x' } } },
    ])).toThrow(/secret-shaped key "apiKey"/u)
    expect(() => buildSupportBundle([
      { kind: 'diagnostics', path: 'a.json', content: {} },
      { kind: 'diagnostics', path: 'a.json', content: {} },
    ])).toThrow(/duplicated/u)
    expect(() => buildSupportBundle([
      { kind: 'logs' as 'diagnostics', path: 'a.json', content: {} },
    ])).toThrow(/closed vocabulary/u)
  })

  it('collector validation fails loud on tampered entries and checksums', () => {
    const bundle = buildSupportBundle([
      { kind: 'diagnostics', path: 'diagnostics.json', content: { ready: true } },
    ])
    const tamperedEntry = {
      ...bundle,
      entries: [{ ...bundle.entries[0]!, content: { ready: false } }],
    }
    expect(() => { validateSupportBundle(tamperedEntry) }).toThrow(/fails its checksum/u)
    const tamperedChain = { ...bundle, checksum: '0'.repeat(64) }
    expect(() => { validateSupportBundle(tamperedChain) }).toThrow(/chained checksum/u)
    const short = { ...bundle, manifest: [] }
    expect(() => { validateSupportBundle(short) }).toThrow(/disagree in count/u)
  })

  it('the service bundles its own §42 snapshot as a collector-valid artifact', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', { list: async () => [] })
      ctx.provide('loader', {})
      ctx.provide('llm', {})
    })
    const bundle = await service.supportBundle()
    expect(bundle.entries).toHaveLength(1)
    expect(bundle.entries[0]?.kind).toBe('diagnostics')
    expect(bundle.entries[0]?.path).toBe('diagnostics.json')
    expect(() => { validateSupportBundle(bundle) }).not.toThrow()
    expect(JSON.stringify(bundle)).not.toMatch(/api[-_]?key|bearer|secret|credential/iu)
  })
})

describe('Session-headers bundle entry (§43)', () => {
  interface ListedSession {
    readonly header: {
      readonly id: string
      readonly createdAt: number
      readonly cwd?: string
      readonly parentSession?: string
      readonly isSeeded: boolean
    }
    readonly revision: string
    readonly eventCount?: number
    readonly sizeBytes?: number
  }

  const listing = (): ListedSession[] => [
    { header: { id: 's-2', createdAt: 200, cwd: '/w/b', isSeeded: true }, revision: 'r2', eventCount: 4, sizeBytes: 512 },
    { header: { id: 's-1', createdAt: 100, parentSession: 's-0', isSeeded: false }, revision: 'r1' },
  ]

  it('adds a session-headers entry with id-sorted rows when a store holds sessions', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', { list: async () => listing() })
    })
    const bundle = await service.supportBundle()
    expect(bundle.entries.map(entry => entry.path)).toEqual(['diagnostics.json', 'session-headers.json'])
    expect(bundle.entries[1]?.kind).toBe('session-headers')
    expect(bundle.entries[1]?.content).toEqual({
      sessions: [
        { id: 's-1', createdAt: 100, parentSession: 's-0', isSeeded: false, revision: 'r1' },
        { id: 's-2', createdAt: 200, cwd: '/w/b', isSeeded: true, eventCount: 4, sizeBytes: 512, revision: 'r2' },
      ],
    })
    expect(() => { validateSupportBundle(bundle) }).not.toThrow()
    expect(JSON.stringify(bundle)).not.toMatch(/api[-_]?key|bearer|secret|credential|password/iu)
  })

  it('keeps the bundle diagnostics-only without a store and with an empty store', async () => {
    const withoutStore = await bench().service.supportBundle()
    expect(withoutStore.entries).toHaveLength(1)
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', { list: async () => [] })
    })
    const empty = await service.supportBundle()
    expect(empty.entries).toHaveLength(1)
    expect(empty.entries[0]?.path).toBe('diagnostics.json')
  })

  it('store listing order never leaks — rows sort by id', () => {
    const rows: SessionHeaderRow[] = [
      { id: 'z-1', createdAt: 1, isSeeded: false, revision: 'a' },
      { id: 'a-1', createdAt: 2, isSeeded: false, revision: 'b' },
    ]
    const entry = sessionHeadersBundleEntry(rows)
    expect((entry.content as { sessions: { id: string }[] }).sessions.map(row => row.id)).toEqual(['a-1', 'z-1'])
    const again = sessionHeadersBundleEntry([...rows].reverse())
    expect(again.content).toEqual(entry.content)
  })
})

/** §41 health/readiness, §42 sanitized payload with crash recording, §43 bundle, §44 crash-facts egress. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionTelemetryRecord, TelemetryConsent } from '@deepseek-ai/dsh-session-telemetry'
import { sessionFormatV0ToV1 } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { sessionFormatV1ToV2 } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'
import { HostDiagnosticsService, buildSupportBundle, sessionHeadersBundleEntry, settingsExportBundleEntry, validateSupportBundle } from '../src/index.ts'
import type { SessionHeaderRow, SettingsExportRow } from '../src/index.ts'
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
  it('reports every component up and ready when the core owners are composed', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
      ctx.provide('webServer', {})
    })
    const health = await service.health()
    expect(health.process.state).toBe('up')
    expect(health.runtime.state).toBe('up')
    expect(health.sessionStore).toEqual({ state: 'up', detail: 'sessionPersistence is composed' })
    expect(health.pluginState.state).toBe('up')
    expect(health.connection.state).toBe('up')
    expect(health.modelProvider.state).toBe('up')
    expect(health.ready).toBe(true)
  })

  it('keeps readiness true without a webserver — a carrier-less profile is still a Host', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
    })
    const health = await service.health()
    expect(health.connection).toEqual({
      state: 'down',
      detail: 'webServer is not composed',
    })
    expect(health.ready).toBe(true)
  })

  it('names the missing owner per component and drops readiness with it', async () => {
    const { service } = bench()
    const health = await service.health()
    expect(health.sessionStore).toEqual({ state: 'down', detail: 'sessionPersistence is not composed' })
    expect(health.pluginState.state).toBe('down')
    expect(health.modelProvider.state).toBe('down')
    expect(health.ready).toBe(false)
  })

  it('composes the §42 payload from descriptor, inventory, and the released migration chain', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
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
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
    })
    const snapshot = await service.describe()
    expect(Object.keys(snapshot).sort()).toEqual([
      'apiProtocolVersion', 'arch', 'capabilities', 'crash', 'health', 'hostId',
      'lastErrors', 'migrations', 'nodeVersion', 'platform', 'plugins',
      'productVersion', 'runtimeMode', 'sessionFormatVersion', 'sourceRevision',
      'transports',
    ])
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/api[-_]?key|bearer|secret|credential|password/iu)
  })

  it('reports the release-stamped revision and falls back to the honest source-tree marker', async () => {
    const { service } = bench()
    const previous = process.env.DSH_BUILD_REVISION
    try {
      delete process.env.DSH_BUILD_REVISION
      await expect(service.describe()).resolves.toMatchObject({ sourceRevision: 'source-tree' })
      process.env.DSH_BUILD_REVISION = '0123456789abcdef0123456789abcdef01234567'
      await expect(service.describe()).resolves.toMatchObject({ sourceRevision: '0123456789abcdef0123456789abcdef01234567' })
    } finally {
      if (previous === undefined) delete process.env.DSH_BUILD_REVISION
      else process.env.DSH_BUILD_REVISION = previous
    }
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
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
    })
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 1, step: 1, error: new Error('boom') })
    const bundle = await service.supportBundle()
    expect(() => { validateSupportBundle(bundle) }).not.toThrow()
    const serialized = JSON.stringify(bundle)
    expect(serialized).toContain('boom')
    expect(serialized).not.toMatch(/api[-_]?key|bearer|secret|credential|password/iu)
  })
})

describe('Crash-facts telemetry egress (§44)', () => {
  /** A fake session-telemetry owner capturing emits, injected through the boot install hook like every optional owner. */
  function telemetrySink(crashDiagnostics: boolean) {
    const emitted: SessionTelemetryRecord[] = []
    const owner = {
      consent: {
        sessionTelemetry: false,
        providerMetadata: false,
        relayMetadata: false,
        deviceTrustMetadata: false,
        crashDiagnostics,
      } satisfies TelemetryConsent,
      emit: (record: SessionTelemetryRecord) => {
        emitted.push(record)
      },
    }
    return { owner, emitted }
  }

  /** A home whose marker names a dead pid, so the boot scan detects one unclean shutdown. */
  function crashHome(): string {
    const home = freshHome()
    writeFileSync(join(home, 'diagnostics-crash.marker'), `${JSON.stringify({ pid: DEAD_PID, runStartedAt: 123 })}\n`)
    return home
  }

  it('an unclean boot without the telemetry owner records locally and never throws', async () => {
    const { service } = boot(undefined, crashHome())
    expect((await service.describe()).crash).toEqual([{ pid: DEAD_PID, runStartedAt: 123 }])
  })

  it('an owner with crashDiagnostics consent closed stays silent — zero emits, local recording unchanged', async () => {
    const { owner, emitted } = telemetrySink(false)
    const { service } = boot((ctx: Context) => {
      ctx.provide('sessionTelemetry', owner as never)
    }, crashHome())
    expect(emitted).toEqual([])
    expect((await service.describe()).crash).toEqual([{ pid: DEAD_PID, runStartedAt: 123 }])
  })

  it('an open gate emits exactly one ops record for the crash fact this boot detected — never the log history, never the error ring', async () => {
    const { owner, emitted } = telemetrySink(true)
    const home = freshHome()
    writeFileSync(join(home, 'diagnostics-crash-log.json'), JSON.stringify([{ pid: 4_000_000, runStartedAt: 7 }]))
    writeFileSync(join(home, 'diagnostics-crash.marker'), `${JSON.stringify({ pid: DEAD_PID, runStartedAt: 123 })}\n`)
    const { service } = boot((ctx: Context) => {
      ctx.provide('sessionTelemetry', owner as never)
    }, home)
    expect(emitted).toHaveLength(1)
    const record = emitted[0]!
    expect(Object.keys(record).sort()).toEqual(['attributes', 'body', 'channel', 'severity', 'time'])
    expect(record.channel).toBe('ops')
    expect(record.severity).toBe('error')
    expect(record.time).toBeGreaterThan(0)
    expect(record.attributes).toEqual({ 'telemetry.op': 'diagnostics-crash' })
    expect(record.body).toEqual({ op: 'diagnostics-crash', pid: DEAD_PID, runStartedAt: 123 })
    expect(JSON.stringify(record)).not.toMatch(/message|name|stack/u)
    // Durable semantics are untouched by the emission: the crash log keeps the
    // capped history plus this boot's fact, and the marker names this run.
    expect(JSON.parse(readFileSync(join(home, 'diagnostics-crash-log.json'), 'utf8'))).toEqual([
      { pid: 4_000_000, runStartedAt: 7 },
      { pid: DEAD_PID, runStartedAt: 123 },
    ])
    const marker = JSON.parse(readFileSync(join(home, 'diagnostics-crash.marker'), 'utf8')) as { pid: number }
    expect(marker.pid).toBe(process.pid)
    expect((await service.describe()).crash).toEqual([
      { pid: 4_000_000, runStartedAt: 7 },
      { pid: DEAD_PID, runStartedAt: 123 },
    ])
  })

  it('a clean boot with an open gate emits nothing', () => {
    const { owner, emitted } = telemetrySink(true)
    boot((ctx: Context) => {
      ctx.provide('sessionTelemetry', owner as never)
    }, freshHome())
    expect(emitted).toEqual([])
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
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
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

describe('Settings-export bundle entry (§43)', () => {
  const descriptors = (): {
    readonly ns: string
    readonly revision: number
    readonly applies: 'live' | 'restart'
    readonly value: unknown
    readonly secrets?: readonly string[]
  }[] => [
    // redactSecrets already stripped apiKey from value; secrets only names it.
    { ns: 'llm', revision: 7, applies: 'live', value: { model: 'deepseek-chat' }, secrets: ['apiKey'] },
    { ns: 'appearance', revision: 2, applies: 'restart', value: { theme: 'dark' } },
  ]

  it('adds an ns-sorted settings-export entry with the seam-stripped values', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('settings', {
        describe: (options?: { readonly redactSecrets?: boolean }) => {
          if (options?.redactSecrets !== true) throw new Error('bundle producer must pass redactSecrets')
          return descriptors()
        },
      })
    })
    const bundle = await service.supportBundle()
    expect(bundle.entries.map(entry => entry.path)).toEqual(['diagnostics.json', 'settings-export.json'])
    expect(bundle.entries[1]?.content).toEqual({
      namespaces: [
        { ns: 'appearance', revision: 2, applies: 'restart', value: { theme: 'dark' }, redacted: [] },
        { ns: 'llm', revision: 7, applies: 'live', value: { model: 'deepseek-chat' }, redacted: ['apiKey'] },
      ],
    })
    expect(() => { validateSupportBundle(bundle) }).not.toThrow()
  })

  it('keeps the bundle diagnostics-only without the settings seam', async () => {
    const bundle = await bench().service.supportBundle()
    expect(bundle.entries).toHaveLength(1)
  })

  it('refuses a row whose value still carries a secret-shaped key after redaction', () => {
    expect(() => settingsExportBundleEntry([
      { ns: 'leaky', revision: 1, applies: 'live', value: { apiKey: 'sk-live' }, redacted: [] },
    ])).toThrow(/secret-shaped key "apiKey"/u)
  })

  it('registration order never leaks — rows sort by ns', () => {
    const rows: SettingsExportRow[] = [
      { ns: 'zzz', revision: 1, applies: 'live', value: {}, redacted: [] },
      { ns: 'aaa', revision: 1, applies: 'live', value: {}, redacted: [] },
    ]
    const entry = settingsExportBundleEntry(rows)
    expect((entry.content as { namespaces: { ns: string }[] }).namespaces.map(row => row.ns)).toEqual(['aaa', 'zzz'])
    expect(settingsExportBundleEntry([...rows].reverse()).content).toEqual(entry.content)
  })
})

describe('Degraded-capable probes (§41)', () => {
  it('degrades the model provider and drops readiness when no provider is registered', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', { listProviders: () => [] })
    })
    const health = await service.health()
    expect(health.modelProvider).toEqual({ state: 'degraded', detail: 'no model provider is registered' })
    expect(health.ready).toBe(false)
  })

  it('degrades plugin state on failed fibers without dropping readiness', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', { listProviders: () => [{ provider: 'deepseek-official' }] })
      ctx.provide('pluginInventory', {
        list: async () => ({
          entries: [
            { moduleName: '@deepseek-ai/dsh-llm', enabled: true, fiberPhase: 'active' },
            { moduleName: '@fixture/broken', enabled: true, fiberPhase: 'failed' },
          ],
        }),
      })
    })
    const health = await service.health()
    expect(health.pluginState).toEqual({ state: 'degraded', detail: '1 plugin fiber(s) failed' })
    expect(health.ready).toBe(true)
  })

  it('a loader without the inventory stays up unchanged; a throwing inventory read degrades', async () => {
    const plain = await bench((ctx: Context) => {
      ctx.provide('loader', {})
    }).service.health()
    expect(plain.pluginState).toEqual({ state: 'up', detail: 'loader is composed' })
    const { service } = bench((ctx: Context) => {
      ctx.provide('loader', {})
      ctx.provide('pluginInventory', {
        list: async () => { throw new TypeError('inventory exploded') },
      })
    })
    const health = await service.health()
    expect(health.pluginState).toEqual({ state: 'degraded', detail: 'pluginInventory read failed (TypeError)' })
  })

  it('describe() carries the probed health with the signal forwarded', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('sessionPersistence', {})
      ctx.provide('loader', {})
      ctx.provide('llm', { listProviders: () => [] })
    })
    const snapshot = await service.describe()
    expect(snapshot.health.modelProvider.state).toBe('degraded')
    expect(snapshot.health.ready).toBe(false)
  })
})

describe('§42 sanitizer audit — free-text redaction (gen-84)', () => {
  it('redacts each forbidden category quoted in an error message, keeping the failure text', async () => {
    const { ctx, service } = bench()
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 1, step: 1, error: new Error('provider call failed: api_key=Ab12cd34ef56gh78 at step 2') })
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 1, step: 2, error: new Error('header Authorization: Bearer abcdefghijklmno12345 was rejected') })
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 1, step: 3, error: new Error('provider rejected key sk-Abcdefghij12345 mid-turn') })
    ctx.emit('agent/error', { agent: { id: 'agent-1' } as Agent, turn: 1, step: 4, error: new Error('login failed for password: "Sup3rSecretPassw0rdX"') })
    const snapshot = await service.describe()
    const messages = snapshot.lastErrors.map(fact => fact.message)
    expect(messages[0]).toBe('provider call failed: [redacted:assignment] at step 2')
    expect(messages[1]).toBe('header Authorization: [redacted:bearer] was rejected')
    expect(messages[2]).toBe('provider rejected key [redacted:key] mid-turn')
    expect(messages[3]).toBe('login failed for [redacted:assignment]')
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('Ab12cd34ef56gh78')
    expect(serialized).not.toContain('abcdefghijklmno12345')
    expect(serialized).not.toContain('sk-Abcdefghij12345')
    expect(serialized).not.toContain('Sup3rSecretPassw0rdX')
  })

  it('carries the redacted messages into the §43 bundle entry with no secret shape surviving', async () => {
    const { ctx, service } = bench()
    ctx.emit('agent/error', { agent: { id: 'agent-2' } as Agent, turn: 3, step: 1, error: new Error('upstream said Bearer zzzz0000aaaa1111bbbb is invalid') })
    const bundle = await service.supportBundle()
    validateSupportBundle(bundle)
    const serialized = JSON.stringify(bundle)
    expect(serialized).toContain('[redacted:bearer]')
    expect(serialized).not.toContain('zzzz0000aaaa1111bbbb')
  })

  it('keeps clean diagnostics text and hash-shaped values untouched', async () => {
    const { ctx, service } = bench()
    ctx.emit('agent/error', { agent: { id: 'agent-3' } as Agent, turn: 1, step: 1, error: new Error('boom') })
    const snapshot = await service.describe()
    expect(snapshot.lastErrors[0]?.message).toBe('boom')
    expect(snapshot.sourceRevision).toMatch(/^(?:source-tree|[0-9a-f]{40})$/u)
  })

  it('refuses a secret-shaped string value under a benign key at the bundle sanitizer', () => {
    expect(() => buildSupportBundle([
      { kind: 'session-headers', path: 'session-headers.json', content: { sessions: [{ note: 'Bearer abcdefghijklmno12' }] } },
    ])).toThrow(/bearer-shaped value/u)
    expect(() => buildSupportBundle([
      { kind: 'session-headers', path: 'session-headers.json', content: { sessions: [{ note: 'sk-Abcdefghij12345' }] } },
    ])).toThrow(/key-shaped value/u)
  })

  it('maps every §42 spec bullet to a payload field, connectivity through transports plus the health connection row', async () => {
    const { service } = bench((ctx: Context) => {
      ctx.provide('loader', {})
    })
    const snapshot = await service.describe()
    expect(snapshot.productVersion).toBe('0.0.0-fixture')
    expect(snapshot.sourceRevision).toMatch(/^(?:source-tree|[0-9a-f]{40})$/u)
    expect(snapshot.apiProtocolVersion).toBe(1)
    expect(snapshot.sessionFormatVersion).toBe(3)
    expect(snapshot.hostId).toBe('host-1')
    expect(snapshot.platform).toBe('linux')
    expect(snapshot.arch).toBe('x64')
    expect(snapshot.runtimeMode).toBe('full')
    expect(snapshot.nodeVersion).toBe(process.version)
    expect(Array.isArray(snapshot.transports)).toBe(true)
    expect(snapshot.health.connection.state).toBe('down')
    expect(Array.isArray(snapshot.plugins)).toBe(true)
    expect(Array.isArray(snapshot.migrations)).toBe(true)
    expect(Array.isArray(snapshot.crash)).toBe(true)
    expect(Array.isArray(snapshot.lastErrors)).toBe(true)
  })

  it('fails loud at load and at describe for a malformed DSH_BUILD_REVISION', async () => {
    const previous = process.env.DSH_BUILD_REVISION
    try {
      process.env.DSH_BUILD_REVISION = 'banana'
      expect(() => bench()).toThrow(/DSH_BUILD_REVISION must be a 40-hex commit sha/u)
      delete process.env.DSH_BUILD_REVISION
      const { service } = bench()
      process.env.DSH_BUILD_REVISION = 'short'
      await expect(service.describe()).rejects.toThrow(/DSH_BUILD_REVISION must be a 40-hex commit sha/u)
    } finally {
      if (previous === undefined) delete process.env.DSH_BUILD_REVISION
      else process.env.DSH_BUILD_REVISION = previous
    }
  })
})

describe('§43 same-candidate collector (gen-84)', () => {
  const CANDIDATE_CHECKSUM = 'b0919adec35e7dbb5807c88fe3f2a032da5b5c182f72574de08c9f6210af35f4'

  const candidate = (): ReturnType<typeof buildSupportBundle> => buildSupportBundle([
    {
      kind: 'diagnostics',
      path: 'diagnostics.json',
      content: {
        productVersion: '1.2.3',
        sourceRevision: '0123456789abcdef0123456789abcdef01234567',
        apiProtocolVersion: 1,
        sessionFormatVersion: 0,
        hostId: '11111111-2222-4333-8444-555555555555',
        platform: 'linux',
        arch: 'x64',
        runtimeMode: 'full',
        nodeVersion: 'v22.0.0',
        transports: [],
        capabilities: [],
        plugins: [{ moduleName: 'fixture-plugin', enabled: true, fiberPhase: 'active' }],
        migrations: [{ from: 0, to: 1, releasedIn: '1.0.0' }],
        crash: [],
        lastErrors: [{ time: 1700000000000, name: 'Error', message: 'call failed: [redacted:assignment]', agentId: 'agent-1', turn: 2, step: 1 }],
        health: {
          process: { state: 'up', detail: 'pid 1' },
          runtime: { state: 'up', detail: 'node v22.0.0' },
          sessionStore: { state: 'up', detail: 'sessionPersistence is composed' },
          pluginState: { state: 'up', detail: 'pluginInventory is composed' },
          connection: { state: 'down', detail: 'webServer is not composed' },
          modelProvider: { state: 'up', detail: 'llm is composed' },
          ready: true,
        },
      },
    },
    sessionHeadersBundleEntry([
      { id: 'sess-a', createdAt: 1700000000000, isSeeded: false, revision: 'r1', cwd: '/tmp/one', eventCount: 12, sizeBytes: 2048 },
      { id: 'sess-b', createdAt: 1700000000999, isSeeded: true, revision: 'r2', parentSession: 'sess-a' },
    ] as const),
    settingsExportBundleEntry([
      { ns: 'llm.deepseek', revision: 3, applies: 'live', value: { model: 'deepseek-chat' }, redacted: ['apiKey'] },
      { ns: 'web.search', revision: 1, applies: 'restart', value: { enabled: false }, redacted: [] },
    ] as const),
  ])

  it('builds the sealed candidate at its pinned chain checksum and equals the fixture bytes', () => {
    const bundle = candidate()
    expect(bundle.checksum).toBe(CANDIDATE_CHECKSUM)
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/support-bundle-candidate.json', import.meta.url), 'utf8')) as ReturnType<typeof buildSupportBundle>
    expect(bundle).toEqual(fixture)
  })

  it('the collector accepts the sealed fixture artifact and refuses every tamper shape', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/support-bundle-candidate.json', import.meta.url), 'utf8')) as ReturnType<typeof buildSupportBundle>
    validateSupportBundle(fixture)
    const flippedEntry = structuredClone(fixture)
    ;(flippedEntry.entries[0]!.content as Record<string, unknown>).productVersion = '9.9.9'
    expect(() => { validateSupportBundle(flippedEntry) }).toThrow(/fails its checksum/u)
    const flippedChain: ReturnType<typeof buildSupportBundle> = { ...fixture, checksum: '0'.repeat(64) }
    expect(() => { validateSupportBundle(flippedChain) }).toThrow(/chained checksum fails/u)
    const droppedRow: ReturnType<typeof buildSupportBundle> = { ...fixture, manifest: fixture.manifest.slice(0, -1) }
    expect(() => { validateSupportBundle(droppedRow) }).toThrow(/disagree in count/u)
  })

  it('proves the redacted form rides the sealed candidate — no secret shape anywhere in the artifact', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/support-bundle-candidate.json', import.meta.url), 'utf8')) as ReturnType<typeof buildSupportBundle>
    validateSupportBundle(fixture)
    expect(JSON.stringify(fixture)).not.toMatch(/Bearer[ \t]+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}\b/u)
    const lastError = (fixture.entries[0]!.content as { lastErrors: { message: string }[] }).lastErrors[0]
    expect(lastError?.message).toBe('call failed: [redacted:assignment]')
  })
})

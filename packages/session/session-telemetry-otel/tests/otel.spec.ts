/**
 * OTel backend unit tier: wire assertions against a scripted `node:http`
 * mock collector through the SDK's REAL pipeline (BatchLogRecordProcessor →
 * OTLP/HTTP JSON), config fail-loud cases, and the real-Loader-path guard
 * for the default-exported Service class.
 */

import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import {
  context as otelContext,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  type Context as OtelContext,
  type ContextManager,
} from '@opentelemetry/api'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ANONYMOUS_USER_ID_FILE_NAME,
  getOrCreateAnonymousIdentity,
  getOrCreateAnonymousUserId,
} from '@deepseek-ai/dsh-anonymous-user-id'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import OpenTelemetrySessionBackend, { Config, DEFAULT_TELEMETRY_MODE, SessionTelemetryMode } from '../src/index.ts'

interface Capture {
  headers: import('node:http').IncomingHttpHeaders
  body: OtlpLogsRequest
}

/** Just the slice of ExportLogsServiceRequest JSON these assertions touch. */
interface OtlpLogsRequest {
  resourceLogs: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] }
    scopeLogs: {
      scope: { name: string; version: string }
      logRecords: {
        timeUnixNano: string
        severityNumber: number
        severityText: string
        traceId?: string
        spanId?: string
        flags?: number
        attributes?: { key: string; value: Record<string, unknown> }[]
        body?: unknown
      }[]
    }[]
  }[]
}

const servers: Server[] = []
const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as { version: string }

/** Synchronous test manager that proves an ambient OTel Context is active at emit time. */
class TestContextManager implements ContextManager {
  private current = ROOT_CONTEXT

  active(): OtelContext {
    return this.current
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    active: OtelContext,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const previous = this.current
    this.current = active
    try {
      return fn.call(thisArg, ...args)
    } finally {
      this.current = previous
    }
  }

  bind<T>(_active: OtelContext, target: T): T {
    return target
  }

  enable(): this {
    return this
  }

  disable(): this {
    this.current = ROOT_CONTEXT
    return this
  }
}

// The backend resolves the harness home's anonymous user id at construction;
// pin DSH_HOME to a temp dir so the suite never touches the ambient ~/.dsh.
let tempHome: string
let previousDshHome: string | undefined
beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dsh-otel-home-'))
  previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempHome
})
afterAll(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  rmSync(tempHome, { recursive: true, force: true })
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections()
  }
})

async function mockCollector(
  beforeRespond?: (requestIndex: number) => Promise<void> | void,
): Promise<{ url: string; captures: Capture[] }> {
  const captures: Capture[] = []
  let requestIndex = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const index = requestIndex++
      void (async () => {
        await beforeRespond?.(index)
        const raw = Buffer.concat(chunks)
        const body = request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw
        captures.push({
          headers: request.headers,
          body: JSON.parse(body.toString()) as OtlpLogsRequest,
        })
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      })()
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}/v1/logs`, captures }
}

async function boot(url: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
    mode: SessionTelemetryMode.FULL,
    exporter: { url, headers: { authorization: 'Bearer test-token' } },
  })
  return { ctx, fiber }
}

function allRecords(captures: Capture[]) {
  return captures.flatMap(c => c.body.resourceLogs.flatMap(r => r.scopeLogs.flatMap(s =>
    s.logRecords.map(record => ({ scope: s.scope.name, record })))))
}

function eventTypes(captures: Capture[]): string[] {
  return allRecords(captures).flatMap(({ record }) =>
    record.attributes?.flatMap(attribute =>
      attribute.key === 'event.type' && typeof attribute.value['stringValue'] === 'string'
        ? [attribute.value['stringValue']]
        : []) ?? [])
}

describe('OpenTelemetrySessionBackend wire', () => {
  it('ships session records and the ops shutdown marker through the real SDK pipeline', async () => {
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(url)
    const session = ctx.sessions.create(SessionId('wire'), {
      meta: { cwd: '/tmp/w', parentSession: SessionId('raw-parent') },
    })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } })
    ctx.emit('agent/error', {
      agent: { id: session.id, session } as Agent,
      turn: 1,
      step: 1,
      error: new TypeError('secret source path /tmp/w/private.ts'),
    })
    await fiber.dispose()

    expect(captures.length).toBeGreaterThan(0)
    const first = captures[0]!
    const authorization: string | undefined = first.headers.authorization
    expect(authorization).toBe('Bearer test-token')

    const resource = first.body.resourceLogs[0]!.resource.attributes
    expect(resource).toContainEqual({ key: 'service.name', value: { stringValue: 'deepseek-harness' } })
    expect(resource.some(attribute => attribute.key === 'service.version')).toBe(true)
    expect(resource).toContainEqual({ key: 'user.id', value: { stringValue: getOrCreateAnonymousUserId() } })
    expect(resource).toContainEqual({ key: 'os.type', value: { stringValue: process.platform } })
    expect(resource).toContainEqual({ key: 'host.arch', value: { stringValue: process.arch } })

    const records = allRecords(captures)
    const ledger = records.filter(r => r.scope === '@deepseek-ai/dsh-session-telemetry-otel')
    const ops = records.filter(r => r.scope === '@deepseek-ai/dsh-session-telemetry-otel/ops')
    const scopes = captures.flatMap(capture => capture.body.resourceLogs.flatMap(resourceLog =>
      resourceLog.scopeLogs.map(scopeLog => scopeLog.scope)))
    expect(scopes).toContainEqual({
      name: '@deepseek-ai/dsh-session-telemetry-otel',
      version: packageVersion,
    })
    expect(scopes).toContainEqual({
      name: '@deepseek-ai/dsh-session-telemetry-otel/ops',
      version: packageVersion,
    })
    expect(records.every(({ record }) => (
      record.body === undefined
      || (typeof record.body === 'object' && record.body !== null && Object.keys(record.body).length === 0)
    ))).toBe(true)

    const start = ledger.find(r => r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'turn/start'))
    expect(start).toBeDefined()
    expect(start?.record.severityNumber).toBe(9)
    expect(BigInt(start!.record.timeUnixNano)).toBe(BigInt(session.events[0]!.time) * 1_000_000n)
    expect(start?.record.attributes?.some(attribute => attribute.key === 'session.cwd')).toBe(false)
    const sessionPseudonym = start?.record.attributes?.find(attribute => attribute.key === 'session.id')
      ?.value['stringValue']
    const identity = getOrCreateAnonymousIdentity()
    expect(sessionPseudonym).toMatch(/^[0-9a-f]{64}$/u)
    expect(sessionPseudonym).toBe(identity.pseudonymizeSessionId('wire'))
    const parentPseudonym = start?.record.attributes?.find(attribute => attribute.key === 'session.parent_id')
      ?.value['stringValue']
    expect(parentPseudonym).toMatch(/^[0-9a-f]{64}$/u)
    expect(parentPseudonym).toBe(identity.pseudonymizeSessionId('raw-parent'))

    const end = ledger.find(r => r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'turn/end'))
    expect(end?.record.severityNumber).toBe(17)
    expect(end?.record.severityText).toBe('ERROR')
    expect(eventTypes(captures)).toEqual(['turn/start', 'turn/end'])
    const wire = JSON.stringify(captures)
    expect(wire).not.toContain('/tmp/w')
    expect(wire).not.toContain('boom')
    expect(wire).not.toContain('private.ts')
    expect(wire).not.toContain('raw-parent')
    expect(wire).not.toContain('"wire"')
    const persistedSeed = readFileSync(join(tempHome, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')
      .trim().slice('v1:'.length)
    expect(wire).not.toContain(persistedSeed)

    expect(ops).toHaveLength(2)
    const agentError = ops.find(({ record }) => record.attributes?.some(attribute =>
      attribute.key === 'telemetry.op' && attribute.value.stringValue === 'agent-error'))
    expect(agentError?.record.attributes).toContainEqual({ key: 'error.class', value: { stringValue: 'TypeError' } })
    expect(agentError?.record.attributes).toContainEqual({
      key: 'session.id', value: { stringValue: sessionPseudonym },
    })
    const shutdown = ops.find(({ record }) => record.attributes?.some(attribute =>
      attribute.key === 'telemetry.op' && attribute.value.stringValue === 'shutdown'))
    expect(shutdown).toBeDefined()
    expect(shutdown?.record.attributes).toContainEqual({
      key: 'session.id', value: { stringValue: sessionPseudonym },
    })
  })

  it('does not inherit trace correlation from an ambient OTel Context', async () => {
    const manager = new TestContextManager().enable()
    expect(otelContext.setGlobalContextManager(manager)).toBe(true)
    const traceId = 'a'.repeat(32)
    const spanId = 'b'.repeat(16)
    const ambient = trace.setSpanContext(ROOT_CONTEXT, {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
    })
    try {
      const { url, captures } = await mockCollector()
      const { ctx, fiber } = await boot(url)
      const session = ctx.sessions.create(SessionId('ambient-trace'), { meta: {} })
      otelContext.with(ambient, () => {
        expect(otelContext.active()).toBe(ambient)
        session.append('turn/start', { turn: 1 })
      })
      await fiber.dispose()

      const records = allRecords(captures).map(({ record }) => record)
      expect(records.length).toBeGreaterThan(0)
      expect(records.every(record => (
        record.traceId === undefined
        && record.spanId === undefined
        && record.flags === undefined
      ))).toBe(true)
      const wire = JSON.stringify(captures)
      expect(wire).not.toContain(traceId)
      expect(wire).not.toContain(spanId)
    } finally {
      otelContext.disable()
    }
  })

  it('drains records enqueued after a timer export began: dispose during an in-flight batch', async () => {
    // The backend implements NO flush() — the batch processor exports on its
    // own cadence, and shutdown's internal drain is complete exactly because
    // nothing in the process calls forceFlush() concurrently (the SDK's
    // concurrent-flush guard skips draining otherwise). Pin that: hold the
    // collector's response to the timer-triggered export open across
    // disposal, and the dispose-time shutdown marker (enqueued after that
    // batch's snapshot) must still arrive.
    const gate = Promise.withResolvers<boolean>()
    const arrived = Promise.withResolvers<boolean>()
    const { url, captures } = await mockCollector(async (index) => {
      if (index === 0) {
        arrived.resolve(true)
        await gate.promise
      }
    })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FULL,
      exporter: { url },
      processor: { scheduledDelayMillis: 10 },
    })
    const session = ctx.sessions.create(SessionId('drain'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await arrived.promise

    const disposal = fiber.dispose()
    // Let disposal reach the backend's shutdown while the export is held open.
    await new Promise(resolve => setTimeout(resolve, 50))
    gate.resolve(true)
    await disposal

    const ops = allRecords(captures).filter(r => r.scope === '@deepseek-ai/dsh-session-telemetry-otel/ops')
    expect(ops).toHaveLength(1)
    expect(ops[0]!.record.attributes).toContainEqual({ key: 'telemetry.op', value: { stringValue: 'shutdown' } })
  })

  it('bounds the SDK forceFlush wait when an in-flight transport never settles', async () => {
    const gate = Promise.withResolvers<boolean>()
    const arrived = Promise.withResolvers<boolean>()
    const { url, captures } = await mockCollector(async (index) => {
      if (index === 0) {
        arrived.resolve(true)
        await gate.promise
      }
    })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FULL,
      exporter: { url, timeoutMillis: 60_000 },
      processor: { scheduledDelayMillis: 10, exportTimeoutMillis: 60_000 },
      shutdownTimeoutMillis: 50,
    })
    const session = ctx.sessions.create(SessionId('bounded-shutdown'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await arrived.promise

    const started = performance.now()
    await fiber.dispose()
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(captures).toHaveLength(0)

    // The outer deadline cannot cancel the SDK transport. Let it finish so
    // the real provider promise remains clean after the test has proved the
    // Cordis disposer no longer waits for it.
    gate.resolve(true)
    await expect.poll(() => captures.length).toBeGreaterThanOrEqual(2)
  })

  it('passes exporter options beyond url and headers through to the SDK exporter', async () => {
    const { url, captures } = await mockCollector()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // `compression` is a documented SDK exporter option; the advertised
    // verbatim passthrough must hand it (and every other field) to the
    // exporter rather than silently rebuilding url/headers only.
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FULL,
      exporter: { url, compression: 'gzip' },
    } as Config)
    const session = ctx.sessions.create(SessionId('gzip'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    await fiber.dispose()

    expect(captures.length).toBeGreaterThan(0)
    expect(captures[0]!.headers['content-encoding']).toBe('gzip')
    const types = allRecords(captures).flatMap(({ record }) =>
      record.attributes?.flatMap(a => a.key === 'event.type' ? [a.value.stringValue] : []) ?? [])
    expect(types).toContain('turn/start')
  })

  it('maps warn severity from record policy and leaves the seam flush hint unimplemented', async () => {
    const { url, captures } = await mockCollector()
    const { ctx, fiber } = await boot(url)
    ctx.on('session-telemetry/record', (_record, next) => ({ ...next(), severity: 'warn' }))
    const session = ctx.sessions.create(SessionId('warn'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    // No flush(): the coordinator's optional-call forwarding no-ops, and the
    // batch processor owns export cadence end to end (see the backend note).
    expect('flush' in ctx.sessionTelemetry && ctx.sessionTelemetry.flush !== undefined).toBe(false)
    await fiber.dispose()
    const start = allRecords(captures).find(r =>
      r.record.attributes?.some(a => a.key === 'event.type' && a.value.stringValue === 'turn/start'))
    expect(start?.record.severityNumber).toBe(13)
  })

  it('replays each session suffix only at the next feedback event', async () => {
    const { url, captures } = await mockCollector()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FEEDBACK_ONLY,
      exporter: { url },
    })
    const session = ctx.sessions.create(SessionId('feedback-only'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    recordFeedback(session, 'first report')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    recordFeedback(session, 'second report')
    session.append('turn/start', { turn: 2 })
    await fiber.dispose()

    const types = allRecords(captures).flatMap(({ record }) =>
      record.attributes?.flatMap(attribute =>
        attribute.key === 'event.type' ? [attribute.value.stringValue] : []) ?? [])
    expect(types).toEqual(['turn/start', 'feedback/record', 'turn/end', 'feedback/record'])
    expect(JSON.stringify(captures)).not.toContain('first report')
    expect(JSON.stringify(captures)).not.toContain('second report')
    expect(allRecords(captures).some(({ scope }) => scope.endsWith('/ops'))).toBe(false)
  })

  it('exposes no direct emitter and ignores non-canonical feedback in feedback-only mode', async () => {
    const { url, captures } = await mockCollector()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.FEEDBACK_ONLY,
      exporter: { url },
    })
    const session = ctx.sessions.create(SessionId('no-feedback'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    expect('emit' in ctx.sessionTelemetry).toBe(false)
    ctx.emit('session/event', session, {
      type: 'feedback/record',
      seq: session.events.length,
      time: Date.now(),
      data: { text: 'not committed' },
    })
    await fiber.dispose()

    expect(warn).toHaveBeenCalledWith(
      'session telemetry ignored a feedback event absent from the canonical session log',
    )
    expect(captures).toEqual([])
  })

  it('constructs no disabled transport even when exporter options are present', async () => {
    const { url, captures } = await mockCollector()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
      mode: SessionTelemetryMode.DISABLED,
      exporter: { url },
      processor: { maxExportBatchSize: 0 },
    })
    const session = ctx.sessions.create(SessionId('disabled'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    recordFeedback(session, 'local report')

    expect(warn).toHaveBeenCalledWith(
      'session telemetry is DISABLED; nothing will be shared and this feedback remains local',
    )
    expect('emit' in ctx.sessionTelemetry).toBe(false)
    expect('shutdown' in ctx.sessionTelemetry).toBe(false)
    await fiber.dispose()
    recordFeedback(session, 'after disposal')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(captures).toEqual([])
  })

  it('discloses the sharing policy for every mode', async () => {
    const { url, captures } = await mockCollector()

    const fullCtx = new Context()
    await fullCtx.plugin(SessionStore)
    const full = await fullCtx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.FULL, exporter: { url } })
    expect(fullCtx.sessionTelemetry.sharing).toBe('full')
    await full.dispose()

    const gatedCtx = new Context()
    await gatedCtx.plugin(SessionStore)
    const gated = await gatedCtx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.FEEDBACK_ONLY, exporter: { url } })
    expect(gatedCtx.sessionTelemetry.sharing).toBe('feedback-only')
    await gated.dispose()

    const disabledCtx = new Context()
    await disabledCtx.plugin(SessionStore)
    const disabled = await disabledCtx.plugin(OpenTelemetrySessionBackend, { mode: SessionTelemetryMode.DISABLED })
    expect(disabledCtx.sessionTelemetry.sharing).toBe('disabled')
    await disabled.dispose()

    // An omitted mode is DISABLED, so the default also shares nothing.
    const defaultCtx = new Context()
    await defaultCtx.plugin(SessionStore)
    const defaulted = await defaultCtx.plugin(OpenTelemetrySessionBackend, {})
    expect(defaultCtx.sessionTelemetry.sharing).toBe('disabled')
    await defaulted.dispose()

    // No record was emitted by any mode, so nothing reached the collector.
    expect(captures).toEqual([])
  })

  it('defaults direct construction to disabled delivery', async () => {
    const { url, captures } = await mockCollector()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    new OpenTelemetrySessionBackend(ctx, {
      exporter: { url },
      processor: { maxExportBatchSize: 0 },
    })
    const session = ctx.sessions.create(SessionId('direct-default'), { meta: {} })
    session.append('turn/start', { turn: 1 })
    recordFeedback(session, 'local report')
    await ctx.fiber.dispose()

    expect(warn).toHaveBeenCalledWith(
      'session telemetry is DISABLED; nothing will be shared and this feedback remains local',
    )
    expect(captures).toEqual([])
  })
})

describe('OpenTelemetrySessionBackend config fails loud', () => {
  it('exposes modes through the nominal enum', () => {
    expectTypeOf<Config['mode']>().toEqualTypeOf<SessionTelemetryMode | undefined>()
    expectTypeOf<'FULL'>().not.toExtend<SessionTelemetryMode>()
    expectTypeOf<SessionTelemetryMode.FULL>().toExtend<SessionTelemetryMode>()
    expect(DEFAULT_TELEMETRY_MODE).toBe(SessionTelemetryMode.DISABLED)
    expect(Config({}).mode).toBe(DEFAULT_TELEMETRY_MODE)
  })

  it.each([
    [{ mode: SessionTelemetryMode.FULL }, /exporter\.url is required/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: '' } }, /exporter\.url is required/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'not a url' } }, /not a valid URL/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'ftp://collector' } }, /must be http\(s\)/],
    [{ mode: SessionTelemetryMode.FEEDBACK_ONLY }, /exporter\.url is required/],
    [{ mode: 'INVALID' }, /INVALID/],
    // The SDK accepts a non-positive batch size but its shutdown drain then
    // splices empty batches forever — dispose would hang, so reject at load.
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, processor: { maxExportBatchSize: 0 } }, /maxExportBatchSize/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, processor: { maxExportBatchSize: 0.5 } }, /maxExportBatchSize/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, shutdownTimeoutMillis: 0 }, /shutdownTimeoutMillis/],
    [{ mode: SessionTelemetryMode.FULL, exporter: { url: 'http://c/v1/logs' }, shutdownTimeoutMillis: Number.POSITIVE_INFINITY }, /shutdownTimeoutMillis/],
  ])('rejects %j at plugin load', async (config, message) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await expect(ctx.plugin(OpenTelemetrySessionBackend, config as Config)).rejects.toThrow(message)
  })

  it('rejects an unknown direct mode before reading transport config', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    let exporterRead = false
    const config = {
      mode: 'INVALID',
      get exporter() {
        exporterRead = true
        throw new Error('transport config was read')
      },
    } as unknown as Config

    expect(() => new OpenTelemetrySessionBackend(ctx, config)).toThrow(/unsupported mode "INVALID"/)
    expect(exporterRead).toBe(false)
  })

  it('does not read any transport setting in disabled mode', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const transportRead = vi.fn(() => {
      throw new Error('transport config was read')
    })
    const config = {
      mode: SessionTelemetryMode.DISABLED,
      get exporter() {
        return transportRead()
      },
      get processor() {
        return transportRead()
      },
      get shutdownTimeoutMillis() {
        return transportRead()
      },
    } as unknown as Config

    new OpenTelemetrySessionBackend(ctx, config)
    expect(transportRead).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('dsh-session-telemetry-otel real-load-path guard', () => {
  it('keeps the Service class with inject/Config through unwrapExports', async () => {
    const module = await import('../src/index.ts')
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(module) as typeof OpenTelemetrySessionBackend
    expect(unwrapped).toBe(OpenTelemetrySessionBackend)
    expect(unwrapped.inject).toEqual(['sessions'])
    expect(typeof unwrapped.Config).toBe('function')
  })

  it('boots through the unwrapped class and registers ctx.sessionTelemetry', async () => {
    const { url } = await mockCollector()
    const module = await import('../src/index.ts')
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(module) as Parameters<Context['plugin']>[0]
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(unwrapped, { mode: SessionTelemetryMode.FULL, exporter: { url } })
    expect(ctx.sessionTelemetry).toBeInstanceOf(OpenTelemetrySessionBackend)
    await fiber.dispose()
  })
})

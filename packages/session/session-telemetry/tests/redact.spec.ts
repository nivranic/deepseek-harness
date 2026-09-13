import { createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * The `session-telemetry/record` waterfall contract: the mandatory privacy
 * projection, deletion-only listener stacking, ops-record coverage, the
 * untouched canonical log, and the fail-closed containment of a throwing rule.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionTelemetryCoordinator,
  type SessionTelemetrySink,
  type SessionTelemetryRecord,
} from '../src/index.ts'

const FIXTURE_SECRET = 'sk-fixture1234567890'

class CollectingBackend implements SessionTelemetrySink {
  records: SessionTelemetryRecord[] = []
  emit(record: SessionTelemetryRecord): void {
    this.records.push(record)
  }
  async shutdown(): Promise<void> {}
}

const telemetryHome = mkdtempSync(join(tmpdir(), 'dsh-session-telemetry-redact-'))
const previousDshHome = process.env.DSH_HOME

beforeAll(() => {
  process.env.DSH_HOME = telemetryHome
})

afterAll(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  rmSync(telemetryHome, { recursive: true, force: true })
})

async function setup() {
  const backend = new CollectingBackend()
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin({
    name: 'fake-telemetry',
    inject: ['sessions'],
    apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
  })
  return { ctx, backend, fiber }
}

describe('session-telemetry/record waterfall', () => {
  it('passes the privacy-safe projection when no listener is mounted', async () => {
    const { ctx, backend } = await setup()
    const session = ctx.sessions.create(SessionId('w'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `key ${FIXTURE_SECRET}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records[0]).not.toHaveProperty('body')
    expect(backend.records[0]!.attributes).toMatchObject({
      'event.type': 'user/message',
      'message.source': 'user',
    })
    expect(JSON.stringify(backend.records)).not.toContain(FIXTURE_SECRET)
  })

  it('applies a mounted rule to every outbound record, ops records included', async () => {
    const { ctx, backend, fiber } = await setup()
    ctx.on('session-telemetry/record', (_record, next) => {
      const record = next()
      return {
        ...record,
        severity: 'warn',
        attributes: Object.fromEntries(Object.entries(record.attributes).filter(([key]) =>
          key === 'event.type' || key === 'telemetry.op')),
      }
    })
    const session = ctx.sessions.create(SessionId('rule'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: FIXTURE_SECRET }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records[0]).toMatchObject({
      severity: 'warn',
      attributes: { 'event.type': 'user/message' },
    })
    // The dispose-time shutdown ops record passes through the same waterfall.
    await fiber.dispose()
    const ops = backend.records.filter(record => record.channel === 'ops')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ severity: 'warn', attributes: { 'telemetry.op': 'shutdown' } })
  })

  it('keeps the canonical log untouched by a mounted rule', async () => {
    const { ctx } = await setup()
    ctx.on('session-telemetry/record', (_record, next) => ({ ...next(), attributes: {} }))
    const session = ctx.sessions.create(SessionId('log'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: FIXTURE_SECRET }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const logged = session.events[0]!.data as { content: { text: string }[] }
    expect(logged.content[0]!.text).toBe(FIXTURE_SECRET)
  })

  it('stacks listeners outermost-first around next()', async () => {
    const { ctx, backend } = await setup()
    const order: string[] = []
    ctx.on('session-telemetry/record', (_record, next) => {
      order.push('outer-before')
      const record = next()
      order.push('outer-after')
      return {
        ...record,
        attributes: Object.fromEntries(Object.entries(record.attributes)
          .filter(([key]) => key !== 'event.seq')),
      }
    })
    ctx.on('session-telemetry/record', (_record, next) => {
      order.push('inner')
      const record = next()
      return {
        ...record,
        attributes: Object.fromEntries(Object.entries(record.attributes)
          .filter(([key]) => key !== 'message.source')),
      }
    })
    const session = ctx.sessions.create(SessionId('stack'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(order).toEqual(['outer-before', 'inner', 'outer-after'])
    expect(backend.records[0]!.attributes).toEqual({
      'session.id': backend.records[0]!.attributes['session.id'],
      'event.type': 'user/message',
    })
  })

  it('a listener that skips next() can remove but cannot replace record identity', async () => {
    const { ctx, backend } = await setup()
    const inner = { called: false }
    ctx.on('session-telemetry/record', () => ({
      channel: 'ops', time: 0, severity: 'warn', attributes: { replaced: true },
    } satisfies SessionTelemetryRecord))
    ctx.on('session-telemetry/record', (_record, next) => {
      inner.called = true
      return next()
    })
    const session = ctx.sessions.create(SessionId('veto'))
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records[0]).toEqual({
      channel: 'ledger', time: event.time, severity: 'warn', attributes: {},
    })
    expect(inner.called).toBe(false)
  })

  it('discards added aliases, rewritten fields, and invalid severity after the waterfall', async () => {
    const { ctx, backend } = await setup()
    let listenerRecord: SessionTelemetryRecord | undefined
    ctx.on('session-telemetry/record', (record, next) => {
      listenerRecord = record
      const candidate = next()
      return {
        ...candidate,
        severity: FIXTURE_SECRET as never,
        attributes: {
          ...candidate.attributes,
          'session.alias': candidate.attributes['session.id']!,
          'event.type': FIXTURE_SECRET,
          injected: FIXTURE_SECRET,
        },
      }
    })
    const session = ctx.sessions.create(SessionId('raw-session-secret'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: FIXTURE_SECRET }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    expect(Object.isFrozen(listenerRecord)).toBe(true)
    expect(Object.isFrozen(listenerRecord?.attributes)).toBe(true)
    expect(JSON.stringify(listenerRecord)).not.toContain('raw-session-secret')
    expect(backend.records[0]).toMatchObject({ severity: 'info' })
    expect(backend.records[0]!.attributes).not.toHaveProperty('session.alias')
    expect(backend.records[0]!.attributes).not.toHaveProperty('event.type')
    expect(backend.records[0]!.attributes).not.toHaveProperty('injected')
    expect(JSON.stringify(backend.records)).not.toContain(FIXTURE_SECRET)
  })

  it('reads a dynamic candidate severity once before validating it', async () => {
    const { ctx, backend } = await setup()
    let severityReads = 0
    ctx.on('session-telemetry/record', (_record, next) => {
      const candidate = { ...next() }
      return Object.defineProperty(candidate, 'severity', {
        enumerable: true,
        get: () => {
          severityReads += 1
          return severityReads === 1 ? 'warn' : FIXTURE_SECRET
        },
      })
    })
    const session = ctx.sessions.create(SessionId('severity-accessor'))
    session.append('turn/start', { turn: 1 })

    expect(severityReads).toBe(1)
    expect(backend.records[0]!.severity).toBe('warn')
    expect(JSON.stringify(backend.records)).not.toContain(FIXTURE_SECRET)
  })

  it('a throwing rule withholds the record fail-closed without disturbing the log', async () => {
    const { ctx, backend } = await setup()
    ctx.on('session-telemetry/record', () => {
      throw new Error('rule exploded')
    })
    const session = ctx.sessions.create(SessionId('closed'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(backend.records).toHaveLength(0)
    expect(session.events).toHaveLength(1)
  })
})

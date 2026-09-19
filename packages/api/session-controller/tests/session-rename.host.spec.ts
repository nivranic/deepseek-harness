/**
 * Session Controller rename delegation through the composed SessionTitleService. The
 * agent factory is a structural stub whose createAgent forwards seed/meta into
 * the real SessionStore, and whose resume never runs (every source here is
 * already attached). Cold-session resolution is the shared `agentFor` path —
 * remote-proxy-cold.spec.ts owns the resume evidence for every unary that rides
 * it, rename included.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

function request<P>(payload: P): P {
  return payload
}

async function composed(withTitles = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  if (withTitles) {
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })
  }
  // Store-backed structural factory: create builds the session with the
  // forwarded seed/meta (the store validates the balanced prefix) and
  // registers an idle agent stub over it.
  ctx.agents.setFactory({
    createAgent: (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
  })
  return ctx
}

/** Register one live agent whose log holds `turns` completed turns. */
function liveAgent(ctx: Context, id: string, turns: number): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('sessions.rename', () => {
  it('accepts through the composed title service: normalized user-source event, echoed seq', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-rename', 1)

    const renamed = await remote(ctx).rename(request({ sessionId: source.id, title: '  new   name  ' }))
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.value.title).toBe('new name')
    const event = source.snapshotEvents().findLast(item => item.type === 'session/title')
    expect(event?.seq).toBe(renamed.value.seq)
    expect(event?.data).toMatchObject({ title: 'new name', source: { kind: 'user' } })
  })

  it('maps only an empty-normalizing title to title-invalid, with a presentable message', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-rename-bad', 1)

    // U+200B passes a client-side trim gate but normalizes to empty host-side.
    const response = await remote(ctx).rename(request({ sessionId: source.id, title: ' ​ ' }))
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error).toMatchObject({
        code: 'session/title-invalid',
        details: { sessionId: source.id },
      })
      // The message renders verbatim in the rename dialog's alert.
      expect(response.error.message).toBe('session title must contain visible characters')
    }
  })

  it('maps a non-validation rename failure (stale session object) to internal, not title-invalid', async () => {
    const ctx = await composed()
    // The registered agent holds a session object from another store: the
    // title service's liveness check throws a plain Error, which must not
    // read as the user's fault.
    const foreign = await composed(false)
    const stale = liveAgent(foreign, 'session-rename-stale', 1)
    ctx.agents.register({ id: stale.id, session: stale, status: 'idle', ctx } as Agent)

    const response = await remote(ctx).rename(request({ sessionId: stale.id, title: 'name' }))
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('gateway/internal')
  })

  it('answers internal when the composition mounts no session-title service', async () => {
    const ctx = await composed(false)
    const source = liveAgent(ctx, 'session-no-titles', 1)

    const response = await remote(ctx).rename(request({ sessionId: source.id, title: 'name' }))
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe('gateway/internal')
      expect(response.error.message).toMatch(/mounts no session-title service/)
    }
  })
})


describe('sessions.renameAt', () => {
  it('accepts one competing editor and rejects stale retries without changing the log', async () => {
    const ctx = await composed()
    try {
      const source = liveAgent(ctx, 'rename-competing', 0)
      const api = remote(ctx)
      const first = await api.renameAt({ sessionId: source.id, title: 'Initial', expectedRevision: null })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      const results = await Promise.all(['First editor', 'Second editor'].map(title =>
        api.renameAt({ sessionId: source.id, title, expectedRevision: first.value.seq })))
      expect(results.filter(result => result.ok)).toHaveLength(1)
      expect(results.find(result => !result.ok)).toMatchObject({ ok: false, error: { code: 'session/revision-conflict' } })
      const before = source.snapshotEvents()
      expect(await api.renameAt({ sessionId: source.id, title: 'Initial', expectedRevision: null }))
        .toMatchObject({ ok: false, error: { code: 'session/revision-conflict' } })
      expect(source.snapshotEvents()).toEqual(before)
    } finally { await ctx.fiber.dispose() }
  })

  it('normalizes duplicate acceptance with the configured byte limit and preserves the original seq', async () => {
    const ctx = await composed()
    try {
      const source = liveAgent(ctx, 'rename-duplicate', 0)
      const api = remote(ctx)
      const first = await api.renameAt({ sessionId: source.id, title: '  '+ '名'.repeat(30), expectedRevision: null })
      expect(first).toMatchObject({ ok: true, value: { title: '名'.repeat(13) } })
      expect(await api.renameAt({ sessionId: source.id, title: '名'.repeat(40), expectedRevision: null })).toEqual(first)
      expect(source.snapshotEvents().filter(event => event.type === 'session/title')).toHaveLength(1)
    } finally { await ctx.fiber.dispose() }
  })

  it('pins an identical automatic title only against its current revision', async () => {
    const ctx = await composed()
    try {
      const source = liveAgent(ctx, 'rename-pin-revision', 1)
      const automatic = (await ctx.sessionTitle.refresh(source))!
      const api = remote(ctx)
      expect(await api.renameAt({ sessionId: source.id, title: automatic.title, expectedRevision: null }))
        .toMatchObject({ ok: false, error: { code: 'session/revision-conflict' } })
      const accepted = await api.renameAt({ sessionId: source.id, title: automatic.title, expectedRevision: automatic.eventSeq })
      expect(accepted.ok).toBe(true)
      expect(ctx.sessionTitle.get(source)?.source.kind).toBe('user')
    } finally { await ctx.fiber.dispose() }
  })

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid expected revision %s before mutation', async (expectedRevision) => {
    const ctx = await composed()
    try {
      const source = liveAgent(ctx, 'rename-invalid-revision', 0)
      expect(await remote(ctx).renameAt({ sessionId: source.id, title: 'Title', expectedRevision: expectedRevision as number }))
        .toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
      expect(ctx.sessionTitle.get(source)).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })
})

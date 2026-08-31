/** The session/artifact authorization surface: journal-proven references, channel-served bytes, loud failures. */

import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

/** A persisted cold session whose log carries the given events. */
async function persistedController(
  events: SessionEvent[],
  artifacts: { get: (id: string) => Promise<Uint8Array | null> },
): Promise<{ ctx: Context; controller: SessionCommandController; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const sessionId = SessionId('cold-artifact')
  const meta: SessionHeader = { version: 0, id: sessionId, createdAt: 1, cwd: '/workspace' }
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([meta]),
    inspect: () => Promise.resolve({ meta, events }),
  }) as never)
  installSessionReadTestServices(ctx)
  ctx.provide('artifacts', artifacts as never)
  const agents = { resolveAgent: vi.fn() } as unknown as ApiSessionAgentController
  return { ctx, controller: new SessionCommandController(ctx, agents, '/workspace'), sessionId }
}

function createdEvent(seq: number, id: string, kind: string, title: string, format: 'text' | 'bytes' = 'text'): SessionEvent {
  return { type: 'artifact/created', seq, time: 1_759_017_600_000 + seq, data: { id, kind, title, format } } as never
}

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ failure: { code } })
}

describe('Session artifact authorization', () => {
  it('serves the journaled metadata and the channel bytes for a referenced id', async () => {
    const { ctx, controller, sessionId } = await persistedController(
      [createdEvent(0, 'art-1', 'report', '迁移报告')],
      { get: () => Promise.resolve(new TextEncoder().encode('# 报告')) },
    )
    await expect(controller.artifact({ sessionId, artifactId: 'art-1' }))
      .resolves.toEqual({ id: 'art-1', kind: 'report', title: '迁移报告', format: 'text', data: Buffer.from('# 报告').toString('base64'), truncated: false, size: 4 })
    await ctx.fiber.dispose()
  })

  it('serves one UTF-16 range when offset and limit are present', async () => {
    const content = '0123456789'
    const { ctx, controller, sessionId } = await persistedController(
      [createdEvent(0, 'art-1', 'report', 'R')],
      { get: () => Promise.resolve(new TextEncoder().encode(content)) },
    )
    await expect(controller.artifact({ sessionId, artifactId: 'art-1', offset: 2, limit: 4 }))
      .resolves.toEqual({ id: 'art-1', kind: 'report', title: 'R', format: 'text', data: Buffer.from('2345').toString('base64'), truncated: true, size: 10 })
    await expectFailure(controller.artifact({ sessionId, artifactId: 'art-1', offset: -1 }), 'artifact-error')
    await ctx.fiber.dispose()
  })

  it('rejects an id the session log never referenced', async () => {
    const { ctx, controller, sessionId } = await persistedController(
      [createdEvent(0, 'art-1', 'report', 'R')],
      { get: () => Promise.resolve(new Uint8Array()) },
    )
    await expectFailure(controller.artifact({ sessionId, artifactId: 'art-other' }), 'artifact-error')
    await ctx.fiber.dispose()
  })

  it('fails loud when the referenced content is missing from the channel', async () => {
    const { ctx, controller, sessionId } = await persistedController(
      [createdEvent(0, 'art-gone', 'report', 'R')],
      { get: () => Promise.resolve(null) },
    )
    await expectFailure(controller.artifact({ sessionId, artifactId: 'art-gone' }), 'artifact-error')
    await ctx.fiber.dispose()
  })

  it('maps a missing session and a channel failure', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    installSessionReadTestServices(ctx)
    const controller = new SessionCommandController(
      ctx,
      { resolveAgent: vi.fn() } as unknown as ApiSessionAgentController,
      '/workspace',
    )
    await expectFailure(controller.artifact({ sessionId: SessionId('missing'), artifactId: 'art-1' }), 'session-not-found')

    const { ctx: failing, controller: failingController, sessionId } = await persistedController(
      [createdEvent(0, 'art-1', 'report', 'R')],
      { get: () => Promise.reject(new Error('disk offline')) },
    )
    await expectFailure(failingController.artifact({ sessionId, artifactId: 'art-1' }), 'internal')
    await ctx.fiber.dispose()
    await failing.fiber.dispose()
  })

  it('pages a bytes artifact by raw byte and reports its byte size', async () => {
    const raw = new Uint8Array([0, 1, 2, 250, 251, 255])
    const { ctx, controller, sessionId } = await persistedController(
      [createdEvent(0, 'art-bin', 'png', '图标', 'bytes')],
      { get: () => Promise.resolve(raw) },
    )
    await expect(controller.artifact({ sessionId, artifactId: 'art-bin', offset: 2, limit: 3 }))
      .resolves.toEqual({
        id: 'art-bin',
        kind: 'png',
        title: '图标',
        format: 'bytes',
        data: Buffer.from(raw.subarray(2, 5)).toString('base64'),
        truncated: true,
        size: 6,
      })
    await ctx.fiber.dispose()
  })
})

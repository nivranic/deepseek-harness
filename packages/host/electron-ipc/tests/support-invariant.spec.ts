/** Counter invariants compare service observations with independently delivered Session sequences. */
import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.ts'
import { DesktopSupport } from '../src/support.ts'
import { POLICY } from './support-fixture.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  let installer: InvariantInstaller | undefined
  ctx.provide('invariants', { register: (_name: string, value: InvariantInstaller) => {
    installer = value
    return () => {}
  } } as never)
  const support = new DesktopSupport(ctx, POLICY)
  await apply(ctx)
  expect(installer?.inject).toEqual(['desktopSupport'])
  const fail = vi.fn((message: string): never => { throw new Error(message) })
  await installer!(ctx, fail)
  const session = {} as Session
  const emit = (seq: number, type: string) =>{  ctx.emit('session/event', session, { seq, type } as SessionEvent) }
  return { support, fail, emit }
}

it('accepts independent counter deltas, repeated sequences and uncounted events', async () => {
  const f = await fixture()
  f.emit(0, 'turn/start')
  f.emit(1, 'turn/end')
  f.emit(1, 'turn/end')
  f.emit(2, 'assistant/message')
  f.emit(3, 'tool/call')
  f.emit(4, 'tool/result')
  expect(f.fail).not.toHaveBeenCalled()
  expect(f.support.diagnosticCounts()).toEqual({ turnsStarted: 1, turnsEnded: 1, toolCalls: 1, toolResults: 1 })
})

it('reports a stale counter projection after a new authoritative sequence', async () => {
  const f = await fixture()
  f.emit(0, 'turn/start')
  vi.spyOn(f.support, 'diagnosticCounts').mockReturnValue({ turnsStarted: 1, turnsEnded: 0, toolCalls: 0, toolResults: 0 })
  expect(() =>{  f.emit(1, 'turn/start') }).toThrow('diagnostic counters disagree')
  expect(f.fail).toHaveBeenCalledOnce()
})

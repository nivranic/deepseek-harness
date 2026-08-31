/** Durable artifact-event invariants: shape rules, the open-turn relationship, and the legal orphan status. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ArtifactId } from '../src/index.ts'
import * as ArtifactInvariant from '../src/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ArtifactInvariant)
  return ctx
}

describe('artifact event invariants', () => {
  it('accepts a created/ready pair inside an open turn', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('artifact/created', { id: ArtifactId('art-1'), kind: 'report', title: '迁移报告', format: 'text' })
      session.append('artifact/status', { id: ArtifactId('art-1'), status: 'ready' })
    }).not.toThrow()
  })

  it.each([
    ['empty id', { id: '', kind: 'report', title: 'R', format: 'text' }, /non-empty string/],
    ['padded kind', { id: ArtifactId('art-1'), kind: ' report', title: 'R', format: 'text' }, /already trimmed/],
    ['empty title', { id: ArtifactId('art-1'), kind: 'report', title: '', format: 'text' }, /non-empty and already trimmed/],
    ['numeric kind', { id: ArtifactId('art-1'), kind: 3, title: 'R', format: 'text' }, /already trimmed/],
    ['unknown format', { id: ArtifactId('art-1'), kind: 'report', title: 'R', format: 'richtext' }, /unknown format/],
    ['numeric format', { id: ArtifactId('art-1'), kind: 'report', title: 'R', format: 1 }, /unknown format/],
  ])('rejects an incoherent created event (%s)', async (_label, data, message) => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => { session.append('artifact/created', data as never) }).toThrow(message)
  })

  it.each([
    ['unknown status', { id: ArtifactId('art-1'), status: 'weird' }, /unknown status/],
    ['numeric status', { id: ArtifactId('art-1'), status: 1 }, /unknown status/],
    ['empty id', { id: '', status: 'ready' }, /non-empty string/],
  ])('rejects an incoherent status event (%s)', async (_label, data, message) => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => { session.append('artifact/status', data as never) }).toThrow(message)
  })

  it('accepts an orphan status (a legal no-op in every fold)', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => { session.append('artifact/status', { id: ArtifactId('art-ghost'), status: 'ready' }) }).not.toThrow()
  })

  it('rejects artifact events outside any open turn', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const before = [...session.events]
    expect(() => { session.append('artifact/created', { id: ArtifactId('art-2'), kind: 'report', title: 'R', format: 'text' }) }).toThrow(/outside any open turn/)
    expect(() => { session.append('artifact/status', { id: ArtifactId('art-2'), status: 'ready' }) }).toThrow(/outside any open turn/)
    expect(session.events).toEqual(before)
  })

  it('rejects an existing out-of-turn created event on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('artifact/created', { id: ArtifactId('art-3'), kind: 'report', title: 'R', format: 'text' })
    const registry = ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(registry.then(() => ctx.plugin(ArtifactInvariant))).rejects.toThrow(/outside any open turn/)
  })
})

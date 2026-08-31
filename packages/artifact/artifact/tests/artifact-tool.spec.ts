/** The artifact producer against the real tool runtime and a real session: the
 * `artifact_create` tool journals the reference and drives the resource channel. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/index.ts'
import { ArtifactId, ArtifactStore } from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** In-memory resource channel standing in for the local backend. */
class MemoryArtifactStore extends ArtifactStore {
  readonly stored = new Map<string, Uint8Array>()
  failNextPut = false

  async put(id: ArtifactId, data: Uint8Array): Promise<void> {
    if (this.failNextPut) throw new Error('disk full')
    this.stored.set(id, data)
  }

  async get(id: ArtifactId): Promise<Uint8Array | null> {
    return this.stored.get(id) ?? null
  }

  async remove(id: ArtifactId): Promise<void> {
    this.stored.delete(id)
  }
}

/** A parent Agent backed by a real Session — the tool reads `agent.session`. */
function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

/** Mounts the real plugins with the memory channel as the provider; the
 * loader instantiates the Service subclass, so the typed handle comes back
 * off ctx.artifacts. */
async function setup(): Promise<{ ctx: Context; store: MemoryArtifactStore }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(MemoryArtifactStore)
  await ctx.plugin(plugin)
  const store = ctx.artifacts as MemoryArtifactStore
  return { ctx, store }
}

let callCounter = 0
function callArtifact(ctx: Context, args: unknown, over: { agent?: Agent | undefined } = {}) {
  const agent = 'agent' in over ? over.agent : agentWithSession()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name: 'artifact_create',
    arguments: args,
    ...agent ? { agent } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-artifact tool', () => {
  it('registers `artifact_create` with kind/title/content parameters', async () => {
    const { ctx } = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'artifact_create')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['kind', 'title', 'content'])
    const readSchema = ctx.tools.schemas().find(s => s.name === 'artifact_read')
    expect(readSchema).toBeDefined()
  })

  it('journals the reference and stores the bytes, ending ready', async () => {
    const { ctx, store } = await setup()
    const agent = agentWithSession('writer')
    const result = await callArtifact(ctx, { kind: ' report ', title: '迁移报告', content: '# 报告\n正文' }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected artifact_create success')
    const value = result.value as { id: string; kind: string; title: string; status: string }
    expect(value).toEqual({ id: value.id, kind: 'report', title: '迁移报告', status: 'ready' })
    expect(value.id).toMatch(/^art-/u)
    expect(text(result)).toContain('迁移报告')
    const events = agent.session.events.filter(e => e.type.startsWith('artifact/'))
    expect(events.map(e => e.type)).toEqual(['artifact/created', 'artifact/status'])
    expect(events[0]!.data).toEqual({ id: value.id, kind: 'report', title: '迁移报告' })
    expect(events[1]!.data).toEqual({ id: value.id, status: 'ready' })
    expect(new TextDecoder().decode(store.stored.get(value.id)!)).toBe('# 报告\n正文')
  })

  it('journals failed and errors when the channel refuses the bytes', async () => {
    const { ctx, store } = await setup()
    store.failNextPut = true
    const agent = agentWithSession('failing')
    const result = await callArtifact(ctx, { kind: 'report', title: 'R', content: 'x' }, { agent })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('disk full')
    const events = agent.session.events.filter(e => e.type.startsWith('artifact/'))
    expect(events.map(e => e.type)).toEqual(['artifact/created', 'artifact/status'])
    expect((events[1]!.data as { status: string }).status).toBe('failed')
  })

  it('rejects a caller without an owning agent session and journals nothing', async () => {
    const { ctx } = await setup()
    const result = await callArtifact(ctx, { kind: 'report', title: 'R', content: 'x' }, { agent: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('owning agent session')
  })

  it('reads a stored artifact back with kind and title from the journal', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('reader')
    const created = await callArtifact(ctx, { kind: 'report', title: '迁移报告', content: '# 报告\n正文' }, { agent })
    if (created.isError) throw new Error('expected artifact_create success')
    const read = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-read-1'),
      name: 'artifact_read',
      arguments: { id: (created.value as { id: string }).id },
      agent,
    })
    expect(read.isError).toBe(false)
    if (read.isError) throw new Error('expected artifact_read success')
    expect(read.value).toEqual({ id: (created.value as { id: string }).id, kind: 'report', title: '迁移报告', content: '# 报告\n正文', truncated: false, size: 7 })
  })

  it('reads one UTF-16 range with offset and limit', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('pager')
    const created = await callArtifact(ctx, { kind: 'report', title: 'R', content: '0123456789' }, { agent })
    if (created.isError) throw new Error('expected artifact_create success')
    const read = async (over: { offset?: number; limit?: number }) => await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-page'),
      name: 'artifact_read',
      arguments: { id: (created.value as { id: string }).id, ...over },
      agent,
    })
    const first = await read({ offset: 0, limit: 4 })
    expect(first.isError).toBe(false)
    expect(first.value).toMatchObject({ content: '0123', truncated: true, size: 10 })
    const tail = await read({ offset: 8 })
    expect(tail.value).toMatchObject({ content: '89', truncated: false, size: 10 })
    const negative = await read({ offset: -1 })
    expect(negative.isError).toBe(true)
  })

  it('fails loud on an id the channel never stored', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-read-2'),
      name: 'artifact_read',
      arguments: { id: 'art-never-stored' },
      agent: agentWithSession('reader-2'),
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no content stored under id "art-never-stored"')
  })

  it('rejects an empty kind or title', async () => {
    const { ctx } = await setup()
    const blankKind = await callArtifact(ctx, { kind: '  ', title: 'R', content: 'x' })
    expect(blankKind.isError).toBe(true)
    const blankTitle = await callArtifact(ctx, { kind: 'report', title: '', content: 'x' })
    expect(blankTitle.isError).toBe(true)
  })
})

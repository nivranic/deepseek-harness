/** The chapter-40 handoff L1 command: create + pin title + queue the rendered snapshot brief. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionHandoffSnapshot } from '../src/types.ts'

const snapshot: SessionHandoffSnapshot = {
  sourceSessionId: 'lite-7f3a',
  sourceRuntime: 'lite',
  requestedCapability: 'run_tests',
  recentContext: [
    { role: 'user', text: '帮我跑一遍测试' },
    { role: 'assistant', text: '本机 Lite 无法运行测试，需要宿主。' },
  ],
  planActive: true,
  todo: [{ content: '在宿主继续执行测试', status: 'pending' }],
  artifactRefs: [{ id: 'art-lite-1', kind: 'report', title: '本机报告', status: 'ready' }],
  modelPreference: 'deepseek-chat',
  provenance: { deviceId: 'dev-phone', platform: 'ios', at: 1_782_000_000_000 },
}

async function handoffHarness(providers: string[] = ['fixture']): Promise<{
  ctx: Context
  controller: SessionCommandController
  renameTitle: ReturnType<typeof vi.fn>
  followup: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  ctx.provide('llm', {
    listProviders: () => providers.map(id => ({ id, name: id })),
  } as never)
  const renameTitle = vi.fn((session: Session, title: string) => ({ title, eventSeq: session.events.length }))
  ctx.provide('sessionTitle', { rename: renameTitle } as never)
  const followup = vi.fn()
  const ensureSession = vi.fn((sessionId: SessionId, cwd: string) => {
    const session = ctx.sessions.create(sessionId, { meta: { cwd } })
    const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
    const agent = {
      id: sessionId,
      session,
      inbox,
      status: 'idle',
      ctx,
      steer: vi.fn(),
      followup,
      cancel: vi.fn(),
    } as unknown as Agent
    ctx.agents.register(agent)
    return Promise.resolve(agent)
  })
  const agents = {
    ensureSession,
    resolveAgent: (id: SessionId) => {
      const agent = ctx.agents.get(id)
      if (agent === undefined) throw new Error(`no agent for ${id}`)
      return Promise.resolve({ agent })
    },
    selectionFor: () => ({ current: { provider: 'fixture', model: 'fixture-model' }, assembled: undefined }),
    serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    presetForSession: () => undefined,
  } as unknown as ApiSessionAgentController
  return { ctx, controller: new SessionCommandController(ctx, agents, '/workspace'), renameTitle, followup }
}

function briefTextOf(call: unknown[] | undefined): string {
  if (call === undefined || call[0] === undefined) {
    throw new Error(`handoff followup args: ${JSON.stringify(call)}`)
  }
  const message = call[0] as UserMessage
  const part = message.content.find(block => block.type === 'text')
  if (part === undefined) throw new Error('handoff brief carries no text block')
  return part.type === 'text' ? part.text : ''
}

describe('Session handoff (chapter 40 L1)', () => {
  it('creates the session, pins the title, and queues the rendered snapshot brief', async () => {
    const { ctx, controller, renameTitle, followup } = await handoffHarness()
    const value = await controller.handoff({ snapshot })
    expect(value.sessionId).toMatch(/^session-/u)
    expect(renameTitle).toHaveBeenCalledTimes(1)
    expect(renameTitle.mock.calls[0]![1]).toBe('设备接力：run_tests')
    expect(followup).toHaveBeenCalledTimes(1)
    const brief = briefTextOf(followup.mock.calls[0])
    expect(brief).toContain('run_tests')
    expect(brief).toContain('dev-phone')
    expect(brief).toContain('lite-7f3a')
    expect(brief).toContain('计划模式：开')
    expect(brief).toContain('在宿主继续执行测试')
    expect(brief).toContain('本机报告')
    expect(brief).toContain('deepseek-chat')
    expect(brief).toContain('[用户] 帮我跑一遍测试')
    expect(brief).toContain('[助手] 本机 Lite 无法运行测试，需要宿主。')
    expect(brief).toContain('请在本机继续完成上述能力所需的工作。')
    await ctx.fiber.dispose()
  })

  it('fails loud when no adapter serves the selected provider', async () => {
    const { ctx, controller } = await handoffHarness([])
    await expect(controller.handoff({ snapshot })).rejects.toMatchObject({
      failure: { code: 'model-unavailable' },
    })
    await ctx.fiber.dispose()
  })

  it('renders a snapshot without optional parts and empty panes honestly', async () => {
    const { ctx, controller, followup } = await handoffHarness()
    const lean: SessionHandoffSnapshot = {
      sourceSessionId: 'lite-lean',
      sourceRuntime: 'lite',
      requestedCapability: 'workflow',
      recentContext: [],
      planActive: false,
      todo: [],
      artifactRefs: [],
      provenance: { deviceId: 'dev-pad', platform: 'android', at: 1_782_000_100_000 },
    }
    await controller.handoff({ snapshot: lean })
    const brief = briefTextOf(followup.mock.calls[0])
    expect(brief).toContain('计划模式：关')
    expect(brief).toContain('待办：无')
    expect(brief).toContain('dev-pad')
    expect(brief).not.toContain('模型偏好')
    expect(brief).not.toContain('最近对话')
    await ctx.fiber.dispose()
  })
})

// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalPanel } from '../src/client/ApprovalPanel.tsx'
import type { ApprovalComposerProps } from '../src/client/contract/slots.ts'
import { PendingApproval } from '../src/client/contract/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

type ApprovalListener = (
  this: Context,
  request: {
    toolName: string
    callId?: string
    reason?: string
    signal?: AbortSignal
  },
  next: () => Promise<'unavailable'>,
) => Promise<unknown>

interface PluginBench {
  readonly ctx: Context
  readonly listener: ApprovalListener
  readonly pending: { getSnapshot(): readonly PendingApproval[] }
  readonly registerPendingInteraction: ReturnType<typeof vi.fn>
  readonly disposeSlot: ReturnType<typeof vi.fn>
  readonly disposeLocale: ReturnType<typeof vi.fn>
  readonly register: ReturnType<typeof vi.fn>
  readonly injectSlot: ReturnType<typeof vi.fn>
  releasePending(): Promise<void>
  registration(): {
    options: {
      select(props: { pendingInteraction: PendingApproval | undefined }): PendingApproval | null
    }
    component: unknown
  }
}

function setupPlugin(): PluginBench {
  const ctx = new Context()
  let listener: ApprovalListener | undefined
  let registration: {
    options: {
      select(props: { pendingInteraction: PendingApproval | undefined }): PendingApproval | null
    }
    component: unknown
  } | undefined
  const disposeSlot = vi.fn()
  const disposeLocale = vi.fn()
  const pending = new Map<PendingApproval, () => Promise<void>>()
  const registerPendingInteraction = vi.fn((_precedence: (value: PendingApproval) => number) => (
    value: PendingApproval,
    delegate: () => Promise<void>,
  ) => {
    _precedence(value)
    pending.set(value, delegate)
    return () => { pending.delete(value) }
  })
  const register = vi.fn((
    options: NonNullable<typeof registration>['options'],
    component: unknown,
  ) => {
    registration = { options, component }
    return disposeSlot
  })
  const injectSlot = vi.fn((_name: string, mount: () => () => void) => {
    const dispose = ctx.effect(() => mount())
    return () => { void dispose() }
  })
  ctx.provide('remote', {
    $on: (_event: string, callback: ApprovalListener) => {
      listener = callback
      return () => {}
    },
  } as never)
  ctx.provide('connection', {
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never)
  ctx.provide('sessions', { scopeOf } as never)
  ctx.provide('uiSession', { registerPendingInteraction } as never)
  ctx.provide('slots', { inject: injectSlot, register } as never)
  ctx.provide('locale', {
    register: vi.fn(() => disposeLocale),
  } as never)

  apply(ctx)
  if (listener === undefined) throw new Error('approval listener was not registered')
  return {
    ctx,
    listener,
    pending: { getSnapshot: () => [...pending.keys()] },
    registerPendingInteraction,
    disposeSlot,
    disposeLocale,
    register,
    injectSlot,
    async releasePending() {
      const delegates = [...pending.values()]
      pending.clear()
      await Promise.allSettled(delegates.map(delegate => delegate()))
    },
    registration: () => {
      if (registration === undefined) throw new Error('approval slot was not registered')
      return registration
    },
  }
}

const id = (value: string): SessionId => value as SessionId

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PendingApproval', () => {
  it('resolves once, removes its abort listener, and ignores later abort cleanup', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = new PendingApproval(id('s1'), {
      toolName: 'bash',
      callId: 'call-1' as ToolCallId,
      reason: 'needs access',
      signal: controller.signal,
    })

    await pending.answer('allowed-once')

    await expect(pending.result).resolves.toBe('allowed-once')
    expect(pending.sessionId).toBe(id('s1'))
    expect(pending.toolName).toBe('bash')
    expect(pending.callId).toBe('call-1')
    expect(pending.reason).toBe('needs access')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(() => { pending.abort(new Error('late')) }).not.toThrow()
    expect(() => { pending.delegate() }).not.toThrow()
    await expect(pending.answer('rejected')).rejects.toThrow(/already settled/)
  })

  it('rejects with an already-aborted signal reason', async () => {
    const controller = new AbortController()
    const reason = new Error('host cancelled')
    controller.abort(reason)

    const pending = new PendingApproval(id('s1'), {
      toolName: 'read',
      signal: controller.signal,
    })

    await expect(pending.result).rejects.toBe(reason)
  })

  it('uses a stable fallback when an abort signal supplies no reason', async () => {
    const signal = {
      aborted: true,
      reason: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal

    const pending = new PendingApproval(id('s1'), { toolName: 'read', signal })

    await expect(pending.result).rejects.toThrow('approval request was aborted')
  })

  it('rejects an unanswered request explicitly without an AbortSignal', async () => {
    const pending = new PendingApproval(id('s1'), { toolName: 'write' })
    const reason = new Error('scope released')

    pending.abort(reason)

    await expect(pending.result).rejects.toBe(reason)
  })

  it('wraps a non-Error answer settlement failure with its cause', async () => {
    const failure = 'resolve failed'
    const completion = Promise.withResolvers<'allowed-once' | 'rejected'>()
    const withResolvers = vi.spyOn(Promise, 'withResolvers').mockImplementationOnce(() => ({
      promise: completion.promise,
      resolve: () => { throw failure },
      reject: completion.reject,
    }))
    const pending = new PendingApproval(id('s1'), { toolName: 'write' })
    withResolvers.mockRestore()

    const settlement = await pending.answer('allowed-once').catch((error: unknown) => error)

    expect(settlement).toBeInstanceOf(Error)
    expect(settlement).toMatchObject({
      message: 'pending approval settlement failed',
      cause: failure,
    })
    completion.resolve('allowed-once')
    await expect(pending.result).resolves.toBe('allowed-once')
  })
})

describe('approval Remote Event consumer', () => {
  it('delegates an event that has no Agent scope', async () => {
    const bench = setupPlugin()
    const next = vi.fn(() => Promise.resolve<'unavailable'>('unavailable'))

    await expect(bench.listener.call(bench.ctx, { toolName: 'bash' }, next))
      .resolves.toBe('unavailable')
    expect(next).toHaveBeenCalledOnce()
    expect(bench.pending.getSnapshot()).toEqual([])
    expect(bench.register).toHaveBeenCalledOnce()
  })

  it('publishes one scoped takeover, returns the answer, and keeps stable registrations', async () => {
    const bench = setupPlugin()
    const scope = createScope(bench.ctx, id('s1'))
    await scope.fiber.await()
    const controller = new AbortController()
    const next = vi.fn(() => Promise.resolve<'unavailable'>('unavailable'))
    const result = bench.listener.call(scope.ctx, {
      toolName: 'bash',
      callId: 'call-1',
      reason: 'needs access',
      signal: controller.signal,
    }, next)
    const pending = bench.pending.getSnapshot()[0]!
    const { options, component } = bench.registration()

    expect(component).toBe(ApprovalPanel)
    expect(options.select({ pendingInteraction: undefined })).toBeNull()
    expect(options.select({ pendingInteraction: pending })).toBe(pending)
    expect(pending).toMatchObject({
      kind: 'approval',
      sessionId: id('s1'),
      toolName: 'bash',
      callId: 'call-1',
      reason: 'needs access',
    })

    await pending.answer('allowed-once')

    await expect(result).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
    expect(bench.pending.getSnapshot()).toEqual([])
    expect(bench.register).toHaveBeenCalledOnce()
    expect(bench.disposeSlot).not.toHaveBeenCalled()
    await scope.fiber.dispose()
  })

  it('propagates request cancellation after removing the pending object', async () => {
    const bench = setupPlugin()
    const scope = createScope(bench.ctx, id('s1'))
    await scope.fiber.await()
    const controller = new AbortController()
    const reason = new Error('cancelled by host')
    const result = bench.listener.call(scope.ctx, {
      toolName: 'bash',
      signal: controller.signal,
    }, () => Promise.resolve('unavailable'))
    expect(bench.pending.getSnapshot()).toHaveLength(1)

    controller.abort(reason)

    await expect(result).rejects.toBe(reason)
    expect(bench.pending.getSnapshot()).toEqual([])
    expect(bench.disposeSlot).not.toHaveBeenCalled()
    await scope.fiber.dispose()
  })

  it('delegates an active request when its interaction domain unloads', async () => {
    const bench = setupPlugin()
    const scope = createScope(bench.ctx, id('s1'))
    await scope.fiber.await()
    const next = vi.fn(() => Promise.resolve<'unavailable'>('unavailable'))
    const result = bench.listener.call(scope.ctx, { toolName: 'bash' }, next)
    expect(bench.pending.getSnapshot()).toHaveLength(1)

    await bench.releasePending()

    await expect(result).resolves.toBe('unavailable')
    expect(next).toHaveBeenCalledOnce()
    expect(bench.pending.getSnapshot()).toEqual([])
    await scope.fiber.dispose()
  })

  it('publishes a scoped request without optional request metadata', async () => {
    const bench = setupPlugin()
    const scope = createScope(bench.ctx, id('s1'))
    await scope.fiber.await()
    const result = bench.listener.call(scope.ctx, { toolName: 'read' }, () => Promise.resolve('unavailable'))
    const pending = bench.pending.getSnapshot()[0]!

    await pending.answer('rejected')

    await expect(result).resolves.toBe('rejected')
    expect(pending).toMatchObject({ toolName: 'read' })
    expect(pending.callId).toBeUndefined()
    expect(pending.reason).toBeUndefined()
    await scope.fiber.dispose()
  })

  it('removes stable registrations with the plugin lifetime', async () => {
    const bench = setupPlugin()
    await bench.ctx.fiber.dispose()
    expect(bench.disposeSlot).toHaveBeenCalledOnce()
    expect(bench.disposeLocale).toHaveBeenCalledOnce()
  })
})

function panelProps(
  pending: PendingApproval,
  renderSlot: ApprovalComposerProps['renderSlot'] = vi.fn(() => null),
): ApprovalComposerProps {
  const messages: Record<string, string> = {
    waiting: 'Waiting',
    'detail.aria': 'Approval details',
    escalation: `Tool ${pending.toolName} asks`,
    'fact.operation': 'Operation',
    'fact.host': 'Host',
    'fact.workspace': 'Workspace',
    'fact.risk': 'Risk',
    'fact.escalation': 'Permission escalation',
    'fact.preview': 'Command preview',
    'risk.low': 'Low risk',
    'risk.moderate': 'Moderate risk',
    'risk.high': 'High risk',
    'risk.critical': 'Critical risk',
    reject: 'Reject',
    allowOnce: 'Allow once',
  }
  return {
    matched: pending,
    renderSlot,
    useHostFacts: (selector: (host: unknown) => unknown) => selector(hostFacts),
    useWorkspaces: (selector: (state: unknown) => unknown) => selector(workspaceState),
    sessionId: id('s1'),
    t: (key: string) => messages[key] ?? key,
  } as unknown as ApprovalComposerProps
}

/** The fact block's host share; undefined means no established generation. */
let hostFacts: unknown = undefined
/** The fact block's workspace share; items keyed by sessionIds. */
let workspaceState: unknown = { items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }

describe('ApprovalPanel', () => {
  it('renders fallback copy without detail and returns rejection', async () => {
    const pending = new PendingApproval(id('s1'), { toolName: 'bash' })
    const props = panelProps(pending)
    render(<ApprovalPanel {...props} />)

    expect(screen.getByText('Tool bash asks')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Approval details' })).toBeTruthy()
    expect(props.renderSlot).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await expect(pending.result).resolves.toBe('rejected')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reject' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Allow once' }).disabled).toBe(true)
  })

  it('renders correlated detail and returns allow-once', async () => {
    const pending = new PendingApproval(id('s1'), {
      toolName: 'bash',
      callId: 'call-1' as ToolCallId,
      reason: 'Run this exact command',
    })
    const renderSlot = vi.fn(() => <code>pnpm test</code>)
    render(<ApprovalPanel {...panelProps(pending, renderSlot)} />)

    expect(screen.getByText('Run this exact command')).toBeTruthy()
    expect(screen.getByText('pnpm test')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('conversation.approval.detail', {
      callId: 'call-1',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await expect(pending.result).resolves.toBe('allowed-once')
  })

  it('names every section-38 fact beside the decision and hides rows without data', () => {
    hostFacts = { home: '/home/u', platform: 'win32', descriptor: { displayName: 'Workstation' } }
    workspaceState = {
      items: [{ sessionIds: [id('s1')], title: 'project' }],
      archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    }
    const pending = new PendingApproval(id('s1'), {
      toolName: 'bash',
      reason: 'escalate sandbox to danger-full-access: run the installer',
      risk: 'high',
    })
    const { container } = render(<ApprovalPanel {...panelProps(pending)} />)
    const facts = container.querySelector('[data-approval-facts]')
    expect(facts?.textContent).toBe(
      'Operationbash'
      + 'HostWorkstation'
      + 'Workspaceproject'
      + 'RiskHigh risk'
      + 'Permission escalationescalate sandbox to danger-full-access: run the installer',
    )
    cleanup()

    hostFacts = undefined
    workspaceState = { items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }
    const bare = new PendingApproval(id('s1'), { toolName: 'bash' })
    const bareView = render(<ApprovalPanel {...panelProps(bare)} />)
    const bareFacts = bareView.container.querySelector('[data-approval-facts]')
    // Only the operation row survives without generation, workspace, tier, or reason.
    expect(bareFacts?.textContent).toBe('Operationbash')
  })

  it('re-enables actions when answering fails', async () => {
    const pending = new PendingApproval(id('s1'), { toolName: 'bash' })
    vi.spyOn(pending, 'answer').mockRejectedValue(new Error('transport closed'))
    render(<ApprovalPanel {...panelProps(pending)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Allow once' }).disabled).toBe(true)
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Allow once' }).disabled).toBe(false)
    })
    pending.abort(new Error('test cleanup'))
    await pending.result.catch(() => {})
  })
})

describe('package entries', () => {
  it('declares its service edges and keeps the Host half inert', () => {
    expect(inject).toEqual(['sessions', 'remote', 'uiSession', 'slots', 'locale', 'connection'])
    expect(() => { nodeApply() }).not.toThrow()
  })
})

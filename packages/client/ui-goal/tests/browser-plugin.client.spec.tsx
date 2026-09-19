// @vitest-environment jsdom
/**
 * ui-goal browser half on a real cordis Context with fake slots/api/
 * sessions faces: the plugin registers the GoalBar dock entry at
 * conversation.input.dock, the inject face's four verbs read the CAS ref
 * from the session's CURRENT projected value at call time (no fence — the
 * Remote method's compare-and-set is the guard), a missing projection short-circuits
 * to the no-current-goal error without touching the wire, and a Remote failure
 * reaches the strip verbatim. Registration disposal rides the
 * plugin fiber (HMR safety), and the node half stays inert.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GoalActivation, GoalId, GoalProjection, GoalView } from '@deepseek-ai/dsh-goal/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure, RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { GoalAccessSnapshot, GoalActionResult, GoalActivationSnapshot, GoalBarActions, GoalBarInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { GoalDock } from '../src/client/GoalBar.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId
const GOAL_ID = 'g-1' as GoalId

function makeProjection(revision = 3): GoalProjection {
  return {
    goal: {
      id: GOAL_ID,
      revision,
      objective: 'Ship it',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 1,
    createdAt: 10,
    updatedAt: 20,
  }
}

function goalAccessHook(actions: GoalBarActions) {
  return (select: (value: GoalAccessSnapshot) => unknown) => select({ generation: 1, readable: true, actions })
}

/** Boot the plugin over fake faces; Goal Remote methods record arguments and answer per the script. */
async function bench(options: {
  projection?: GoalProjection | null | undefined
  activation?: GoalActivation
  failWith?: RemoteFailure
  capabilities?: readonly string[]
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const sessions = {
    binding: (id: SessionId) => id === sid('missing') ? undefined : ({
      sessionId: id,
      session: {
        getSnapshot: () => ({ running: false }),
        subscribe: () => () => {},
        projections: { faceOf: (key: string) => ({
          getSnapshot: () => (key === 'goal' ? options.projection : undefined),
          subscribe: () => () => {},
        }) },
      },
      ctx,
    }),
  }
  ctx.provide('sessions', sessions)
  const conversationEvents = new UiConversation(ctx, sessions as never).events
  function answer<T>(method: string, value: T) {
    return (...args: unknown[]) => {
      calls.push({ method, args })
      if (options.failWith !== undefined) return Promise.resolve({ ok: false, error: options.failWith })
      return Promise.resolve({ ok: true, value })
    }
  }
  const ref = { id: 'g-1', revision: 3 }
  const goalView = (): GoalView | undefined => {
    if (options.projection === null || options.projection === undefined) return undefined
    return {
      ...options.projection.goal,
      roundsStarted: options.projection.roundsStarted,
      createdAt: options.projection.createdAt,
      updatedAt: options.projection.updatedAt,
      activation: options.activation ?? 'armed',
    }
  }
  const goals = (prefix: string) => ({
    get: answer(`${prefix}/get`, goalView()),
    edit: answer(`${prefix}/edit`, { ref }),
    pause: answer(`${prefix}/pause`, { ref }),
    resume: answer(`${prefix}/resume`, { ref }),
    clear: answer(`${prefix}/clear`, ref),
  })
  let activeGoals: ReturnType<typeof goals> | undefined = goals('goals')
  class RemoteService extends Service {
    $host: RemoteHostFacts = { home: undefined, isLoopback: true, capabilities: options.capabilities ?? [
      'goal.read.v1', 'goal.edit.v1', 'goal.pause.v1', 'goal.resume.v1', 'goal.clear.v1',
    ] }
    readonly activationListeners = new Set<(event: {
      sessionId: SessionId
      goal?: { id: string; revision: number; activation: GoalActivation }
    }) => void>()

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $on(_event: string, listener: (event: {
      sessionId: SessionId
      goal?: { id: string; revision: number; activation: GoalActivation }
    }) => void): () => void {
      this.activationListeners.add(listener)
      return () => { this.activationListeners.delete(listener) }
    }

    emitActivation(
      sessionId: SessionId,
      goal: { id: string; revision: number; activation: GoalActivation } | undefined,
    ): void {
      for (const listener of this.activationListeners) {
        listener({ sessionId, ...goal === undefined ? {} : { goal } })
      }
    }
  }
  const remote = new RemoteService(ctx)
  const generationListeners = new Set<() => void>()
  ctx.provide('connection', { generation: { subscribe: (listener: () => void) => {
    generationListeners.add(listener)
    return () => { generationListeners.delete(listener) }
  } } })
  const reconnect = (capabilities: readonly string[]) => {
    remote.$host = { ...remote.$host, capabilities }
    for (const listener of generationListeners) listener()
  }
  ctx.provide('remote.goals', {
    get get() { return activeGoals?.get },
    get edit() { return activeGoals?.edit },
    get pause() { return activeGoals?.pause },
    get resume() { return activeGoals?.resume },
    get clear() { return activeGoals?.clear },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    reconnect,
    fiber,
    calls,
    emitActivation: remote.emitActivation.bind(remote),
    definitions: () => conversationEvents.entries(),
    remountGoals: () => { activeGoals = goals('remounted-goals') },
    unmountGoals: () => { activeGoals = undefined },
    entry: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => GoalBarInjected) | undefined,
      }
    },
    chatEntry: () => ctx.slots.entries('conversation.chat.node')[0],
  }
}

describe('ui-goal browser plugin', () => {
  it('registers the GoalBar dock, command input Definition, and keyed Chat renderer', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toMatchObject({ id: 'goal', order: 10, locale: 'goal' })
    expect(b.entry()?.inject).toBeTypeOf('function')
    expect(() => b.entry()!.inject!(sid('missing'))).toThrow(/unavailable/)
    expect(b.definitions().map(definition => definition.kind)).toEqual(['goal-command-input'])
    expect(b.chatEntry()?.options).toMatchObject({ key: 'command-input' })
    expect(b.chatEntry()?.locale).toBe('goal')
  })

  it('verbs read the CAS ref from the current projected value at call time', async () => {
    const b = await bench({ projection: makeProjection(5) })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1')).hooks.goalAccess.getSnapshot().actions
    // The strip forwards the Remote value verbatim; `answered` is the fake's
    // reply, unrelated to the CAS ref the call carries.
    const answered = { id: 'g-1', revision: 3 }
    expect(await verbs.onEdit!('New objective')).toEqual({ ok: true, value: { ref: answered } })
    expect(await verbs.onPause!()).toEqual({ ok: true, value: { ref: answered } })
    expect(await verbs.onResume!()).toEqual({ ok: true, value: { ref: answered } })
    expect(await verbs.onClear!()).toEqual({ ok: true, value: answered })
    expect(b.calls.map(c => c.method)).toEqual(['goals/edit', 'goals/pause', 'goals/resume', 'goals/clear'])
    const ref = { id: 'g-1', revision: 5 }
    expect(b.calls[0]?.args).toEqual(['s1', ref, { objective: 'New objective' }])
    expect(b.calls[1]?.args).toEqual(['s1', ref])
    expect(b.calls[2]?.args).toEqual(['s1', ref])
    expect(b.calls[3]?.args).toEqual(['s1', ref])
  })

  it('verbs read a remounted Remote namespace at action time', async () => {
    const b = await bench({ projection: makeProjection() })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1')).hooks.goalAccess.getSnapshot().actions
    b.remountGoals()

    expect(await verbs.onPause!()).toEqual({ ok: true, value: { ref: { id: 'g-1', revision: 3 } } })
    expect(b.calls).toMatchObject([{ method: 'remounted-goals/pause' }])
  })

  it('binds the activation hook and forwards only this session activation events', async () => {
    const b = await bench({ projection: makeProjection(), activation: 'disarmed' })
    await b.fiber.await()
    const injected = b.entry()!.inject!(sid('s1'))
    const source = injected.hooks.goalActivation
    const seen: unknown[] = []
    const dispose = source.subscribe(() => { seen.push(source.getSnapshot()) })
    await waitFor(() => {
      expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 3, activation: 'disarmed' })
    })
    expect(b.calls.at(-1)).toMatchObject({ method: 'goals/get', args: ['s1'] })

    b.emitActivation(sid('s2'), { id: 'g-1', revision: 3, activation: 'armed' })
    expect(source.getSnapshot().activation).toBe('disarmed')
    b.emitActivation(sid('s1'), { id: 'g-1', revision: 3, activation: 'armed' })
    expect(source.getSnapshot().activation).toBe('armed')
    dispose()
    expect(seen.length).toBeGreaterThan(0)
  })

  it('rejects every verb once the Remote namespace is gone', async () => {
    const b = await bench({ projection: makeProjection() })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1')).hooks.goalAccess.getSnapshot().actions
    b.unmountGoals()

    // A transport implementation can reject instead of returning a Remote result;
    // the action contains that rejection so the strip can offer an explicit retry.
    for (const verb of [() => verbs.onEdit!('x'), () => verbs.onPause!(), () => verbs.onResume!(), () => verbs.onClear!()]) {
      await expect(verb()).resolves.toMatchObject({ ok: false, error: { code: 'goal-request-failed' } })
    }
    expect(b.calls).toHaveLength(0)
  })

  it('a null or absent projection short-circuits every verb without touching the wire', async () => {
    for (const projection of [null, undefined]) {
      const b = await bench({ projection })
      await b.fiber.await()
      const verbs = b.entry()!.inject!(sid('s1')).hooks.goalAccess.getSnapshot().actions
      for (const result of [await verbs.onEdit!('x'), await verbs.onPause!(), await verbs.onResume!(), await verbs.onClear!()]) {
        expect(result).toEqual({ ok: false, error: { code: 'no-current-goal', message: 'no current goal to mutate' } })
      }
      expect(b.calls).toHaveLength(0)
    }
  })

  it('forwards a Remote failure to the strip verbatim', async () => {
    const b = await bench({
      projection: makeProjection(),
      failWith: new RemoteError('gateway/internal', 'stale revision', {}),
    })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1')).hooks.goalAccess.getSnapshot().actions
    expect(await verbs.onEdit!('x')).toMatchObject({ ok: false, error: { code: 'gateway/internal', message: 'stale revision' } })
  })

  it('drops the dock entry when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    expect(b.chatEntry()).toBeDefined()
    expect(b.definitions()).toHaveLength(1)
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.chatEntry()).toBeUndefined()
    expect(b.definitions()).toHaveLength(0)
  })
})

describe('GoalDock adapter', () => {
  it('renders the projected goal snapshot and nothing for absent/null', () => {
    const projection = makeProjection()
    const useProjection = vi.fn(() => projection)
    const useGoalActivation = (
      selector: (snapshot: GoalActivationSnapshot) => unknown,
    ) => selector({ id: GOAL_ID, revision: 3, activation: 'armed' })
    const actions: GoalBarActions = {
      onEdit: () => Promise.resolve({ ok: true, value: undefined }),
      onPause: () => Promise.resolve({ ok: true, value: undefined }),
      onResume: () => Promise.resolve({ ok: true, value: undefined }),
      onClear: () => Promise.resolve({ ok: true, value: undefined }),
    }
    const t = makeTranslate(zh, commonZh)
    const dockProps = (up: () => GoalProjection | null | undefined) =>
      ({ useProjection: up, useGoalActivation, useGoalAccess: goalAccessHook(actions), t }) as unknown as Parameters<typeof GoalDock>[0]
    const shown = render(<GoalDock {...dockProps(useProjection)} />)
    expect(shown.getByText('Ship it')).toBeTruthy()
    cleanup()

    const empty = render(<GoalDock {...dockProps(() => null)} />)
    expect(empty.container.firstChild).toBeNull()
    cleanup()

    const absent = render(<GoalDock {...dockProps(() => undefined)} />)
    expect(absent.container.firstChild).toBeNull()
  })

  it('matches activation by goal id and revision from the injected hook', () => {
    const projection = makeProjection()
    const useProjection = vi.fn(() => projection)
    const useGoalActivation = (
      selector: (snapshot: GoalActivationSnapshot) => unknown,
    ) => selector({ id: GOAL_ID, revision: 3, activation: 'disarmed' })
    const actions: GoalBarActions = {
      onEdit: () => Promise.resolve({ ok: true, value: undefined }),
      onPause: () => Promise.resolve({ ok: true, value: undefined }),
      onResume: () => Promise.resolve({ ok: true, value: undefined }),
      onClear: () => Promise.resolve({ ok: true, value: undefined }),
    }
    const t = makeTranslate(zh, commonZh)
    const props = { useProjection, useGoalActivation,
      useGoalAccess: goalAccessHook(actions), t } as unknown as Parameters<typeof GoalDock>[0]
    const rendered = render(<GoalDock {...props} />)
    expect(rendered.getByText('未运行的目标')).toBeTruthy()
    expect(screen.getByRole('button', { name: '恢复目标' })).toBeTruthy()
    expect(rendered.queryByRole('button', { name: '暂停目标' })).toBeNull()
  })
})

describe('ui-goal node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

it.each(['success', 'failure'] as const)('ignores an old GoalBar %s after an equally capable connection replacement', async (outcome) => {
  const pending = Promise.withResolvers<GoalActionResult>()
  let access: GoalAccessSnapshot = { generation: 1, readable: true, actions: { onClear: () => pending.promise } }
  const props = {
    useProjection: () => makeProjection(),
    useGoalActivation: (select: (value: GoalActivationSnapshot) => unknown) => select({}),
    useGoalAccess: (select: (value: GoalAccessSnapshot) => unknown) => select(access),
    t: makeTranslate(zh, commonZh),
  } as unknown as Parameters<typeof GoalDock>[0]
  const view = render(<GoalDock {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '清除目标' }))
  access = { generation: 2, readable: true, actions: {
    onEdit: () => Promise.resolve({ ok: true, value: undefined }),
  } }
  view.rerender(<GoalDock {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑目标' }))
  fireEvent.change(screen.getByRole('textbox', { name: '目标内容' }), { target: { value: 'new Host draft' } })
  await act(async () => {
    pending.resolve(outcome === 'success' ? { ok: true, value: undefined } : {
      ok: false, error: { code: 'no-current-goal', message: 'old failure' },
    })
  })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('textbox', { name: '目标内容' })).toHaveProperty('value', 'new Host draft')
})

// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { CordisInventoryRow } from '../src/client/dynamic-port.ts'
import type { CordisPanelFace } from '../src/client/slots.ts'
import { CordisPanel, type CordisPanelProps } from '../src/client/CordisPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const ROW: CordisInventoryRow = {
  pluginId: 'proof' as never, agentId: 's1' as never,
  packages: [{ packageId: 'p1' as never, name: 'Proof', purpose: 'Inspect controls', hasHostHalf: true, hasClientHalf: false }],
}
const observable = <T,>(value: T) => ({ getSnapshot: () => value, subscribe: (_listener: () => void) => () => {} })

async function bench(operations: string[] = ['inventory']) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const generations = new Set<() => void>()
  ctx.provide('connection', { generation: { getSnapshot: () => undefined, subscribe: (listener: () => void) => {
    generations.add(listener)
    return () => { generations.delete(listener) }
  } } })
  class RemoteService extends Service {
    $host = { home: undefined, platform: undefined, isLoopback: true, capabilities: operations.map(id => 'dynamic-cordis.' + id + '.v1') }
    $on = () => () => {}
    constructor(scope: Context) { super(scope, 'remote') }
  }
  const remote = new RemoteService(ctx)
  const namespace = {
    inventory: vi.fn(async () => ({ ok: true as const, value: [ROW] })),
    stopFromPanel: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
    undefineFromPanel: vi.fn(async () => ({ ok: true as const, value: { ok: true as const } })),
  }
  ctx.provide('remote.dynamicCordisRunner', namespace)
  const loaded: readonly never[] = []
  const runner = {
    activeRuns: observable(new Map()), lastRunError: observable(new Map()), renderFailures: observable(new Map()),
    subscribe: (_listener: () => void) => () => {}, getSnapshot: () => loaded,
    reconcileApprovals: vi.fn(), approve: vi.fn(async () => {}), decline: vi.fn(async () => {}), startUserRun: vi.fn(async () => {}),
  }
  ctx.provide('dynamicCordisRunner', runner as never)
  const sources = new Set<InputTriggerSource>()
  ctx.provide('inputTriggers', { registerSource: (source: InputTriggerSource) => {
    sources.add(source)
    return () => { sources.delete(source) }
  } } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } } } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  const replace = (next = operations) => {
    remote.$host = { ...remote.$host, capabilities: next.map(id => 'dynamic-cordis.' + id + '.v1') }
    for (const listener of generations) listener()
  }
  const entry = () => slots.entries('sidebar.footer.action')[0]!
  const face = () => (entry().inject as unknown as () => CordisPanelFace)()
  return { ctx, fiber, slots, namespace, runner, sources, replace, face, entry, generations }
}

function panelProps(face: CordisPanelFace): CordisPanelProps {
  return {
    ...face, wide: true, t: makeTranslate(en, {}),
    useSessions: bindSnapshotSelector(observable({ current: ROW.agentId })),
    useInventory: bindSnapshotSelector(face.hooks.inventory),
    useActiveRuns: bindSnapshotSelector(face.hooks.activeRuns),
    useRunErrors: bindSnapshotSelector(face.hooks.runErrors),
    useLoaded: bindSnapshotSelector(face.hooks.loaded),
    useRenderFailures: bindSnapshotSelector(face.hooks.renderFailures),
  } as unknown as CordisPanelProps
}

describe('Dynamic Cordis panel capability registration', () => {
  it('does not read, mount a panel or register mentions without inventory support', async () => {
    const b = await bench([])
    expect(b.slots.entries('sidebar.footer.action')).toEqual([])
    expect(b.sources.size).toBe(0)
    expect(b.namespace.inventory).not.toHaveBeenCalled()
    b.replace(['inventory'])
    await vi.waitFor(() => { expect(b.face().hooks.inventory.getSnapshot().read).toBe(true) })
    expect(b.sources.size).toBe(1)
    await b.ctx.fiber.dispose()
  })

  it('separates read-only, Host-only run, two-half run, refusal, Stop and Remove', async () => {
    const b = await bench(['inventory'])
    await vi.waitFor(() => { expect(b.face().hooks.inventory.getSnapshot().read).toBe(true) })
    expect(b.face()).toMatchObject({ canApprove: false, canDecline: false, canStop: false, canRemove: false })
    expect(b.face().canRun(false)).toBe(false)
    b.replace(['inventory', 'run'])
    expect(b.face().canRun(false)).toBe(true)
    expect(b.face().canRun(true)).toBe(false)
    b.replace(['inventory', 'resolve-run', 'stop'])
    expect(b.face()).toMatchObject({ canApprove: false, canDecline: true, canStop: true, canRemove: false })
    b.replace(['inventory', 'run', 'client-code', 'settle-run', 'undefine'])
    expect(b.face().canRun(true)).toBe(true)
    expect(b.face()).toMatchObject({ canApprove: false, canDecline: false, canStop: false, canRemove: true })
    await b.ctx.fiber.dispose()
  })

  it('invalidates retained controls and mention picks even when replacement has the same support', async () => {
    const b = await bench(['inventory', 'run', 'stop', 'undefine'])
    const old = b.face()
    const component = b.entry().component
    const source = [...b.sources][0]!
    b.replace()
    expect(old.current()).toBe(false)
    expect(b.entry().component).not.toBe(component)
    await expect(old.onStop(ROW.agentId, ROW.pluginId)).rejects.toThrow('connection changed')
    await expect(old.onRemove(ROW.agentId, ROW.pluginId)).rejects.toThrow('connection changed')
    await expect(old.onRun({ agentId: ROW.agentId, pluginId: ROW.pluginId, packageId: 'p1' as never, mode: 'run', hasClientHalf: false }))
      .rejects.toThrow('connection changed')
    expect(source.onPick({ candidate: { name: 'proof' } } as never)).toBeUndefined()
    expect(b.namespace.stopFromPanel).not.toHaveBeenCalled()
    expect(b.namespace.undefineFromPanel).not.toHaveBeenCalled()
    expect(b.runner.startUserRun).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
    expect(b.generations.size).toBe(0)
  })

  it('does not retire a replacement row when an old Remove acknowledgement arrives', async () => {
    const b = await bench(['inventory', 'undefine'])
    const old = b.face()
    const gate = Promise.withResolvers<{ ok: true; value: { ok: true } }>()
    b.namespace.undefineFromPanel.mockReturnValueOnce(gate.promise)
    const pending = old.onRemove(ROW.agentId, ROW.pluginId)
    b.replace()
    await vi.waitFor(() => { expect(b.face().hooks.inventory.getSnapshot().rows).toEqual([ROW]) })
    gate.resolve({ ok: true, value: { ok: true } })
    await expect(pending).rejects.toThrow('connection changed')
    expect(b.face().hooks.inventory.getSnapshot().removed.size).toBe(0)
    expect(b.face().hooks.inventory.getSnapshot().rows).toEqual([ROW])
    await b.ctx.fiber.dispose()
  })

  it('renders only supported actions rather than disabled mutation buttons', async () => {
    const b = await bench(['inventory'])
    await vi.waitFor(() => { expect(b.face().hooks.inventory.getSnapshot().read).toBe(true) })
    const view = render(<CordisPanel {...panelProps(b.face())} />)
    fireEvent.click(view.getByRole('button', { name: en['panel.plugins.aria'] }))
    expect(view.queryByRole('button', { name: en['action.run'] })).toBeNull()
    expect(view.queryByRole('button', { name: en['action.remove'] })).toBeNull()
    act(() => { b.replace(['inventory', 'run']) })
    view.rerender(<CordisPanel key="replacement" {...panelProps(b.face())} />)
    await vi.waitFor(() => { expect(view.getByRole('button', { name: en['panel.plugins.aria'] })).toBeDefined() })
    fireEvent.click(view.getByRole('button', { name: en['panel.plugins.aria'] }))
    fireEvent.click(view.getByRole('button', { name: en['action.run'] }))
    await vi.waitFor(() => { expect(b.runner.startUserRun).toHaveBeenCalledOnce() })
    expect(view.queryByRole('button', { name: en['action.remove'] })).toBeNull()
    view.unmount()
    await b.ctx.fiber.dispose()
  })
})

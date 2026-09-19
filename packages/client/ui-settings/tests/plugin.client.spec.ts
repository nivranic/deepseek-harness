import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'
import { SettingsScopeBinder } from '../src/client/settings-scope.ts'
import { apply as hostApply } from '../src/index.ts'

function bench() {
  const describeCall = vi.fn().mockResolvedValue({
    ok: true, value: { writable: true, hasDocument: true, namespaces: [] },
  })
  const ctx = new Context()
  ctx.provide('connection', { generation: { subscribe: (listener: () => void) => ctx.on('connection/reset', listener) } })
  const remote = new TestRemote(ctx, { settings: { describe: describeCall } })
  remote.$host = { home: undefined, isLoopback: true, capabilities: ['settings.read.v1', 'settings.write.v1'] }
  return { ctx, describeCall, remote, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('withdraws the shared document immediately on generation loss and unsubscribes at disposal', async () => {
    const ctx = new Context()
    const listeners = new Set<() => void>()
    ctx.provide('connection', { generation: { subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    } } })
    const describe = vi.fn(async () => ({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } }))
    const remote = new TestRemote(ctx, { settings: { describe } })
    remote.$host = { home: undefined, isLoopback: true, capabilities: ['settings.read.v1', 'settings.write.v1'] }
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const mirror = ctx.settingsScope.describe()
    await mirror.ensure()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', view: { writable: true } })
    remote.$host = { home: undefined, isLoopback: true }
    for (const listener of listeners) listener()
    expect(mirror.getSnapshot()).toEqual({ status: 'loading', view: undefined, error: null })
    expect(describe).toHaveBeenCalledOnce()
    remote.$host = { home: undefined, isLoopback: true, capabilities: ['settings.read.v1'] }
    for (const listener of listeners) listener()
    await mirror.ensure()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', view: { writable: false } })
    expect(describe).toHaveBeenCalledTimes(2)
    await fiber.dispose()
    expect(listeners.size).toBe(0)
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('mounts the scope service under settingsScope and reads once eagerly', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
    expect(ctx.get('settingsSchema')).toBeInstanceOf(SettingsSchemaService)
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
  })

  it('refreshes the mirror on document commits and connection resets, once each', async () => {
    const { ctx, describeCall, remote, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    remote.emit('settings/document-updated', ['ui-test', 0])
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(2) })
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
  })

  it('fiber disposal retires the service and its invalidation subscriptions', async () => {
    const { ctx, describeCall, remote, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('settingsSchema')).toBeUndefined()
    remote.emit('settings/document-updated', ['ui-test', 0])
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
  })
})

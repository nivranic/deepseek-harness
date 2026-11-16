/**
 * The plugin body: one `file` provider registered into `ctx.resources` while
 * the admitted Host advertises stat support, reading through `ctx.remote` in
 * the Session each address names.
 */
import { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { apply, inject } from '../src/client/index.ts'
import { FakeRemote, settle } from './fake-remote.client.ts'

describe('workspace-files client apply', () => {
  it('keeps the newest discovery and withdraws admission on either failure form', async () => {
    const ctx = new Context()
    const remote = new FakeRemote()
    const first = Promise.withResolvers<Awaited<ReturnType<typeof remote.host.describe>>>()
    const second = Promise.withResolvers<Awaited<ReturnType<typeof remote.host.describe>>>()
    const late = Promise.withResolvers<Awaited<ReturnType<typeof remote.host.describe>>>()
    const describeHost = vi.spyOn(remote.host, 'describe').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    ctx.provide('remote', remote as never)
    ctx.provide('connection', { generation: remote.generation } as never)
    ctx.provide('remote.host', remote.host as never)
    ctx.provide('remote.workspaceFiles', remote.workspaceFiles as never)
    const release = vi.fn()
    const register = vi.fn(() => release)
    ctx.provide('resources', { register } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    onTestFinished(async () => { await ctx.fiber.dispose(); await remote.dispose() })
    await fiber
    remote.setConnected(true)
    second.resolve({ ok: true, value: { capabilities: ['workspace-files.stat.v1'] } })
    await settle()
    expect(register).toHaveBeenCalledOnce()
    first.resolve({ ok: true, value: { capabilities: [] } })
    await settle()
    expect(release).not.toHaveBeenCalled()
    describeHost.mockRejectedValueOnce(new Error('discovery unavailable'))
    remote.setConnected(true)
    await settle()
    expect(release).toHaveBeenCalledOnce()
    describeHost.mockResolvedValueOnce({
      ok: false, error: new RemoteError('gateway/connection-unavailable', 'offline', { endpoint: 'host/describe' }),
    })
    remote.setConnected(true)
    await settle()
    expect(register).toHaveBeenCalledOnce()
    describeHost.mockReturnValueOnce(late.promise)
    remote.setConnected(true)
    await fiber.dispose()
    late.resolve({ ok: true, value: { capabilities: ['workspace-files.stat.v1'] } })
    await settle()
    expect(register).toHaveBeenCalledOnce()
  })

  it('registers the file provider over ctx.remote, and unregisters it with the fiber', async () => {
    const ctx = new Context()
    const remote = new FakeRemote()
    remote.autoReady = false
    remote.admission = ['workspace-files.stat.v1', 'workspace-files.changes.v1']
    const controller = new AbortController()
    const pulls: Array<Promise<unknown>> = []
    ctx.provide('remote', remote as never)
    ctx.provide('connection', { generation: remote.generation } as never)
    ctx.provide('remote.host', remote.host as never)
    ctx.provide('remote.workspaceFiles', remote.workspaceFiles as never)
    const registered: Array<ResourceProvider<'file'>> = []
    let released = 0
    ctx.provide('resources', {
      register: (provider: ResourceProvider<'file'>) => {
        registered.push(provider)
        return () => {
          released++
          controller.abort()
          for (const request of remote.stats) {
            request.resolve({ ok: true, value: { absolutePath: '/host/late-stat', version: 'v0' } })
          }
        }
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    onTestFinished(async () => {
      await fiber.dispose()
      await remote.dispose()
      await Promise.all(pulls)
    })
    await fiber.await()
    // The admission describe round-trip settles on microtasks.
    await settle()

    expect(registered.map(provider => provider.protocol)).toEqual(['file'])
    const signal = controller.signal
    // A session address reaches the Host with its relative or absolute path.
    pulls.push(registered[0]!.open(sessionFileAddress('s1', 'a.txt'), { signal })[Symbol.asyncIterator]().next())
    pulls.push(registered[0]!.open(sessionFileAddress('s1', '/etc/hosts'), { signal })[Symbol.asyncIterator]().next())
    await Promise.all([remote.waitForChanges(0), remote.waitForChanges(1)])
    expect(remote.opened.map(watch => [watch.sessionId, watch.path])).toEqual([['s1', 'a.txt'], ['s1', '/etc/hosts']])
    expect(remote.stats).toEqual([])
    await remote.ready(0)
    await remote.waitForStat(0)
    expect(remote.stats.map(pending => [pending.sessionId, pending.path])).toEqual([['s1', 'a.txt']])
    await remote.ready(1)
    await remote.waitForStat(1)
    expect(remote.stats.map(pending => [pending.sessionId, pending.path])).toEqual([['s1', 'a.txt'], ['s1', '/etc/hosts']])
    expect(remote.opened).toHaveLength(2)

    await fiber.dispose()
    await Promise.all(pulls)
    expect(released).toBe(1)
    expect(remote.opened.map(watch => watch.source.aborted)).toEqual([true, true])
    expect(remote.disposed).toHaveLength(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { CordisInspectQueryRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { ClientCordisInspectRegistry } from '../src/client/inspect-registry.ts'

const manifest = { id: 'proof', description: 'lifetime proof', methods: [
  { name: 'read', description: 'read proof', inputSchema: {}, outputSchema: {} },
] }
const request: CordisInspectQueryRequest = { requestId: 'same' as never, agentId: 's1' as never, provider: 'proof', method: 'read' }

describe('inspect Connection lifetime', () => {
  it('skips a queued manifest on withdrawal and permits a fresh publication', async () => {
    const sync = vi.fn(async () => {})
    const registry = new ClientCordisInspectRegistry({ sync, resolve: async () => {} })
    registry.register({ manifest, query: async () => null })
    registry.reset()
    await Promise.resolve()
    await Promise.resolve()
    expect(sync).not.toHaveBeenCalled()
    registry.publish()
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledExactlyOnceWith([manifest]) })
    registry.dispose()
    registry.publish()
    await Promise.resolve()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('does not let a hanging old manifest block the replacement connection', async () => {
    const old = Promise.withResolvers<undefined>()
    const sync = vi.fn<() => Promise<void>>().mockReturnValueOnce(old.promise).mockResolvedValue(undefined)
    const registry = new ClientCordisInspectRegistry({ sync, resolve: async () => {} })
    registry.register({ manifest, query: async () => null })
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledTimes(1) })
    registry.publish()
    await Promise.resolve()
    registry.reset()
    registry.publish()
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledTimes(2) })
    old.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(sync).toHaveBeenCalledTimes(2)
    registry.dispose()
  })

  it('cancels old queries without freeing a replacement query using the same id', async () => {
    const gates = [Promise.withResolvers<null>(), Promise.withResolvers<null>()]
    const signals: AbortSignal[] = []
    const resolve = vi.fn(async () => {})
    const registry = new ClientCordisInspectRegistry({ sync: async () => {}, resolve })
    registry.register({ manifest, query: (_method, _input, context) => {
      const index = signals.length
      signals.push(context.signal)
      return gates[index]!.promise
    } })
    const before = registry.query(request)
    registry.reset()
    expect(signals[0]?.aborted).toBe(true)
    const after = registry.query(request)
    gates[0]!.resolve(null)
    await before
    await registry.query(request)
    expect(signals).toHaveLength(2)
    expect(resolve).not.toHaveBeenCalled()
    registry.close(request.requestId)
    expect(signals[1]?.aborted).toBe(true)
    gates[1]!.resolve(null)
    await after
    expect(resolve).not.toHaveBeenCalled()
    registry.dispose()
  })
})

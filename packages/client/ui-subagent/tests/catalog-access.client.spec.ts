import { expect, it, vi } from 'vitest'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import { createCatalogAccess } from '../src/client/catalog-access.ts'

it('withdraws catalog actions immediately and rejects retained menu callbacks after replacement', () => {
  let host: RemoteHostFacts = { home: undefined, isLoopback: true, capabilities: ['subagent.catalog.v1'] }
  const listeners = new Set<() => void>()
  const actions = { openChild: vi.fn(), refresh: vi.fn(), setCatalogOpen: vi.fn() }
  const source = createCatalogAccess(() => host,
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => true, actions)
  const first = source.getSnapshot()
  const listener = vi.fn()
  const dispose = source.subscribe(listener)
  host = { ...host, capabilities: [] }
  for (const notify of listeners) notify()
  expect(source.getSnapshot().actions).toBeUndefined()
  expect(listener).toHaveBeenCalledTimes(1)
  host = { ...host, capabilities: ['subagent.catalog.v1'] }
  for (const notify of listeners) notify()
  first.actions!.refresh('parent' as never)
  first.actions!.setCatalogOpen('parent' as never, true)
  first.actions!.openChild({ parentSessionId: 'p' as never, childSessionId: 'c' as never, mode: 'continuable' })
  expect(actions.openChild).not.toHaveBeenCalled()
  expect(actions.refresh).not.toHaveBeenCalled()
  expect(actions.setCatalogOpen).not.toHaveBeenCalled()
  source.getSnapshot().actions!.refresh('parent' as never)
  expect(actions.refresh).toHaveBeenCalledTimes(1)
  expect(source.getSnapshot().generation).not.toBe(first.generation)
  dispose()
  expect(listeners.size).toBe(0)
})

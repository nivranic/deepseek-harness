/** Selected endpoints are observed separately from admitted Host generations. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, type ConnectionHandle, type ConnectionGenerationSource } from '../src/client/index.ts'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'

const descriptor: HostDescriptor = {
  hostId: '4bf2b376-39e8-4a02-8d94-daf34f8ed6fb' as HostDescriptor['hostId'], displayName: 'Target Host',
  productVersion: '0.0.0-fixture', apiProtocolVersion: 1, sessionFormatVersion: 3, platform: 'win32', arch: 'x64',
  runtimeMode: 'full', capabilities: ['host.describe.v1'], transports: ['websocket'], serverTime: 0,
}

async function mount() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true, value: { hostname: 'page.local', search: '', origin: 'https://page.local' },
  })
  onTestFinished(() => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'location')
    else Object.defineProperty(globalThis, 'location', previous)
  })
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin({ apply, inject: [] }).await()
  const connection = ctx.get('connection') as ConnectionHandle
  const source: ConnectionGenerationSource = (signal, ready) => {
    ready({ home: '/workspace', platform: 'win32', descriptor })
    return new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  }
  connection.registerGenerationSource(source)
  return connection
}

function start(connection: ConnectionHandle) {
  const loop = connection.start({}, { backoffBaseMs: 1, backoffFactor: 2, backoffMaxMs: 8, generationReadyTimeoutMs: 100 })
  onTestFinished(() => { loop.stop() })
  return loop
}

describe('observed Host target', () => {
  it('records the selected endpoint instead of the page origin', async () => {
    const connection = await mount()
    connection.retarget('https://target.local:8787')
    start(connection)
    await vi.waitFor(() => { expect(connection.savedHosts.list()).toHaveLength(1) })
    expect(connection.savedHosts.list()[0]?.origin).toBe('https://target.local:8787')
  })

  it('notifies after retiring the old generation, deduplicates values, and disposes subscriptions', async () => {
    const connection = await mount()
    start(connection)
    await vi.waitFor(() => { expect(connection.state.getSnapshot()).toBe('ready') })
    const seen: Array<{ target: string | undefined; ready: boolean }> = []
    const unsubscribe = connection.target.subscribe(() => {
      seen.push({ target: connection.target.getSnapshot(), ready: connection.generation.getSnapshot() !== undefined })
    })
    connection.retarget('https://target.local/path')
    expect(seen).toEqual([{ target: 'https://target.local', ready: false }])
    connection.retarget('https://target.local')
    expect(seen).toHaveLength(1)
    expect(() => { connection.retarget('ftp://invalid.local') }).toThrow(TypeError)
    expect(connection.target.getSnapshot()).toBe('https://target.local')
    unsubscribe()
    connection.retarget(undefined)
    expect(seen).toHaveLength(1)
    expect(connection.target.getSnapshot()).toBeUndefined()
  })

  it('contains one observer failure so later observers still receive the selected origin', async () => {
    const connection = await mount()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    onTestFinished(() => { error.mockRestore() })
    const removeThrowing = connection.target.subscribe(() => { throw new Error('observer failure') })
    const listener = vi.fn()
    const removeListener = connection.target.subscribe(listener)
    onTestFinished(() => { removeThrowing(); removeListener() })
    expect(() => { connection.retarget('https://target.local') }).not.toThrow()
    expect(listener).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
  })
})

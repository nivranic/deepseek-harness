import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  type ConnectionGenerationSource,
  type ConnectionHandle,
} from '../src/client/index.ts'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'

type BrowserGlobal = {
  location?: { hostname: string; search: string }
}

const contexts = new Set<Context>()

afterEach(async () => {
  vi.restoreAllMocks()
  delete (globalThis as BrowserGlobal).location
  await Promise.all([...contexts].map(async ctx => ctx.fiber.dispose()))
  contexts.clear()
})

async function mount(): Promise<ConnectionHandle> {
  ;(globalThis as BrowserGlobal).location = { hostname: 'localhost', search: '?fixture' }
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin({ apply, inject: [] })
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('fixture did not provide Connection')
  return connection
}

describe('Connection generation facts', () => {
  it('publishes ready-frame Host facts and retracts them when the loop stops', async () => {
    const connection = await mount()
    const source: ConnectionGenerationSource = (signal, ready) => {
      ready({ home: '/home/from-ready', platform: 'linux' })
      return new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    connection.registerGenerationSource(source)
    const seen: Array<string | undefined> = []
    const stopListening = connection.generation.subscribe(() => {
      seen.push(connection.generation.getSnapshot()?.host.home)
    })
    const loop = connection.start({}, {
      backoffBaseMs: 1,
      backoffFactor: 2,
      backoffMaxMs: 8,
      generationReadyTimeoutMs: 100,
    })

    await vi.waitFor(() => {
      expect(connection.generation.getSnapshot()).toEqual({
        id: 1,
        host: { home: '/home/from-ready', platform: 'linux' },
      })
    })
    loop.stop()
    expect(connection.generation.getSnapshot()).toBeUndefined()
    expect(seen).toEqual(['/home/from-ready', undefined])
    stopListening()
  })

  it('records descriptor-bearing Hosts into the saved-Host roster, never descriptor-less ones', async () => {
    const connection = await mount()
    const descriptor: HostDescriptor = {
      hostId: '4bf2b376-39e8-4a02-8d94-daf34f8ed6fb' as HostDescriptor['hostId'],
      displayName: 'Work PC',
      productVersion: '0.0.0-fixture',
      apiProtocolVersion: 1,
      sessionFormatVersion: 3,
      platform: 'win32',
      arch: 'x64',
      runtimeMode: 'full',
      capabilities: ['host.describe.v1'],
      transports: ['websocket'],
      serverTime: 0,
    }
    const withDescriptor: ConnectionGenerationSource = (signal, ready) => {
      ready({ home: '/w', platform: 'win32', descriptor })
      return new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    connection.registerGenerationSource(withDescriptor)
    const loop = connection.start({}, {
      backoffBaseMs: 1,
      backoffFactor: 2,
      backoffMaxMs: 8,
      generationReadyTimeoutMs: 100,
    })
    await vi.waitFor(() => {
      expect(connection.savedHosts.list()).toHaveLength(1)
    })
    const row = connection.savedHosts.list()[0]!
    expect(row.hostId).toBe('4bf2b376-39e8-4a02-8d94-daf34f8ed6fb')
    expect(row.displayName).toBe('Work PC')
    expect(row.platform).toBe('win32')
    // The node bench's fake location carries no origin; the roster records the fallback.
    expect(row.origin).toBe('in-process')
    expect(row.lastConnectedAt).toBeGreaterThan(0)
    loop.stop()
  })
})

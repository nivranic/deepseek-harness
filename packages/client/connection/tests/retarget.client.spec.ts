/** §28 switch seam: selected-origin base resolution, validation, and handle surface. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebConnectionRpc, type RpcFetch } from '../src/client/rpc.ts'
import { apply, type ConnectionHandle } from '../src/client/index.ts'
import { switchToSavedHost } from '../src/client/saved-hosts.ts'
import type { SavedHost } from '../src/client/saved-hosts.ts'

type BrowserGlobal = { location?: { hostname: string; search: string; origin?: string } }

const contexts = new Set<Context>()

afterEach(async () => {
  vi.restoreAllMocks()
  delete (globalThis as BrowserGlobal).location
  await Promise.all([...contexts].map(async ctx => ctx.fiber.dispose()))
  contexts.clear()
})

/** Echo-envelope fetch spy recording every request URL. */
function recordingFetch(): { readonly urls: string[]; readonly fetch: RpcFetch } {
  const urls: string[] = []
  const fetch = vi.fn<RpcFetch>(async (input: URL, init: RequestInit) => {
    urls.push(String(input))
    const body = typeof init.body === 'string' ? init.body : '{}'
    const { rpcId } = JSON.parse(body) as { rpcId: string }
    return new Response(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true } }), { status: 200 })
  })
  return { urls, fetch }
}

describe('retargetable endpoint', () => {
  it('sends every call to the selected absolute origin', async () => {
    const { urls, fetch } = recordingFetch()
    const rpc = createWebConnectionRpc(fetch, undefined, undefined, () => 'https://desk.local:8787')
    await rpc.call('/api', 'host/describe', { args: {} })
    expect(urls).toEqual(['https://desk.local:8787/api/host/describe'])
  })

  it('falls back to the page origin while nothing is selected', async () => {
    ;(globalThis as BrowserGlobal).location = { hostname: 'page.local', search: '', origin: 'http://page.local' }
    const { urls, fetch } = recordingFetch()
    let selected: string | undefined = 'https://first.local'
    const rpc = createWebConnectionRpc(fetch, undefined, undefined, () => selected)
    await rpc.call('/api', 'host/describe', { args: {} })
    selected = undefined
    await rpc.call('/api', 'host/describe', { args: {} })
    expect(urls).toEqual(['https://first.local/api/host/describe', 'http://page.local/api/host/describe'])
  })

  it('keeps the page origin without a resolver', async () => {
    ;(globalThis as BrowserGlobal).location = { hostname: 'page.local', search: '', origin: 'http://page.local' }
    const { urls, fetch } = recordingFetch()
    const rpc = createWebConnectionRpc(fetch)
    await rpc.call('/api', 'host/describe', { args: {} })
    expect(urls).toEqual(['http://page.local/api/host/describe'])
  })

  it('validates, stores, and clears the selection on the handle', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    ;(globalThis as BrowserGlobal).location = { hostname: 'localhost', search: '?fixture', origin: 'http://localhost' }
    await ctx.plugin({ apply, inject: [] })
    const connection = ctx.get('connection') as ConnectionHandle
    expect(connection.targetOrigin()).toBeUndefined()
    connection.retarget('https://workstation.local:8787/path?query#hash')
    expect(connection.targetOrigin()).toBe('https://workstation.local:8787')
    connection.retarget(undefined)
    expect(connection.targetOrigin()).toBeUndefined()
    expect(() => { connection.retarget('workstation') }).toThrow(TypeError)
    expect(() => { connection.retarget('ftp://workstation.local') }).toThrow(TypeError)
    expect(connection.targetOrigin()).toBeUndefined()
  })
})

describe('switchToSavedHost', () => {
  const row = (hostId: string, origin: string): SavedHost => ({
    hostId, displayName: hostId, platform: 'win32', origin, lastConnectedAt: 1,
  })

  it('targets the saved row origin and returns the row', () => {
    const retarget = vi.fn<(origin: string | undefined) => void>()
    const target = {
      savedHosts: { list: () => [row('h1', 'https://one.local:8787'), row('h2', 'https://two.local')] },
      retarget,
    }
    expect(switchToSavedHost(target, 'h2')).toMatchObject({ hostId: 'h2', origin: 'https://two.local' })
    expect(retarget).toHaveBeenCalledExactlyOnceWith('https://two.local')
  })

  it('leaves the connection untouched for unknown hosts and in-process rows', () => {
    const retarget = vi.fn<(origin: string | undefined) => void>()
    const target = {
      savedHosts: { list: () => [row('local', 'in-process')] },
      retarget,
    }
    expect(switchToSavedHost(target, 'missing')).toBeUndefined()
    expect(switchToSavedHost(target, 'local')).toBeUndefined()
    expect(retarget).not.toHaveBeenCalled()
  })
})

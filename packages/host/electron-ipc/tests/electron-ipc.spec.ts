/**
 * Desktop carrier gateway: the /api shared-chain dispatch, the client-plugin
 * bundle route, and the boot-manifest-injected dist serving (traversal,
 * SPA fallback, method policy) over fake services.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { apply, inject, internals, name, type DesktopGateway } from '../src/index.ts'

let dist: string | undefined
const originalResolve = internals.resolveDistIndex

afterEach(() => {
  internals.resolveDistIndex = originalResolve
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

/** Stage a dist fixture (index + one asset) and point the resolver at it. */
function stageDist(): { index: string; asset: string } {
  dist = mkdtempSync(join(tmpdir(), 'dsh-electron-ipc-'))
  mkdirSync(join(dist, 'assets'))
  const index = join(dist, 'index.html')
  const asset = join(dist, 'assets', 'app.js')
  writeFileSync(index, '<head></head><body>shell</body>')
  writeFileSync(asset, 'export {}')
  // An unknown-extension asset exercises the octet-stream MIME fallback.
  writeFileSync(join(dist, 'assets', 'data.bin'), 'binary')
  internals.resolveDistIndex = () => index
  return { index, asset }
}

/** A client-module registry fake: fixed graph, caller-chosen bundle paths. */
function fakeModules(clientPaths: Record<string, string> = {}) {
  return {
    graph: () => ({ rev: 'graph-rev', entries: [] }),
    clientPath: (id: string) => clientPaths[id],
  }
}

/** An API Proxy fake answering only host.describe plus an empty mux stream. */
function fakeApiProxy(): ApiProxy {
  return {
    host: {
      describe: (request: { rpcId: string }) => Promise.resolve({
        rpcId: request.rpcId,
        result: { ok: true, value: { version: 'test', cwd: '/tmp' } },
      }),
    },
    events: {
      // An empty frame stream: the carrier shape (SSE headers + open line)
      // is what the gateway dispatch must preserve.
      mux: async function* () {},
      host: async function* () {},
    },
  } as unknown as ApiProxy
}

/** Connection fake: one claimed endpoint short-circuits; everything else falls through. */
function fakeConnection() {
  const claims = new Map<string, (payload: unknown) => unknown>()
  return {
    claims,
    service: {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch(request: Request): Promise<Response> }) => ({
        fetch: async (request: Request) => {
          const url = new URL(request.url)
          if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
            const endpoint = url.pathname.slice('/api/'.length)
            const claim = claims.get(endpoint)
            if (claim !== undefined) {
              const body = await request.json() as { rpcId: string; payload: unknown }
              return Response.json({
                type: 'server-response',
                rpcId: body.rpcId,
                result: { ok: true, value: claim(body.payload) },
              })
            }
          }
          return fallback.fetch(request)
        },
      }),
    },
  }
}

/** Mount the carrier plugin over the three fake services. */
async function mounted(clientPaths: Record<string, string> = {}): Promise<{
  gateway: DesktopGateway
  connection: ReturnType<typeof fakeConnection>
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  ctx.provide('clientModules', fakeModules(clientPaths) as never)
  const connection = fakeConnection()
  ctx.provide('connection', connection.service as never)
  ctx.provide('apiProxy', fakeApiProxy())
  const fiber = ctx.plugin({ name, inject: [...inject], apply })
  await fiber.await()
  const gateway = ctx.get('desktopGateway')
  if (gateway === undefined) throw new Error('desktopGateway was not provided')
  return { gateway, connection, dispose: () => fiber.dispose() }
}

const url = (path: string): string => `dsh://desktop${path}`

describe('electron-ipc desktop gateway', () => {
  it('serves the index with the injected boot manifest and assets from the dist', async () => {
    stageDist()
    const { gateway, dispose } = await mounted()
    const index = await gateway.handle(new Request(url('/')))
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    const html = await index.text()
    expect(html).toContain('window.__DSH_BOOT__')
    expect(html).toContain('graph-rev')

    const asset = await gateway.handle(new Request(url('/assets/app.js')))
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(await asset.text()).toBe('export {}')

    // Unknown extensions ship as octet-stream (the frontend-static parity).
    const binary = await gateway.handle(new Request(url('/assets/data.bin')))
    expect(binary.status).toBe(200)
    expect(binary.headers.get('content-type')).toBe('application/octet-stream')

    // SPA fallback: a miss answers the boot-injected index with 200.
    const fallback = await gateway.handle(new Request(url('/session/unknown')))
    expect(fallback.status).toBe(200)
    expect(await fallback.text()).toContain('window.__DSH_BOOT__')
    await dispose()
  })

  it('refuses traversal outside the dist root and non-read methods on static paths', async () => {
    stageDist()
    const { gateway, dispose } = await mounted()
    // The encoded slash survives URL normalization; the decoded dot segments
    // then climb out of the dist root (same probe shape as frontend-static).
    const traversal = await gateway.handle(new Request(url('/..%2f..%2fetc%2fpasswd')))
    expect(traversal.status).toBe(403)
    const post = await gateway.handle(new Request(url('/assets/app.js'), { method: 'POST' }))
    expect(post.status).toBe(405)
    await dispose()
  })

  it('serves registered client bundles and their source maps, 404ing every miss', async () => {
    const bundleRoot = mkdtempSync(join(tmpdir(), 'dsh-electron-ipc-bundle-'))
    const bundle = join(bundleRoot, 'client.js')
    writeFileSync(bundle, 'register()')
    writeFileSync(`${bundle}.map`, '{"version":3}')
    try {
      const { gateway, dispose } = await mounted({ '@scope/plugin': bundle, '@scope/unbuilt': join(bundleRoot, 'missing', 'client.js') })
      const script = await gateway.handle(new Request(url('/plugins/@scope/plugin/client.js')))
      expect(script.status).toBe(200)
      expect(script.headers.get('content-type')).toContain('text/javascript')
      expect(await script.text()).toBe('register()')
      const map = await gateway.handle(new Request(url('/plugins/@scope/plugin/client.js.map')))
      expect(map.status).toBe(200)
      expect(map.headers.get('content-type')).toContain('application/json')
      // Unknown id, foreign suffix, unwritten bundle, and wrong methods.
      expect((await gateway.handle(new Request(url('/plugins/@scope/other/client.js')))).status).toBe(404)
      expect((await gateway.handle(new Request(url('/plugins/foreign.js')))).status).toBe(404)
      expect((await gateway.handle(new Request(url('/plugins/@scope/unbuilt/client.js')))).status).toBe(404)
      expect((await gateway.handle(new Request(url('/plugins/@scope/plugin/client.js'), { method: 'POST' }))).status).toBe(405)
      await dispose()
    } finally {
      rmSync(bundleRoot, { recursive: true, force: true })
    }
  })

  it('dispatches /api through the shared chain: interceptor claims first, then the gateway', async () => {
    stageDist()
    const { gateway, connection, dispose } = await mounted()
    connection.claims.set('claimed/endpoint', () => ({ claimed: true }))

    const claimed = await gateway.handle(new Request(url('/api/claimed/endpoint'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-claimed', method: 'claimed/endpoint', payload: {} }),
    }))
    expect(claimed.status).toBe(200)
    expect(await claimed.json()).toMatchObject({
      rpcId: 'rpc-claimed',
      result: { ok: true, value: { claimed: true } },
    })

    const describe = await gateway.handle(new Request(url('/api/host.describe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: RpcId('rpc-describe'), method: 'host.describe', payload: {} }),
    }))
    expect(describe.status).toBe(200)
    expect(await describe.json()).toMatchObject({
      rpcId: 'rpc-describe',
      result: { ok: true, value: { version: 'test' } },
    })

    // The event streams ride the same chain as SSE GETs.
    const stream = await gateway.handle(new Request(url('/api/events.mux')))
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    await stream.body?.cancel()
    await dispose()
  })

  it('resolves the real built frontend dist through the package exports, failing loud unbuilt', () => {
    // The production resolver (not the test hook). A built checkout resolves
    // the frontend package's index.html; a dist-less one (the CI coverage
    // lane runs before any build) must fail with the build hint, never a
    // silent fallback.
    try {
      expect(originalResolve()).toMatch(/dist[/\\]index\.html$/)
    } catch (error) {
      expect((error as Error).message).toContain('frontend dist not built')
    }
  })
})

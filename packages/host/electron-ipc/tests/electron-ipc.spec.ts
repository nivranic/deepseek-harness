/**
 * Desktop carrier gateway: the /api shared-chain dispatch, the /dsh-stream
 * Remote-stream carrier, the client-plugin bundle dispatch, and the
 * transport-bootstrap plus boot-manifest-injected dist serving (traversal,
 * SPA fallback, method policy) over fake services.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpcId } from '@deepseek-ai/dsh-client-connection'
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

/** A client-module registry fake: fixed graph plus a URL-keyed bundle cache. */
function fakeModules(bundles: Record<string, string> = {}) {
  return {
    graph: () => ({ rev: 'graph-rev', entries: [], batches: [] }),
    bundleFetch: (request: Request): Response => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405 })
      }
      const url = new URL(request.url)
      const body = bundles[`${url.pathname}${url.search}`]
      return body === undefined
        ? new Response(null, { status: 404 })
        : new Response(request.method === 'HEAD' ? null : body, {
          status: 200,
          headers: {
            'content-type': url.pathname.endsWith('.map') ? 'application/json' : 'text/javascript',
            'cache-control': 'no-cache',
          },
        })
    },
  }
}

/** A Typert gateway fake: one wire stream answering scripted items or a failure. */
function fakeTypertGateway(items: unknown[] = [], failure?: { code: string; message: string; details: object }) {
  const opened: Array<{ endpoint: string; payload: unknown }> = []
  return {
    opened,
    service: {
      wireStream: {
        open: async (endpoint: string, payload: unknown) => {
          opened.push({ endpoint, payload })
          if (failure !== undefined) throw new Error(failure.message)
          return (async function* () {
            for (const item of items) yield item
          })()
        },
        failure: (error: unknown) => failure ?? {
          code: 'internal',
          message: (error as Error).message,
          details: {},
        },
      },
    },
  }
}

/** Connection fake: one claimed endpoint answers; everything else 404s. */
function fakeConnection() {
  const claims = new Map<string, (payload: unknown) => unknown>()
  return {
    claims,
    service: {
      createSharedFetchHandler: (_channel: '/api') => ({
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
          return new Response('not found', { status: 404 })
        },
      }),
    },
  }
}

/** Mount the carrier plugin over the three fake services. */
async function mounted(options: {
  bundles?: Record<string, string>
  streamItems?: unknown[]
  streamFailure?: { code: string; message: string; details: object }
} = {}): Promise<{
  gateway: DesktopGateway
  connection: ReturnType<typeof fakeConnection>
  typertGateway: ReturnType<typeof fakeTypertGateway>
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  ctx.provide('clientModules', fakeModules(options.bundles) as never)
  const connection = fakeConnection()
  ctx.provide('connection', connection.service as never)
  const typertGateway = fakeTypertGateway(options.streamItems, options.streamFailure)
  ctx.provide('typertGateway', typertGateway.service as never)
  const fiber = ctx.plugin({ name, inject: [...inject], apply })
  await fiber.await()
  const gateway = ctx.get('desktopGateway')
  if (gateway === undefined) throw new Error('desktopGateway was not provided')
  return { gateway, connection, typertGateway, dispose: () => fiber.dispose() }
}

const url = (path: string): string => `dsh://desktop${path}`

describe('electron-ipc desktop gateway', () => {
  it('serves the index with the transport bootstrap and injected boot manifest, plus dist assets', async () => {
    stageDist()
    const { gateway, dispose } = await mounted()
    const index = await gateway.handle(new Request(url('/')))
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    const html = await index.text()
    // The transport global installs ahead of every boot-manifest row.
    expect(html.indexOf('window.__DSH_TRANSPORT__')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('window.__DSH_TRANSPORT__')).toBeLessThan(html.indexOf('globalThis["__DSH_BOOT__"]'))
    expect(html).toContain('ownsHost')
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
    expect(await fallback.text()).toContain('globalThis["__DSH_BOOT__"]')
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

  it('serves plugin combo bundles through the registry cache and 404s every miss', async () => {
    const { gateway, dispose } = await mounted({
      bundles: {
        '/plugins/@scope/plugin/client.js': 'register()',
        '/plugins/@scope/plugin/client.js.map': '{"version":3}',
      },
    })
    const script = await gateway.handle(new Request(url('/plugins/@scope/plugin/client.js')))
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect(await script.text()).toBe('register()')
    const map = await gateway.handle(new Request(url('/plugins/@scope/plugin/client.js.map')))
    expect(map.status).toBe(200)
    expect(map.headers.get('content-type')).toContain('application/json')
    // Unknown resources and wrong methods mirror the registry's dispatch.
    expect((await gateway.handle(new Request(url('/plugins/@scope/other/client.js')))).status).toBe(404)
    expect((await gateway.handle(new Request(url('/plugins/@scope/plugin/client.js'), { method: 'POST' }))).status).toBe(405)
    await dispose()
  })

  it('dispatches /api through the connection shared fetch handler', async () => {
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

    // No interceptor claim and no fallback: the shared chain's own 404.
    const missed = await gateway.handle(new Request(url('/api/host.describe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: RpcId('rpc-describe'), method: 'host.describe', payload: {} }),
    }))
    expect(missed.status).toBe(404)
    await dispose()
  })

  it('carries Gateway Remote streams as NDJSON frames over the scheme fetch', async () => {
    stageDist()
    const { gateway, typertGateway, dispose } = await mounted({ streamItems: [{ first: true }, { second: 2 }] })
    const response = await gateway.handle(new Request(url('/dsh-stream/remote-event/stream'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'spec' }),
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(typertGateway.opened).toEqual([{ endpoint: 'remote-event/stream', payload: { client: 'spec' } }])
    const body = await response.text()
    expect(body).toBe('{"k":"v","v":{"first":true}}\n{"k":"v","v":{"second":2}}\n')
    await dispose()
  })

  it('terminates a failing stream with the gateway failure frame', async () => {
    stageDist()
    const { gateway, dispose } = await mounted({
      streamFailure: { code: 'stream-refused', message: 'no source registered', details: { hint: 1 } },
    })
    const response = await gateway.handle(new Request(url('/dsh-stream/remote-event/stream'), {
      method: 'POST',
      body: 'null',
    }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"k":"e","c":"stream-refused","m":"no source registered","d":{"hint":1}}\n')
    await dispose()
  })

  it('rejects malformed stream routes without reaching the gateway', async () => {
    stageDist()
    const { gateway, typertGateway, dispose } = await mounted()
    expect((await gateway.handle(new Request(url('/dsh-stream/'), { method: 'POST', body: 'null' }))).status).toBe(404)
    expect((await gateway.handle(new Request(url('/dsh-stream/$events'), { method: 'GET' }))).status).toBe(405)
    expect(typertGateway.opened).toEqual([])
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

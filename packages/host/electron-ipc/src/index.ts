/**
 * @deepseek-ai/dsh-host-electron-ipc — the desktop carrier for the browser
 * surface: it provides {@link DesktopGateway}, the in-process fetch target the
 * desktop app wires to Electron's privileged-scheme bridge (this package never
 * binds a socket). Requests dispatch in four branches: `/api` rides the
 * Connection shared-channel chain (the Typert gateway's interceptor claims,
 * without the HTTP trust fence — every request arrives from this process's own
 * renderer, never the network), `/dsh-stream/<endpoint>` carries one Gateway
 * Remote stream as newline-delimited JSON over the same scheme fetch,
 * `/plugins` serves the client-module combo bundles from the registry caches,
 * and every other path serves the built frontend dist with the boot manifest
 * and a transport bootstrap injected into index.html.
 * @module @deepseek-ai/dsh-host-electron-ipc
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Activates the typertGateway, clientModules, and connection Context merges.
import type {} from '@deepseek-ai/dsh-api-gateway'
import { bootInjections } from '@deepseek-ai/dsh-client-modules'
import { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Stable Cordis plugin name. */
export const name = 'electron-ipc'

/** Services required before the gateway can dispatch. */
export const inject = ['clientModules', 'connection', 'typertGateway']

/**
 * The desktop request target: the app shell hands every renderer fetch of its
 * privileged scheme to {@link DesktopGateway.handle} and returns the answer
 * unchanged.
 */
export interface DesktopGateway {
  /**
   * Answer one renderer request carried by the desktop bridge.
   * @param request - the renderer's fetch request, unmodified.
   * @returns the complete or streaming response.
   */
  handle(request: Request): Promise<Response>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The desktop carrier gateway (provided by the electron-ipc plugin). */
    desktopGateway: DesktopGateway
  }
}

/** Extension-keyed MIME table for the shipped Vite asset set plus KaTeX faces. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

/** The index content type, shared by every index response. */
const HTML_MIME = 'text/html; charset=utf-8'

const API_PATH = '/api'
const STREAM_PREFIX = '/dsh-stream/'
const PLUGINS_PREFIX = '/plugins/'

/**
 * The transport bootstrap installed ahead of every boot-manifest row: it owns
 * the page-global carrier hooks (the same seam a worker shell installs), so
 * the browser half reaches Gateway streams over the scheme bridge's streaming
 * fetch and reports the privileged surface reachable. Self-contained plain
 * script on purpose — the carrier class problem is why the host, not a
 * client bundle, owns this global on the desktop surface.
 */
const TRANSPORT_BOOTSTRAP = `(function () {
  'use strict'
  window.__DSH_TRANSPORT__ = {
    ownsHost: true,
    openStream: function (endpoint, payload, signal) {
      return (async function* () {
        var response = await fetch('/dsh-stream/' + encodeURIComponent(endpoint), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: signal
        })
        if (!response.ok || response.body === null) {
          throw new Error('desktop stream transport failed: HTTP ' + String(response.status))
        }
        var reader = response.body.getReader()
        var decoder = new TextDecoder()
        var buffer = ''
        for (;;) {
          var chunk = await reader.read()
          if (chunk.done) return
          buffer += decoder.decode(chunk.value, { stream: true })
          var newline = buffer.indexOf('\\n')
          while (newline >= 0) {
            var line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            newline = buffer.indexOf('\\n')
            if (line === '') continue
            var frame = JSON.parse(line)
            if (frame.k === 'v') {
              yield frame.v
            } else if (frame.k === 'e') {
              var failure = new Error(frame.m)
              failure.dshRemoteStreamFailure = frame.c === undefined
                ? { kind: 'carrier' }
                : { kind: 'remote', code: frame.c, details: frame.d }
              throw failure
            }
          }
        }
      })()
    }
  }
})()
`

/** Dist location is assembly knowledge of the desktop composition: resolved through the frontend package exports, never configured. */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree substitutes the resolver */
    throw new Error('electron-ipc: frontend dist not built; run pnpm run build from the repository root first')
  }
}

/** Test hook: hosts with no built frontend dist substitute the resolver; production never touches this. */
export const internals: { resolveDistIndex: () => string } = { resolveDistIndex }

/** The 405 every non-read method receives outside the /api chain (the chain answers its own methods). */
function methodNotAllowed(): Response {
  return new Response('method not allowed', { status: 405 })
}

/**
 * Carry one Gateway Remote stream as newline-delimited JSON frames: a
 * `{"k":"v","v":…}` frame per stream item, a terminal `{"k":"e",…}` frame
 * carrying the gateway's own failure projection. The renderer's abort drops
 * the fetch, whose cancellation aborts the logical stream at the gateway.
 * @param request - the renderer's POST whose path names the stream endpoint.
 * @param gateway - the Typert gateway owning the wire stream adapter.
 * @returns the streaming NDJSON response.
 */
async function serveStream(request: Request, gateway: Context['typertGateway']): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  // The endpoint is a Gateway Remote stream name (`$events`) or a
  // `namespace/method` endpoint; slashes are ordinary endpoint bytes, so only
  // the empty path is unknown.
  const endpoint = decodeURIComponent(new URL(request.url).pathname.slice(STREAM_PREFIX.length))
  if (endpoint === '') return new Response('not found', { status: 404 })
  // Wire boundary: the renderer posts its decoded stream payload as one JSON
  // body; anything the JSON grammar rejects is the caller's malformed frame.
  const payload: unknown = JSON.parse(await request.text())
  const lifetime = new AbortController()
  request.signal.addEventListener('abort', () => { lifetime.abort() })
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (frame: unknown): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
      }
      try {
        const source = await gateway.wireStream.open(endpoint, payload, lifetime.signal)
        for await (const item of source) {
          send({ k: 'v', v: item })
          if (lifetime.signal.aborted) return
        }
      } catch (error) {
        // The renderer dropped the fetch: its abort already cancelled the
        // logical stream, so this is the gateway's own cancellation race,
        // not a failure to report.
        if (!lifetime.signal.aborted) {
          const failure = gateway.wireStream.failure(error)
          send({ k: 'e', c: failure.code, m: failure.message, d: failure.details })
        }
      } finally {
        controller.close()
      }
    },
    cancel() {
      lifetime.abort()
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Serve the built frontend: traversal outside the dist root is 403, any miss
 * falls back to index.html with 200 (SPA routing), and every index response
 * carries the transport bootstrap plus the freshly injected boot manifest.
 * @param pathname - decoded request pathname.
 * @param method - request method; only reads are served.
 * @param distRoot - absolute dist root directory.
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param renderIndex - produces the index body with the current boot graph.
 * @returns the static response.
 */
async function serveStatic(
  pathname: string, method: string, distRoot: string, distIndex: string, renderIndex: () => Promise<string>,
): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed()
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay
  // under it. `sep`, not '/': resolve() emits backslash paths on Windows.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    return new Response('forbidden', { status: 403 })
  }
  const serveIndex = async (): Promise<Response> =>
    new Response(await renderIndex(), { headers: { 'content-type': HTML_MIME } })
  if (target === distRoot || target === distIndex) return serveIndex()
  try {
    const body = await readFile(target)
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    // Miss (ENOENT/EISDIR) falls back to index.html with 200 (SPA routing).
    return serveIndex()
  }
}

/**
 * Provide the desktop gateway: the shared `/api` chain, the `/dsh-stream`
 * Remote-stream carrier, the client-plugin combo bundles, and the
 * boot-manifest-injected dist.
 * @param ctx - plugin context carrying clientModules, connection, and typertGateway.
 */
export function apply(ctx: Context): void {
  const distIndex = internals.resolveDistIndex()
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    renderIndexInjections(
      await readFile(distIndex, 'utf8'),
      [
        { kind: 'script', placement: 'head', text: TRANSPORT_BOOTSTRAP },
        ...bootInjections(ctx.clientModules.graph()),
      ],
    )
  // The Typert gateway registers its interceptor claims on the connection
  // service itself, so the shared handler dispatches them exactly as the web
  // HTTP route does. The HTTP trust fence does not apply: every request
  // arrives from this process's own renderer through the app's privileged
  // scheme, never from the network.
  const apiFetch = ctx.connection.createSharedFetchHandler(API_PATH)
  const gateway: DesktopGateway = {
    async handle(request) {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      if (pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)) {
        return apiFetch.fetch(request)
      }
      if (pathname.startsWith(STREAM_PREFIX)) {
        return await serveStream(request, ctx.typertGateway)
      }
      if (pathname.startsWith(PLUGINS_PREFIX)) {
        return ctx.clientModules.bundleFetch(request)
      }
      return serveStatic(pathname, request.method, distRoot, distIndex, renderIndex)
    },
  }
  ctx.provide('desktopGateway', gateway)
}

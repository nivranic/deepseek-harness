/**
 * @deepseek-ai/dsh-host-electron-ipc — the desktop carrier for the browser
 * surface: it provides {@link DesktopGateway}, the in-process fetch target the
 * desktop app wires to Electron's privileged-scheme bridge (the IPC route the
 * webserver documentation reserves for the desktop shape — this package never
 * binds a socket). Requests dispatch in three branches: `/api` rides the
 * Connection shared-channel chain (interceptor claims plus the API Proxy
 * fallback, without the HTTP trust fence — every request arrives from this
 * process's own renderer, never the network), `/plugins/<id>/client.js` serves
 * the client-module bundles, and every other path serves the built frontend
 * dist with the boot manifest injected into index.html.
 * @module @deepseek-ai/dsh-host-electron-ipc
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Activates the apiProxy, clientModules, and connection Context merges.
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { injectBootManifest } from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Stable Cordis plugin name. */
export const name = 'electron-ipc'

/** Services required before the gateway can dispatch. */
export const inject = ['clientModules', 'connection', 'apiProxy']

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
const PLUGINS_PREFIX = '/plugins/'
const BUNDLE_SUFFIX = '/client.js'
const SOURCE_MAP_SUFFIX = '/client.js.map'

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
 * Serve one client-plugin bundle or its source map from the module registry.
 * @param pathname - decoded request pathname under `/plugins/`.
 * @param modules - the client-module registry resolving entry ids to bundle paths.
 * @returns the bundle response, or the matching 404/405.
 */
async function serveBundle(pathname: string, method: string, modules: Context['clientModules']): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed()
  const isSourceMap = pathname.endsWith(SOURCE_MAP_SUFFIX)
  const suffix = isSourceMap ? SOURCE_MAP_SUFFIX : BUNDLE_SUFFIX
  if (!pathname.endsWith(suffix)) return new Response('not found', { status: 404 })
  // The id may contain a scope slash; anything else under /plugins is unknown.
  const clientPath = modules.clientPath(pathname.slice(PLUGINS_PREFIX.length, -suffix.length))
  const path = clientPath === undefined ? undefined : `${clientPath}${isSourceMap ? '.map' : ''}`
  if (path === undefined) return new Response('not found', { status: 404 })
  try {
    const body = await readFile(path)
    return new Response(body, {
      headers: {
        'content-type': isSourceMap ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      },
    })
  } catch {
    // Registered but unreadable (bundle not built yet): a loud 404 beats a
    // silent SPA-fallback HTML page.
    return new Response('not found', { status: 404 })
  }
}

/**
 * Serve the built frontend: traversal outside the dist root is 403, any miss
 * falls back to index.html with 200 (SPA routing), and every index response
 * carries the freshly injected boot manifest.
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
 * Provide the desktop gateway: the shared `/api` chain over the API Proxy,
 * the client-plugin bundle route, and the boot-manifest-injected dist.
 * @param ctx - plugin context carrying clientModules, connection, and apiProxy.
 */
export function apply(ctx: Context): void {
  const distIndex = internals.resolveDistIndex()
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    injectBootManifest(await readFile(distIndex, 'utf8'), ctx.clientModules.graph())
  // Interceptor claims (the Typert gateway) must apply on the desktop exactly
  // as on the web HTTP route; the fallback is the bare gateway. The HTTP trust
  // fence does not apply: every request arrives from this process's own
  // renderer through the app's privileged scheme, never from the network, so
  // the loopback-pinned privileged methods stay reachable for the GUI.
  const apiFetch = ctx.connection.createSharedFetchHandler(API_PATH, {
    fetch: request => toFetchHandler(ctx.apiProxy).fetch(request),
  })
  const gateway: DesktopGateway = {
    async handle(request) {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      if (pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)) {
        return apiFetch.fetch(request)
      }
      if (pathname.startsWith(PLUGINS_PREFIX)) {
        return serveBundle(pathname, request.method, ctx.clientModules)
      }
      return serveStatic(pathname, request.method, distRoot, distIndex, renderIndex)
    },
  }
  ctx.provide('desktopGateway', gateway)
}

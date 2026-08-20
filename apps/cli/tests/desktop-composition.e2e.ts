/**
 * The shipped desktop composition, booted headlessly over the real bundle
 * patches: every row activates, the electron-ipc carrier provides
 * desktopGateway, and the gateway answers the renderer's in-process fetches —
 * the boot-manifest-injected index, the shared /api chain (unary plus the
 * typert-gateway interceptor plane), and the client-plugin bundle route.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { DesktopGateway } from '@deepseek-ai/dsh-host-electron-ipc'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** The shipped desktop surface: the dsh-base and dsh-desktop-app bundle patches over an empty preset root. */
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const DESKTOP_PATCH = join(REPO_ROOT, 'packages/bundle/desktop-app/cordis.patch.yml')
/** The installation anchor whose dependency surface the preset module fallback mirrors. */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

/**
 * Boot the shipped desktop composition, minus the rows that would touch the
 * network or write outside the test. The carrier row and both transport
 * halves stay ENABLED — they are exactly what this file asserts.
 */
async function bootDesktop(settingsFile: string): Promise<Context> {
  const storageRoot = join(dirname(settingsFile), 'storages')
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', DESKTOP_PATCH),
    // Pin the settings document and storage root away from the developer's
    // own $DSH_HOME (same rationale as the Web composition e2e).
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'storage-json', config: { root: storageRoot } },
    // The telemetry exporter reaches the network.
    { id: 'session-telemetry-otel', disabled: true },
    // The adaptive chooser would mount the native dialog backend; the browse
    // pair supplies the same seam without an OS dialog (the Web composition
    // e2e's exact shape).
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    // Only the shipped preset root, so a developer's own presets cannot
    // change this test's outcome.
    {
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: join(CONFIG_DIR, 'agent-presets'), trust: 'system' }],
        includeUserRoot: false,
      },
    },
  ]
  // Bare plugin names resolve through the profile module fallback, the same
  // mechanism the real desktop boot uses.
  const home = dirname(settingsFile)
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, patches, (bootCtx) => {
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

let ctx: Context
beforeAll(async () => {
  const settingsFile = join(await mkdtemp(join(tmpdir(), 'dsh-desktop-composition-')), 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  ctx = await bootDesktop(settingsFile)
}, 120_000)

afterAll(async () => {
  if (ctx !== undefined) await ctx.fiber.dispose()
})

describe('the shipped desktop composition', () => {
  it('activates every composed row without a webserver', async () => {
    // The desktop surface binds no port: the audit is that nothing stayed
    // pending on a carrier that does not exist.
    await ctx.get('loader')?.await()
    const unloaded = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(ctx.get('webServer')).toBeUndefined()
  })

  it('provides the desktop gateway and serves the boot-manifest-injected index', async () => {
    const gateway = ctx.get('desktopGateway')
    expect(gateway).toBeDefined()
    const index = await gateway!.handle(new Request('dsh://desktop/'))
    expect(index.status).toBe(200)
    const html = await index.text()
    expect(html).toContain('window.__DSH_BOOT__')
    // The boot graph carries the browser roster the modules half composed.
    expect(html).toContain('@deepseek-ai/dsh-client-connection')
    // The renderer row is the mount contract: without it no plugin provides
    // uiRenderer and the browser shell waits on "Loading plugins…" forever.
    expect(html).toContain('@deepseek-ai/dsh-client-ui-renderer')
    // The official brand row fills the sidebar and conversation hero slots;
    // without it the shell falls back to the "DSH Local Build" wordmark.
    expect(html).toContain('@deepseek-ai/dsh-client-ui-brand-official')
    // The desktop preference row (what the close button does) is desktop-only:
    // the web roster never composes it, so the web surface sees no row and no
    // `desktop` settings namespace.
    expect(html).toContain('@deepseek-ai/dsh-client-ui-desktop')
    // The graph also stamps the host runtime facts; this gateway runs in plain
    // Node, so the wire block carries node/os and JSON-drops the Electron-only
    // chrome/electron fields.
    expect(html).toContain(`"runtime":{"node":"${process.versions.node}"`)
  })

  it('registers the desktop close-button preference with the tray default', async () => {
    // The namespace is the composition contract the Electron close handler
    // reads through the settings service; the round trip proves the section
    // resolves (and re-resolves on every commit) with the schema default.
    const settings = ctx.get('settings')!
    const ns = settingsNamespace('desktop')
    expect(settings.get(ns)).toEqual({ closeAction: 'tray' })
    await settings.update(ns, { closeAction: 'quit' })
    expect(settings.get(ns)).toEqual({ closeAction: 'quit' })
    await settings.update(ns, { closeAction: 'tray' })
    expect(settings.get(ns)).toEqual({ closeAction: 'tray' })
  })

  it('serves client plugin bundles through the gateway', async () => {
    const gateway = ctx.get('desktopGateway') as DesktopGateway
    const script = await gateway.handle(new Request('dsh://desktop/plugins/@deepseek-ai/dsh-client-connection/client.js'))
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect((await gateway.handle(new Request('dsh://desktop/plugins/@deepseek-ai/dsh-no-such/client.js'))).status).toBe(404)
  })

  it('dispatches /api unary calls and the interceptor plane over the same bridge', async () => {
    const gateway = ctx.get('desktopGateway') as DesktopGateway
    const post = (endpoint: string, method: string, payload: unknown, rpcId: string): Promise<Response> =>
      gateway.handle(new Request(`dsh://desktop/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: RpcId(rpcId), method, payload }),
      }))

    // The gateway plane: a loopback-pinned privileged method stays reachable
    // on the desktop, because the bridge never crosses the network.
    const describeHost = await post('host.describe', 'host.describe', {}, 'desktop-describe')
    expect(describeHost.status).toBe(200)
    const described = await describeHost.json() as { result: { ok: boolean } }
    expect(described.result.ok).toBe(true)

    // The interceptor plane: the typert gateway claims its endpoints ahead
    // of the gateway fallback. `commands/list` is gateway-dispatched; a
    // business error (unknown session) proves the dispatch reached the
    // commands remote, where the fallback would have answered 404.
    const listed = await post('commands/list', 'commands/list', { args: { agentId: 'desktop-none' } }, 'desktop-commands')
    expect(listed.status).toBe(200)
    const commands = await listed.json() as { result: { ok: boolean; error?: { code: string } } }
    expect(commands.result.ok).toBe(false)
    expect(commands.result.error?.code).toBe('session-not-found')

    const sessions = await post('session.list', 'session.list', {}, 'desktop-sessions')
    expect(sessions.status).toBe(200)
    const sessionList = await sessions.json() as { result: { ok: boolean } }
    expect(sessionList.result.ok).toBe(true)
  })

  it('streams session events over the bridge as SSE', async () => {
    const gateway = ctx.get('desktopGateway') as DesktopGateway
    const stream = await gateway.handle(new Request('dsh://desktop/api/events.mux'))
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    await stream.body?.cancel()
  })
})

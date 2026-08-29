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
import { RpcId } from '@deepseek-ai/dsh-client-connection'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
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
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, home })
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
    expect(html).toContain('globalThis["__DSH_BOOT__"]')
    // The boot graph carries the browser roster the modules half composed.
    expect(html).toContain('@deepseek-ai/dsh-client-connection')
    // The renderer row is the mount contract: without it no plugin provides
    // uiRenderer and the browser shell waits on "Loading plugins…" forever.
    expect(html).toContain('@deepseek-ai/dsh-client-ui-renderer')
    // The controller rows are the browser tree's service roots: their client
    // halves provide `sessions` and `workspaces`, and every chat-roster row
    // waits on those two (directly or transitively) — without the rows the
    // loader is satisfied yet 17 entries stay pending forever. The settings
    // controller is host-plane only (no client half), so it stays out of the
    // graph while remaining a composed row.
    expect(html).toContain('@deepseek-ai/dsh-api-session-controller')
    expect(html).toContain('@deepseek-ai/dsh-api-workspace-controller')
    // ui-session provides `uiSession`, the session-scoped source registry the
    // conversation and trajectory rows wait on.
    expect(html).toContain('@deepseek-ai/dsh-client-ui-session')
    // ui-chat is the chat view contract the composer and message rows fill.
    expect(html).toContain('@deepseek-ai/dsh-client-ui-chat')
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

  it('registers the desktop preferences with the tray and autostart-off defaults', async () => {
    // The namespace is the composition contract the Electron shell reads
    // through the settings service (the close handler at close time, the
    // login-entry sync on every commit); the round trip proves the section
    // resolves (and re-resolves on every commit) with the schema defaults —
    // autostart stays OFF until the user opts in.
    const settings = ctx.get('settings')!
    const ns = settingsNamespace('desktop')
    expect(settings.get(ns)).toEqual({ closeAction: 'tray', launchAtLogin: false })
    await settings.update(ns, { closeAction: 'quit' })
    expect(settings.get(ns)).toEqual({ closeAction: 'quit', launchAtLogin: false })
    await settings.update(ns, { closeAction: 'tray', launchAtLogin: true })
    expect(settings.get(ns)).toEqual({ closeAction: 'tray', launchAtLogin: true })
    await settings.update(ns, { launchAtLogin: false })
    expect(settings.get(ns)).toEqual({ closeAction: 'tray', launchAtLogin: false })
  })

  it('serves the initial combo bundles the boot manifest advertises', async () => {
    const gateway = ctx.get('desktopGateway') as DesktopGateway
    const modules = ctx.get('clientModules')!
    const batch = modules.graph().batches[0]
    expect(batch).toBeDefined()
    const script = await gateway.handle(new Request(`dsh://desktop${batch!.url}`))
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect((await gateway.handle(new Request('dsh://desktop/plugins/@deepseek-ai/dsh-no-such/client.js'))).status).toBe(404)
  })

  it('dispatches /api through the gateway interceptor plane over the bridge', async () => {
    const gateway = ctx.get('desktopGateway') as DesktopGateway
    const post = (endpoint: string, method: string, args: Record<string, unknown>, rpcId: string): Promise<Response> =>
      gateway.handle(new Request(`dsh://desktop/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The gateway Remote wire form: exactly one plain-object `args` field.
        body: JSON.stringify({ type: 'client-request', rpcId: RpcId(rpcId), method, payload: { args } }),
      }))

    // The Typert gateway claims its Remote endpoints on the connection
    // service; the desktop bridge dispatches into the same shared chain the
    // web HTTP route uses. `session/list` takes one all-optional request
    // object, so the wire args carry `_request: {}` to mark the parameter
    // present (JSON has no undefined; the descriptor rejects the absent key).
    const sessions = await post('session/list', 'session/list', { _request: {} }, 'desktop-sessions')
    expect(sessions.status).toBe(200)
    const sessionList = await sessions.json() as { result: { ok: boolean } }
    expect(sessionList.result.ok).toBe(true)

    // An endpoint no interceptor claims answers the shared chain's own 404.
    const missed = await post('no/such/endpoint', 'no/such/endpoint', {}, 'desktop-miss')
    expect(missed.status).toBe(404)
  })

  it('carries Gateway Remote streams over the bridge as NDJSON', async () => {
    const gateway = ctx.get('desktopGateway') as DesktopGateway
    const stream = await gateway.handle(new Request('dsh://desktop/dsh-stream/$events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    }))
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('application/x-ndjson')
    await stream.body?.cancel()
  })
})

/**
 * Registration: the General rows come from one apply, defer until the slot they
 * fill has been declared, bind the `desktop` settings namespace through the
 * shared scope service, and route their selects through the wire mutate path.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { CloseActionRowInjected, LaunchAtLoginRowInjected } from '../src/client/index.ts'
import { DesktopSettingsSchema, DESKTOP_SETTINGS_NAMESPACE } from '../src/desktop-settings.ts'

let rpc = 0

function ok<T>(value: T): { rpcId: string; result: { ok: true; value: T } } {
  return { rpcId: `desktop-${rpc++}`, result: { ok: true, value } }
}

function view(closeAction: 'tray' | 'quit', revision: number, launchAtLogin = false) {
  return {
    ns: DESKTOP_SETTINGS_NAMESPACE,
    schema: DesktopSettingsSchema.toJSON(),
    value: { closeAction, launchAtLogin },
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

async function bench() {
  const ctx = new Context()
  const mutate = vi.fn()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  new TestRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [view('tray', 1)] })),
        mutate: (payload: unknown) => {
          mutate(payload)
          return Promise.resolve(ok(view('quit', 2)))
        },
      },
    },
  } as never)
  ctx.get('slots')!.register({
    name: 'root',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, locale, mutate }
}

/** Both rows' inject faces, as the renderer would materialize them. */
async function rowFaces() {
  const { ctx, locale, mutate } = await bench()
  const entries = (ctx.get('slots')!).entries('settings.general.item')
  expect(entries).toHaveLength(2)
  const close = entries.find(row => row.options.id === 'desktop-close')!
  expect(close.options.order).toBe(10)
  const launch = entries.find(row => row.options.id === 'desktop-launch-at-login')!
  expect(launch.options.order).toBe(11)
  const closeFace = (close.inject as unknown as () => CloseActionRowInjected)()
  const launchFace = (launch.inject as unknown as () => LaunchAtLoginRowInjected)()
  return { ctx, locale, mutate, closeFace, launchFace }
}

describe('ui-desktop apply', () => {
  it('registers the zh dictionaries under its own namespace', async () => {
    const { locale } = await rowFaces()
    expect(locale.bind('settings.desktop')('title')).toBe('关闭窗口时')
    expect(locale.bind('settings.desktop')('launchTitle')).toBe('开机自启')
  })

  it('derives the bound scope from the shared describe mirror and writes through mutate', async () => {
    const { closeFace, mutate } = await rowFaces()
    await vi.waitFor(() => { expect(closeFace.hooks.desktopClose.getSnapshot().status).toBe('ready') })
    const snapshot = closeFace.hooks.desktopClose.getSnapshot()
    expect(snapshot.value).toEqual({ closeAction: 'tray', launchAtLogin: false })
    expect(snapshot.writable).toBe(true)
    closeFace.select('quit')
    await vi.waitFor(() => {
      expect(closeFace.hooks.desktopClose.getSnapshot().value).toEqual({ closeAction: 'quit', launchAtLogin: false })
    })
    expect(mutate).toHaveBeenCalledWith({
      ns: DESKTOP_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: ['closeAction'], value: 'quit' }],
      expectedRevision: 1,
    })
  })

  it('binds the launch row to the same namespace and writes the boolean through mutate', async () => {
    const { launchFace, mutate } = await rowFaces()
    await vi.waitFor(() => { expect(launchFace.hooks.desktopLaunch.getSnapshot().status).toBe('ready') })
    expect(launchFace.hooks.desktopLaunch.getSnapshot().value).toEqual({ closeAction: 'tray', launchAtLogin: false })
    launchFace.select(true)
    await vi.waitFor(() => {
      expect(launchFace.hooks.desktopLaunch.getSnapshot().value).toEqual({ closeAction: 'quit', launchAtLogin: false })
    })
    expect(mutate).toHaveBeenCalledWith({
      ns: DESKTOP_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: ['launchAtLogin'], value: true }],
      expectedRevision: 1,
    })
  })
})

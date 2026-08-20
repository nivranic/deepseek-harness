/**
 * Registration: the General row comes from one apply, defers until the slot it
 * fills has been declared, binds the `desktop` settings namespace through the
 * shared scope service, and routes its select through the wire mutate path.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { CloseActionRowInjected } from '../src/client/index.ts'
import { DesktopSettingsSchema, DESKTOP_SETTINGS_NAMESPACE } from '../src/desktop-settings.ts'

let rpc = 0

function ok<T>(value: T): { rpcId: string; result: { ok: true; value: T } } {
  return { rpcId: `desktop-${rpc++}`, result: { ok: true, value } }
}

function view(closeAction: 'tray' | 'quit', revision: number) {
  return {
    ns: DESKTOP_SETTINGS_NAMESPACE,
    schema: DesktopSettingsSchema.toJSON(),
    value: { closeAction },
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

/** The row's inject face, as the renderer would materialize it. */
async function rowFace() {
  const { ctx, locale, mutate } = await bench()
  const entries = (ctx.get('slots')!).entries('settings.general.item')
  expect(entries).toHaveLength(1)
  const row = entries[0]!
  expect(row.options.id).toBe('desktop-close')
  expect(row.options.order).toBe(10)
  const face = (row.inject as unknown as () => CloseActionRowInjected)()
  return { ctx, locale, mutate, face }
}

describe('ui-desktop apply', () => {
  it('registers the zh dictionaries under its own namespace', async () => {
    const { locale } = await rowFace()
    expect(locale.bind('settings.desktop')('title')).toBe('关闭窗口时')
  })

  it('derives the bound scope from the shared describe mirror and writes through mutate', async () => {
    const { face, mutate } = await rowFace()
    await vi.waitFor(() => { expect(face.hooks.desktopClose.getSnapshot().status).toBe('ready') })
    const snapshot = face.hooks.desktopClose.getSnapshot()
    expect(snapshot.value).toEqual({ closeAction: 'tray' })
    expect(snapshot.writable).toBe(true)
    face.select('quit')
    await vi.waitFor(() => { expect(face.hooks.desktopClose.getSnapshot().value).toEqual({ closeAction: 'quit' }) })
    expect(mutate).toHaveBeenCalledWith({
      ns: DESKTOP_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: ['closeAction'], value: 'quit' }],
      expectedRevision: 1,
    })
  })
})

/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, and Remote faces are recorders, because what matters here is
 * what was handed to them — one body seat under the type's id with its store
 * and face — and that every registration is gone after dispose, which is what
 * makes a reload safe.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { FILES_ID, FILES_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { FilesBody } from '../src/client/FilesBody.tsx'
import { FilesTitle } from '../src/client/FilesTitle.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { FilesRegistrationInjected } from '../src/client/index.ts'
import type { createFilesStore } from '../src/client/store.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

interface Recorded {
  name: string
  key: string
  locale: string
  store: unknown
  inject: unknown
  component: unknown
}

async function boot(capabilities = ['workspace-files.list.v1']) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const workspaceFiles = { list: vi.fn() }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  const remote = { workspaceFiles, $host: { capabilities, home: undefined, platform: undefined, isLoopback: false } }
  ctx.provide('remote', remote as never)
  ctx.provide('remote.workspaceFiles', workspaceFiles as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  onTestFinished(async () => { await fiber.dispose() })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, ctx, remote }
}

describe('ui-sidebar-files apply', () => {
  it('withdraws the type and retires pending listings and retained callbacks on replacement', async () => {
    const h = await boot([])
    expect(h.tabs.get(FILES_KIND)).toBeUndefined()
    expect(h.registered).toEqual([])
    h.remote.$host = { ...h.remote.$host, capabilities: ['workspace-files.list.v1'] }
    h.ctx.emit('connection/reset')
    const registration = h.registered.find(entry => entry.component === FilesBody)!
    const store = (registration.store as ReturnType<typeof createFilesStore>).create()
    const injectFace = registration.inject as (id: SessionId, actions: typeof store.actions) => FilesRegistrationInjected
    const face = injectFace('file-list-session' as SessionId, store.actions)
    const tab = 'file-list-tab' as TabId
    const pending = Promise.withResolvers<unknown>()
    h.remote.workspaceFiles.list.mockReturnValueOnce(pending.promise)
    face.start(tab, '/root', new AbortController().signal)
    const signal = h.remote.workspaceFiles.list.mock.calls[0]![2] as AbortSignal
    expect(signal.aborted).toBe(false)
    h.remote.$host = { ...h.remote.$host, capabilities: [] }
    h.ctx.emit('connection/reset')
    expect(h.tabs.get(FILES_KIND)).toBeUndefined()
    expect(h.registered).toEqual([])
    expect(signal.aborted).toBe(true)
    pending.resolve({ ok: true, value: { entries: [], truncated: false } })
    await pending.promise
    expect(store.getSnapshot().byTab[tab]).toBeUndefined()
    face.start(tab, '/retained', new AbortController().signal)
    face.load(tab, '/retained', new AbortController().signal)
    face.toggle(tab, '/retained', false, new AbortController().signal)
    expect(h.remote.workspaceFiles.list).toHaveBeenCalledOnce()
    expect(store.getSnapshot().byTab[tab]).toBeUndefined()
    h.remote.$host = { ...h.remote.$host, capabilities: ['workspace-files.list.v1'] }
    h.ctx.emit('connection/reset')
    expect(h.tabs.get(FILES_KIND)).toBeDefined()
    expect(h.registered.find(entry => entry.component === FilesBody)?.store).not.toBe(registration.store)
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body and title seats under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(FILES_KIND)
    expect(definition?.id).toBe(FILES_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('sidebar://files')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[10, 'guide.title', 'guide.description']])
    expect(dictionaries.get('sidebarFiles')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', FILES_ID, 'sidebarFiles', FilesBody],
      ['sidebar.right.pane.tab.title', FILES_ID, undefined, FilesTitle],
    ])
    expect(registered[0]?.store).toBeDefined()
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(FILES_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})

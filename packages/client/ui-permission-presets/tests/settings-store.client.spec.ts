import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import {
  PermissionPresetSettingsController, permissionDefaultOf,
} from '../src/client/settings-store.ts'

const SCHEMA = {
  uid: 6,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', meta: { description: 'Workspace' }, value: 'workspace-write' },
    3: { type: 'union', list: [1, 2] },
    6: { type: 'object', dict: { defaultPreset: 3 } },
  },
}

const schema = new SettingsSchemaService(new Context())

function resolveDefault(view: SettingsNamespaceView) {
  return permissionDefaultOf(view, schema)
}

function view(defaultPreset: string, revision = 0, schema: SettingsNamespaceView['schema'] = SCHEMA): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema,
    value: { defaultPreset },
    base: { defaultPreset: 'read-only' },
    applies: 'live',
    secrets: [],
    revision,
  }
}

/** The settings namespace answers over the Remote carrier, which has no envelope. */
function ok<T>(value: T) {
  return { ok: true as const, value }
}

/** The permission controller over a real mirror and one scripted context. */
function permissionController(api: object) {
  const remote = { $host: { home: undefined, platform: undefined, isLoopback: true, capabilities: ['settings.read.v1', 'settings.write.v1'] }, settings: api }
  const ctx = { remote } as never
  const mirror = new SettingsDescribeMirror(ctx)
  return { remote, mirror, controller: new PermissionPresetSettingsController(mirror, ctx, schema) }
}

describe('permission settings store', () => {
  it.each([[], ['settings.write.v1'], ['settings.read.v1']].map(capabilities => ({ capabilities })))('admits only the declared Settings operations: $capabilities', async ({ capabilities }) => {
    const describe = vi.fn(async () => ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    const mutate = vi.fn(async () => ok(view('workspace-write', 1)))
    const { controller, remote } = permissionController({ describe, mutate })
    remote.$host = { ...remote.$host, capabilities }
    await controller.load()
    await controller.select('workspace-write')
    expect(describe).toHaveBeenCalledTimes(capabilities.includes('settings.read.v1') ? 1 : 0)
    expect(controller.store.getSnapshot().writable).toBe(false)
    expect(mutate).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('refuses a retained permission gesture before the replacement Host descriptor arrives', async () => {
    const mutate = vi.fn(async () => ok(view('workspace-write', 1)))
    const { controller, remote } = permissionController({
      describe: async () => ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }), mutate,
    })
    await controller.load()
    remote.$host = { ...remote.$host }
    await controller.select('workspace-write')
    expect(mutate).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it.each(['success', 'failure', 'throw'] as const)('discards an old Host write %s while a replacement accepts its own selection', async (outcome) => {
    const old = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>> | { ok: false; error: RemoteError }>()
    const mutate = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok(view('workspace-write', 8)))
    const describe = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [view('read-only', 1)] }))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [view('read-only', 7)] }))
    const { controller, mirror, remote } = permissionController({ describe, mutate })
    await controller.load()
    const saving = controller.select('workspace-write')
    remote.$host = { ...remote.$host, capabilities: [] }
    await mirror.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'unavailable', writable: false, currentValue: '', options: [] })
    remote.$host = { ...remote.$host, capabilities: ['settings.read.v1', 'settings.write.v1'] }
    await mirror.load()
    await controller.select('workspace-write')
    expect(mutate).toHaveBeenLastCalledWith('permission', [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }], 7)
    if (outcome === 'success') old.resolve(ok(view('read-only', 99)))
    else if (outcome === 'failure') old.resolve({ ok: false, error: new RemoteError('gateway/internal', 'old Host failure', {}) })
    else old.reject(new Error('old transport failure'))
    await saving
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', currentValue: 'workspace-write', revision: 8, error: null })
    expect(mirror.getSnapshot().view?.namespaces[0]?.revision).toBe(8)
    expect(mutate).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('contains a current transport rejection and permits an explicit retry', async () => {
    const mutate = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(ok(view('workspace-write', 1)))
    const { controller } = permissionController({
      describe: async () => ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }), mutate,
    })
    await controller.load()
    await controller.select('workspace-write')
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'connection lost' })
    await controller.select('workspace-write')
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', currentValue: 'workspace-write', error: null })
    await controller.dispose()
  })

  it('waits for dispatched writes at disposal without accepting more gestures or publishing their result', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    const mutate = vi.fn(() => pending.promise)
    const { controller, mirror, remote } = permissionController({
      describe: async () => ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }), mutate,
    })
    await controller.load()
    const saving = controller.select('workspace-write')
    let disposed = false
    const disposal = controller.dispose().then(() => { disposed = true })
    await controller.select('workspace-write')
    expect(disposed).toBe(false)
    expect(mutate).toHaveBeenCalledOnce()
    pending.resolve(ok(view('workspace-write', 1)))
    await Promise.all([saving, disposal])
    expect(disposed).toBe(true)
    expect(mirror.getSnapshot().view?.namespaces[0]?.revision).toBe(0)
    Object.defineProperty(remote, '$host', { get: () => { throw new Error('disposed context') } })
    await expect(controller.select('workspace-write')).resolves.toBeUndefined()
  })

  it('derives dynamic options and host labels from the descriptor schema', () => {
    expect(resolveDefault(view('read-only'))).toEqual({
      currentValue: 'read-only',
      options: [
        { id: 'read-only', label: 'Read Only' },
        { id: 'workspace-write', label: 'Workspace' },
      ],
    })
    const single = {
      uid: 2,
      refs: {
        1: { type: 'const', meta: { description: '' }, value: 'read-only' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }
    expect(resolveDefault(view('read-only', 0, single))).toEqual({
      currentValue: 'read-only',
      options: [{ id: 'read-only', label: 'Read Only' }],
    })
    const undescribed = {
      uid: 2,
      refs: {
        1: { type: 'const', meta: { description: 7 }, value: 'read-only' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }
    expect(resolveDefault(view('read-only', 0, undescribed)).options)
      .toEqual([{ id: 'read-only', label: 'Read Only' }])
  })

  it('rejects malformed values and dynamic enums at the wire boundary', () => {
    expect(() => resolveDefault({ ...view('read-only'), value: {} })).toThrow(/no defaultPreset value/)
    expect(() => resolveDefault(view('read-only', 0, {
      uid: 1, refs: { 1: { type: 'object', dict: {} } },
    }))).toThrow(/no defaultPreset field/)
    expect(() => resolveDefault(view('read-only', 0, {
      uid: 2,
      refs: {
        1: { type: 'union' },
        2: { type: 'object', dict: { defaultPreset: 1 } },
      },
    }))).toThrow(/does not advertise/)
    expect(() => resolveDefault(view('read-only', 0, {
      uid: 4,
      refs: {
        1: { type: 'string' },
        2: { type: 'const', value: 1 },
        3: { type: 'union', list: [1, 2] },
        4: { type: 'object', dict: { defaultPreset: 3 } },
      },
    }))).toThrow(/does not advertise/)
    expect(() => resolveDefault(view('missing'))).toThrow(/does not advertise/)
  })

  it('loads and writes defaultPreset with optimistic concurrency', async () => {
    const describe = vi.fn(() => Promise.resolve(ok({
      writable: true,
      hasDocument: false,
      namespaces: [view('read-only', 4)],
    })))
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 5))))
    const { controller } = permissionController({ describe, mutate })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writable: true,
      currentValue: 'read-only',
      revision: 4,
    })
    await controller.select('workspace-write')
    expect(mutate).toHaveBeenCalledWith(
      'permission',
      [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }],
      4,
    )
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready',
      currentValue: 'workspace-write',
      revision: 5,
    })
    // The write answer folded into the mirror; no re-read followed.
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('hides the row when the namespace is absent and contains write failures', async () => {
    const describe = vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })))
    const { controller } = permissionController({ describe, mutate: vi.fn() })
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')

    const failing = permissionController({
      describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
      mutate: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('settings/conflict', 'stale', { ns: 'permission', expected: 1, actual: 2 }),
      }),
    }).controller
    await failing.load()
    await failing.select('workspace-write')
    expect(failing.store.getSnapshot()).toMatchObject({ status: 'error', error: 'stale' })
  })

  it('contains read failures and no-ops without a writable view', async () => {
    const mutate = vi.fn()
    const readOnly = permissionController({
      describe: () => Promise.resolve(ok({
        writable: false, hasDocument: false, namespaces: [view('read-only', 2)],
      })),
      mutate,
    }).controller
    await readOnly.load()
    expect(readOnly.store.getSnapshot()).toMatchObject({
      currentValue: 'read-only',
      writable: false,
      revision: 2,
    })
    await readOnly.select('workspace-write')
    expect(mutate).not.toHaveBeenCalled()

    const rejected = permissionController({
      describe: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'offline', {}),
      }),
      mutate,
    }).controller
    await rejected.select('workspace-write')
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({ status: 'error', error: 'offline' })
    expect(mutate).not.toHaveBeenCalled()

    const thrown = permissionController({
      describe: async () => { throw 'disconnected' },
      mutate,
    }).controller
    await thrown.load()
    expect(thrown.store.getSnapshot()).toMatchObject({ status: 'error', error: 'disconnected' })

    const ctx = {
      remote: {
        $host: { home: undefined, platform: undefined, isLoopback: true, capabilities: ['settings.read.v1', 'settings.write.v1'] },
        settings: {
          describe: () => Promise.resolve(ok({
            writable: true, hasDocument: false, namespaces: [view('read-only')],
          })),
          mutate,
        },
      },
    } as never
    const mirror = new SettingsDescribeMirror(ctx)
    const malformed = new PermissionPresetSettingsController(mirror, ctx, {
      rehydrate: () => { throw 'schema disconnected' },
    } as never)
    await malformed.load()
    expect(malformed.store.getSnapshot()).toMatchObject({
      status: 'error', error: 'schema disconnected',
    })
  })

  it('hides the row in a remote browser instead of loading forever', async () => {
    const describeCall = vi.fn()
    const mutate = vi.fn()
    const ctx = { remote: { $host: { home: undefined, platform: undefined, isLoopback: false, capabilities: ['settings.read.v1', 'settings.write.v1'] }, settings: { describe: describeCall, mutate } } } as never
    const mirror = new SettingsDescribeMirror(ctx, 'memory')
    const controller = new PermissionPresetSettingsController(mirror, ctx, schema)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')
    await controller.select('workspace-write')
    expect(describeCall).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('follows a mirror refresh without an own read once loaded', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [view('read-only', 1)] }))
      .mockResolvedValueOnce(ok({ writable: true, hasDocument: false, namespaces: [view('workspace-write', 2)] }))
    const { mirror, controller } = permissionController({ describe, mutate: vi.fn() })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ currentValue: 'read-only' })

    await mirror.load()

    expect(controller.store.getSnapshot()).toMatchObject({ currentValue: 'workspace-write', revision: 2 })
  })

  it('disposal stops deriving and suppresses in-flight writes', async () => {
    const neverRead = vi.fn()
    const { controller: neverLoaded } = permissionController({ describe: neverRead, mutate: vi.fn() })
    await neverLoaded.dispose()
    await neverLoaded.load()
    expect(neverLoaded.store.getSnapshot().status).toBe('idle')
    expect(neverRead).not.toHaveBeenCalled()

    const read = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const { mirror, controller: idle } = permissionController({ describe: () => read.promise, mutate: vi.fn() })
    const loading = idle.load()
    await idle.dispose()
    read.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    await Promise.all([loading, mirror.load()])
    expect(idle.store.getSnapshot().status).toBe('loading')

    const mutation = Promise.withResolvers<ReturnType<typeof ok<SettingsNamespaceView>>>()
    const { controller: active } = permissionController({
      describe: () => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: [view('read-only')],
      })),
      mutate: () => mutation.promise,
    })
    await active.load()
    const saving = active.select('workspace-write')
    const activeDisposal = active.dispose()
    mutation.resolve(ok(view('workspace-write', 1)))
    await Promise.all([saving, activeDisposal])
    expect(active.store.getSnapshot().status).toBe('saving')

    const refusedMutation = Promise.withResolvers<
      ReturnType<typeof ok<SettingsNamespaceView>> | { ok: false; error: RemoteError }
    >()
    const { controller: disposedWrite } = permissionController({
      describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
      mutate: () => refusedMutation.promise,
    })
    await disposedWrite.load()
    const writing = disposedWrite.select('workspace-write')
    const writeDisposal = disposedWrite.dispose()
    refusedMutation.resolve({
      ok: false,
      error: new RemoteError('settings/conflict', 'late write', { ns: 'permission', expected: 1, actual: 2 }),
    })
    await Promise.all([writing, writeDisposal])
    expect(disposedWrite.store.getSnapshot().status).toBe('saving')
  })
})

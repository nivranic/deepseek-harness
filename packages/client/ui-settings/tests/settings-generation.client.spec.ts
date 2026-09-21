/** Settings generations own reads, write queues, and revision fences. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDescribeMirror } from '../src/client/settings-mirror.ts'
import { SettingsScopeController } from '../src/client/settings-scope.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'

const capabilities = ['settings.read.v1', 'settings.write.v1']
function row(revision: number): SettingsNamespaceView {
  return { ns: 'fixture', schema: {}, value: { revision }, applies: 'live', secrets: [], revision }
}
const answer = (revision: number) => ({ ok: true as const, value: {
  namespaces: [row(revision)], writable: true, hasDocument: true,
} })
function bench() {
  const remote = {
    $host: { home: undefined, platform: undefined, isLoopback: true, capabilities } as Context['remote']['$host'],
    settings: {
      describe: vi.fn(async () => answer(1)),
      mutate: vi.fn(async () => ({ ok: true as const, value: row(2) })),
    },
  }
  const ctx = { remote } as unknown as Context
  const mirror = new SettingsDescribeMirror(ctx)
  const scope = new SettingsScopeController(ctx, { namespace: 'fixture', decode: value => value }, mirror, 'host', new SettingsSchemaService(new Context()))
  const replace = (ids: string[] = capabilities) => {
    remote.$host = { home: undefined, platform: undefined, isLoopback: true, capabilities: ids }
  }
  return { remote, mirror, scope, replace }
}

it('does not probe absent Settings support and derives write availability independently', async () => {
  const { remote, mirror, scope, replace } = bench()
  replace([])
  await mirror.ensure()
  await mirror.load()
  await scope.set('revision', 99)
  expect(remote.settings.describe).not.toHaveBeenCalled()
  expect(remote.settings.mutate).not.toHaveBeenCalled()
  expect(scope.getSnapshot()).toMatchObject({ status: 'unavailable', writable: false })
  replace(['settings.read.v1'])
  await mirror.load()
  expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', view: { writable: false } })
  expect(scope.getSnapshot()).toMatchObject({ status: 'ready', writable: false, revision: 1 })
  await scope.set('revision', 99)
  expect(remote.settings.mutate).not.toHaveBeenCalled()
})

it('cannot publish an old read after Settings support is withdrawn', async () => {
  const { remote, mirror, replace } = bench()
  const pending = Promise.withResolvers<ReturnType<typeof answer>>()
  remote.settings.describe.mockReturnValueOnce(pending.promise)
  const read = mirror.load()
  await Promise.resolve()
  expect(remote.settings.describe).toHaveBeenCalledOnce()
  replace([])
  await mirror.load()
  pending.resolve(answer(99))
  await read
  expect(mirror.getSnapshot()).toEqual({ status: 'unavailable', view: undefined, error: null })
  replace()
  await mirror.load()
  expect(mirror.namespace('fixture')?.revision).toBe(1)
})

it('drops old queued writes and never carries their late revision into a new generation', async () => {
  const { remote, mirror, scope, replace } = bench()
  const first = Promise.withResolvers<{ ok: true; value: SettingsNamespaceView }>()
  remote.settings.mutate.mockReturnValueOnce(first.promise)
  await mirror.load()
  const active = scope.set('revision', 90)
  await Promise.resolve()
  expect(remote.settings.mutate).toHaveBeenCalledOnce()
  const queued = scope.set('revision', 91)
  replace()
  await mirror.load()
  const fresh = scope.set('revision', 2)
  first.resolve({ ok: true, value: row(90) })
  await Promise.all([active, queued, fresh])
  expect(remote.settings.mutate).toHaveBeenCalledTimes(2)
  expect(remote.settings.mutate).toHaveBeenLastCalledWith('fixture', [{ op: 'set', path: ['revision'], value: 2 }], 1)
  expect(scope.getSnapshot()).toMatchObject({ revision: 2, value: { revision: 2 } })
})

it('drops a queued write before dispatch if its generation is already replaced', async () => {
  const { remote, mirror, scope, replace } = bench()
  await mirror.load()
  const queued = scope.set('revision', 4)
  replace()
  await queued
  expect(remote.settings.mutate).not.toHaveBeenCalled()
})

it('does not apply a retained settings gesture to a replacement Host before its describe arrives', async () => {
  const { remote, mirror, scope, replace } = bench()
  await mirror.load()
  replace()
  await scope.set('revision', 9)
  expect(remote.settings.mutate).not.toHaveBeenCalled()
  await mirror.load()
  await scope.set('revision', 2)
  expect(remote.settings.mutate).toHaveBeenCalledOnce()
})

it('distinguishes pending discovery from an admitted Host that lacks Settings support', async () => {
  const { remote, mirror, scope, replace } = bench()
  remote.$host = { home: undefined, platform: undefined, isLoopback: true }
  await mirror.ensure()
  expect(mirror.getSnapshot()).toMatchObject({ status: 'loading', view: undefined })
  expect(scope.getSnapshot().status).toBe('loading')
  expect(remote.settings.describe).not.toHaveBeenCalled()
  replace([])
  await mirror.load()
  expect(mirror.getSnapshot().status).toBe('unavailable')
  expect(scope.getSnapshot().status).toBe('unavailable')
})

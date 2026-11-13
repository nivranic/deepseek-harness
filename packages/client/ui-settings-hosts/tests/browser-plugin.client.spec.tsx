// @vitest-environment jsdom
/** Bookmark ownership and discovery lifecycle at the real registration. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { HostDescriptor, HostId, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import type { HostsSettingsSectionInjected } from '../src/client/HostsSettingsSection.tsx'
import { setup } from './fixture.client.ts'

usePinnedBrowserLanguages('en-US')

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const fixture = setup(ctx)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, slots, ...fixture }
}

function faceOf(slots: SlotRegistry): HostsSettingsSectionInjected {
  return slots.entries('settings.section')[0]!.inject!() as HostsSettingsSectionInjected & Record<string, unknown>
}

it('owns local bookmarks and identifies the current Host without transport selection', async () => {
  const b = await bench()
  b.storage.set('dsh-saved-hosts.v1', JSON.stringify([{
    hostId: b.descriptor.hostId, displayName: 'Old name', customName: 'My desk',
    platform: 'linux', origin: location.origin, lastConnectedAt: 1,
  }]))
  b.storage.set('dsh-selected-host.v1', 'obsolete-selection')
  const fiber = b.ctx.plugin({ inject, apply })
  await fiber.await()
  const face = faceOf(b.slots)
  await vi.waitFor(() => { expect(face.hooks.currentHostId.getSnapshot()).toBe(b.descriptor.hostId) })
  expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.host'])
  const entry = b.slots.entries('settings.section')[0]!
  expect(entry.options).toMatchObject({ id: 'hosts', order: 16 })
  expect(resolveSlotLabel(entry.options.label)).toBe('Hosts')
  expect(face.hooks.savedHosts.getSnapshot()).toMatchObject([{ displayName: 'Fixture Host', customName: 'My desk' }])
  face.rename(b.descriptor.hostId, 'Desk')
  expect(b.storage.get('dsh-saved-hosts.v1')).toContain('"customName":"Desk"')
  face.forget(b.descriptor.hostId)
  expect(face.hooks.savedHosts.getSnapshot()).toEqual([])
  expect(face.hooks.currentHostId.getSnapshot()).toBe(b.descriptor.hostId)
  expect(b.storage.get('dsh-selected-host.v1')).toBe('obsolete-selection')
  await fiber.dispose()
  expect(b.listeners.size).toBe(0)
  expect(b.slots.entries('settings.section')).toHaveLength(0)
})

it('keeps bookmarks after discovery failure and ignores a superseded description', async () => {
  const b = await bench()
  const old = Promise.withResolvers<RemoteResult<HostDescriptor>>()
  b.describe.mockReturnValueOnce(old.promise)
  const fiber = b.ctx.plugin({ inject, apply })
  await fiber.await()
  const face = faceOf(b.slots)
  b.refresh()
  await vi.waitFor(() => { expect(face.hooks.currentHostId.getSnapshot()).toBe(b.descriptor.hostId) })
  old.resolve({ ok: true, value: { ...b.descriptor, hostId: 'old-host' as HostId } })
  await old.promise
  expect(face.hooks.savedHosts.getSnapshot().map(row => row.hostId)).toEqual([b.descriptor.hostId])
  b.describe.mockResolvedValueOnce({
    ok: false, error: new RemoteError('gateway/connection-unavailable', 'offline', { endpoint: 'host/describe' }),
  })
  b.refresh()
  expect(face.hooks.currentHostId.getSnapshot()).toBeUndefined()
  await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(3) })
  expect(face.hooks.savedHosts.getSnapshot()).toHaveLength(1)
  b.describe.mockRejectedValueOnce(new Error('offline'))
  b.refresh()
  await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(4) })
  expect(face.hooks.savedHosts.getSnapshot()).toHaveLength(1)
})

it('does not persist a discovery response arriving after unload', async () => {
  const b = await bench()
  const late = Promise.withResolvers<RemoteResult<HostDescriptor>>()
  b.describe.mockReturnValue(late.promise)
  const fiber = b.ctx.plugin({ inject, apply })
  await fiber.await()
  await fiber.dispose()
  late.resolve({ ok: true, value: b.descriptor })
  await late.promise
  expect(b.storage.has('dsh-saved-hosts.v1')).toBe(false)
})

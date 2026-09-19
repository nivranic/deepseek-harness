/** Preset capability withdrawal invalidates entry state and retained operations. */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AgentPresetSettingsController, readRoster } from '../src/client/settings-store.ts'
import { AgentPresetSeatController } from '../src/client/seat-store.ts'
import { AgentPresetSectionController } from '../src/client/section-store.ts'

const CAPABILITIES = ['agent-preset.catalog.v1', 'agent-preset.select.v1', 'agent-preset.manage.v1', 'settings.write.v1', 'settings.agent-preset-directory.v1']
const ROSTER = { ok: true as const, value: {
  presets: [{ id: 'standard', trust: 'system' as const, isDefault: true }],
  authorable: true, modeSelectionEnabled: true,
} }

function bench() {
  const remote = {
    $host: { capabilities: CAPABILITIES },
    agentPresets: {
      list: vi.fn(async () => ROSTER),
      read: vi.fn(async () => ({ ok: true as const, value: { content: 'preset' } })),
      select: vi.fn(async () => ({ ok: true as const, value: 'custom' })),
      copy: vi.fn(async () => ({ ok: true as const, value: undefined })),
      deletePreset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
    settings: {
      canOpenAgentPresetDirectory: vi.fn(async () => ({ ok: true as const, value: true })),
      openAgentPresetDirectory: vi.fn(async () => ({ ok: true as const, value: { opened: true } })),
      update: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
  }
  const ctx = { remote } as unknown as Context
  const withdraw = (...ids: string[]) => { remote.$host = { capabilities: CAPABILITIES.filter(id => !ids.includes(id)) } }
  return { ctx, remote, withdraw }
}

describe('Preset capability admission', () => {
  it('does not probe an absent catalog or its directory settings', async () => {
    const { ctx, remote, withdraw } = bench()
    withdraw('agent-preset.catalog.v1')
    const display = new AgentPresetSettingsController(ctx)
    const section = new AgentPresetSectionController(ctx)
    await display.load()
    await section.load()
    await section.view('standard')
    await section.openLocation('standard')
    await section.makeDefault('standard')
    await section.setPickerVisible(true)
    expect(display.store.getSnapshot().status).toBe('unavailable')
    expect(section.store.getSnapshot().status).toBe('unavailable')
    for (const call of [...Object.values(remote.agentPresets), ...Object.values(remote.settings)]) expect(call).not.toHaveBeenCalled()
  })

  it('discards a catalog response from a replaced Host generation', async () => {
    const { ctx, remote, withdraw } = bench()
    const pending = Promise.withResolvers<typeof ROSTER>()
    remote.agentPresets.list.mockReturnValueOnce(pending.promise)
    const read = readRoster(ctx)
    withdraw('agent-preset.catalog.v1')
    pending.resolve(ROSTER)
    expect(await read).toMatchObject({ ok: true, value: { presets: [] } })
  })

  it('drops a staged selection before a blank Session arrives and does not revive it', async () => {
    const { ctx, remote, withdraw } = bench()
    const state: { session?: { id: SessionId; blank: boolean } } = {}
    const seat = new AgentPresetSeatController(ctx, () => state.session)
    await seat.load()
    seat.stage('custom')
    withdraw('agent-preset.select.v1')
    state.session = { id: SessionId('blank'), blank: true }
    await seat.apply()
    await seat.select('custom')
    remote.$host = { capabilities: CAPABILITIES }
    await seat.load()
    await seat.apply()
    expect(remote.agentPresets.select).not.toHaveBeenCalled()
  })

  it('keeps catalog reads while refusing retained management actions', async () => {
    const { ctx, remote, withdraw } = bench()
    const section = new AgentPresetSectionController(ctx)
    await section.load()
    section.beginCopy('standard')
    section.setCopyId('custom')
    section.confirmDelete('custom')
    withdraw('agent-preset.manage.v1')
    await section.confirmCopy()
    await section.remove()
    expect(remote.agentPresets.copy).not.toHaveBeenCalled()
    expect(remote.agentPresets.deletePreset).not.toHaveBeenCalled()
    await section.load()
    expect(section.store.getSnapshot()).toMatchObject({ status: 'ready', copy: null, pendingDelete: null })
    await section.view('standard')
    expect(remote.agentPresets.read).toHaveBeenCalledOnce()
  })

  it('does not reopen a viewer whose response arrives after capability loss', async () => {
    const { ctx, remote, withdraw } = bench()
    const pending = Promise.withResolvers<{ ok: true; value: { content: string } }>()
    remote.agentPresets.read.mockReturnValueOnce(pending.promise)
    const section = new AgentPresetSectionController(ctx)
    const view = section.view('standard')
    withdraw('agent-preset.catalog.v1')
    await section.load()
    pending.resolve({ ok: true, value: { content: 'old composition' } })
    await view
    expect(section.store.getSnapshot()).toMatchObject({ status: 'unavailable', view: null })
  })
})

it.each(['default', 'picker'] as const)('does not carry a late %s Settings write into another Host generation', async (kind) => {
  const { ctx, remote, withdraw } = bench()
  const pending = Promise.withResolvers<{ ok: true; value: undefined }>()
  remote.settings.update.mockReturnValueOnce(pending.promise)
  const section = new AgentPresetSectionController(ctx)
  await section.load()
  const sync = vi.fn(async () => undefined)
  const write = kind === 'default' ? section.makeDefault('standard', sync) : section.setPickerVisible(false, sync)
  expect(remote.settings.update).toHaveBeenCalledOnce()
  withdraw('agent-preset.catalog.v1')
  await section.load()
  remote.$host = { capabilities: CAPABILITIES }
  await section.load()
  const reads = remote.agentPresets.list.mock.calls.length
  pending.resolve({ ok: true, value: undefined })
  await write
  expect(sync).not.toHaveBeenCalled()
  expect(remote.agentPresets.list).toHaveBeenCalledTimes(reads)
  expect(section.store.getSnapshot()).toMatchObject({ status: 'ready', policySaving: false })
})

it('does not publish a late selection into a replacement generation', async () => {
  const { ctx, remote, withdraw } = bench()
  const pending = Promise.withResolvers<{ ok: true; value: string }>()
  remote.agentPresets.select.mockReturnValueOnce(pending.promise)
  const seat = new AgentPresetSeatController(ctx, () => ({ id: SessionId('blank'), blank: true }))
  const selection = seat.select('custom')
  expect(remote.agentPresets.select).toHaveBeenCalledOnce()
  withdraw('agent-preset.select.v1')
  await seat.load()
  pending.resolve({ ok: true, value: 'custom' })
  await selection
  expect(seat.store.getSnapshot()).toMatchObject({ current: '', showPicker: false, busy: false })
})

it('closes a displayed viewer and management draft when a capable Host generation replaces another', async () => {
  const { ctx, remote } = bench()
  const section = new AgentPresetSectionController(ctx)
  await section.load()
  await section.view('standard')
  section.beginCopy('standard')
  section.confirmDelete('custom')
  expect(section.store.getSnapshot().view).not.toBeNull()
  remote.$host = { capabilities: CAPABILITIES }
  await section.load()
  expect(section.store.getSnapshot()).toMatchObject({ status: 'ready', view: null, copy: null, pendingDelete: null })
})

it('does not send Settings operations or synchronize a blank Session without Settings support', async () => {
  const { ctx, remote, withdraw } = bench()
  const section = new AgentPresetSectionController(ctx)
  await section.load()
  withdraw('settings.write.v1', 'settings.agent-preset-directory.v1')
  remote.settings.canOpenAgentPresetDirectory.mockClear()
  await section.load()
  const reads = remote.agentPresets.list.mock.calls.length
  const sync = vi.fn(async () => undefined)
  await section.makeDefault('standard', sync)
  await section.setPickerVisible(false, sync)
  await section.openLocation('standard')
  expect(remote.settings.update).not.toHaveBeenCalled()
  expect(remote.settings.canOpenAgentPresetDirectory).not.toHaveBeenCalled()
  expect(remote.settings.openAgentPresetDirectory).not.toHaveBeenCalled()
  expect(sync).not.toHaveBeenCalled()
  expect(remote.agentPresets.list).toHaveBeenCalledTimes(reads)
  expect(section.store.getSnapshot()).toMatchObject({ status: 'ready', hasDocument: false, showPicker: true })
})

it('copies a preset without opening or probing an unsupported Settings directory operation', async () => {
  const { ctx, remote, withdraw } = bench()
  withdraw('settings.agent-preset-directory.v1')
  const section = new AgentPresetSectionController(ctx)
  await section.load()
  section.beginCopy('standard')
  section.setCopyId('custom')
  await section.confirmCopy()
  expect(remote.agentPresets.copy).toHaveBeenCalledOnce()
  expect(remote.settings.canOpenAgentPresetDirectory).not.toHaveBeenCalled()
  expect(remote.settings.openAgentPresetDirectory).not.toHaveBeenCalled()
  expect(section.store.getSnapshot()).toMatchObject({ status: 'ready', copy: null })
})

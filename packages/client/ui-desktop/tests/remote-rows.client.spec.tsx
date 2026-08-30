// @vitest-environment jsdom
/**
 * The cross-device rows: the on/off toggles over the `remote` namespace, the
 * device-name editor, and the devices block — LAN status, the pairing QR
 * dialog, and revocation — against stubbed link Remote APIs.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { LinkPairingValue } from '@deepseek-ai/dsh-api-link-controller/types'
import { DeviceNameRow } from '../src/client/DeviceNameRow.tsx'
import type { DeviceNameRowComponentProps } from '../src/client/DeviceNameRow.tsx'
import { RemoteDevicesRow } from '../src/client/RemoteDevicesRow.tsx'
import type { RemoteDevicesRowComponentProps } from '../src/client/RemoteDevicesRow.tsx'
import { RemoteToggleRow } from '../src/client/RemoteToggleRow.tsx'
import type { RemoteToggleRowComponentProps } from '../src/client/RemoteToggleRow.tsx'
import type { RemoteSettings } from '../src/remote-settings.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = SettingsScopeSnapshot<RemoteSettings>

const BASE: Snapshot = {
  status: 'ready',
  value: { enabled: true, allowRemoteApproval: false, deviceName: 'Studio Desk' },
  base: undefined,
  user: undefined,
  revision: 1,
  writable: true,
  mode: 'host',
}

const t = (key: keyof typeof zh): string => zh[key]

describe('RemoteToggleRow', () => {
  function renderToggle(state: Partial<Snapshot> = {}, field: 'enabled' | 'allowRemoteApproval' = 'enabled') {
    const store = createSnapshotStore<Snapshot>({ ...BASE, ...state })
    const select = vi.fn()
    render(<RemoteToggleRow {...({
      select,
      field,
      titleKey: 'accessTitle',
      descriptionKey: 'accessDescription',
      useRemote: bindSnapshotSelector(store),
      t,
    } as unknown as RemoteToggleRowComponentProps)} />)
    return select
  }

  it('renders the on/off group with the current state checked', () => {
    renderToggle()
    expect(screen.getByRole('radio', { name: zh.on }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: zh.off }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(zh.accessDescription)).not.toBeNull()
  })

  it('selects only the other state, per field', () => {
    const select = renderToggle()
    fireEvent.click(screen.getByRole('radio', { name: zh.on }))
    fireEvent.click(screen.getByRole('radio', { name: zh.off }))
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith(false)

    cleanup()
    const approval = renderToggle({ value: { enabled: true, allowRemoteApproval: true, deviceName: 'x' } }, 'allowRemoteApproval')
    fireEvent.click(screen.getByRole('radio', { name: zh.off }))
    expect(approval).toHaveBeenCalledWith(false)
  })

  it('renders nothing while the value is not ready', () => {
    renderToggle({ status: 'loading', value: undefined })
    expect(screen.queryByText(zh.accessTitle)).toBeNull()
  })
})

describe('DeviceNameRow', () => {
  function renderName(state: Partial<Snapshot> = {}) {
    const store = createSnapshotStore<Snapshot>({ ...BASE, ...state })
    const commit = vi.fn()
    render(<DeviceNameRow {...({
      commit,
      titleKey: 'deviceNameTitle',
      descriptionKey: 'deviceNameDescription',
      placeholderKey: 'deviceNamePlaceholder',
      useRemote: bindSnapshotSelector(store),
      t,
    } as unknown as DeviceNameRowComponentProps)} />)
    return commit
  }

  it('shows the committed name and commits an edit on blur', () => {
    const commit = renderName()
    const field = screen.getByLabelText(zh.deviceNameTitle) as HTMLInputElement
    expect(field.value).toBe('Studio Desk')
    fireEvent.change(field, { target: { value: 'Desk Pro' } })
    fireEvent.blur(field)
    expect(commit).toHaveBeenCalledWith('Desk Pro')
  })

  it('commits an emptied field so the host resets to the computer name', () => {
    const commit = renderName()
    const field = screen.getByLabelText(zh.deviceNameTitle) as HTMLInputElement
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(commit).toHaveBeenCalledWith('')
  })

  it('keeps a local edit across an external re-render and commits on Enter', async () => {
    const store = createSnapshotStore<Snapshot>({ ...BASE })
    const commit = vi.fn()
    render(<DeviceNameRow {...({
      commit,
      titleKey: 'deviceNameTitle',
      descriptionKey: 'deviceNameDescription',
      placeholderKey: 'deviceNamePlaceholder',
      useRemote: bindSnapshotSelector(store),
      t,
    } as unknown as DeviceNameRowComponentProps)} />)
    const field = screen.getByLabelText(zh.deviceNameTitle) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Desk Pro' } })
    store.set({ ...BASE, value: { enabled: true, allowRemoteApproval: false, deviceName: 'External Edit' } })
    await waitFor(() => { expect(field.value).toBe('Desk Pro') })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)
    await waitFor(() => { expect(commit).toHaveBeenCalledWith('Desk Pro') })
  })

  it('renders nothing while the value is not ready', () => {
    const store = createSnapshotStore<Snapshot>({ ...BASE, status: 'loading', value: undefined })
    render(<DeviceNameRow {...({
      commit: vi.fn(),
      titleKey: 'deviceNameTitle',
      descriptionKey: 'deviceNameDescription',
      placeholderKey: 'deviceNamePlaceholder',
      useRemote: bindSnapshotSelector(store),
      t,
    } as unknown as DeviceNameRowComponentProps)} />)
    expect(screen.queryByText(zh.deviceNameTitle)).toBeNull()
  })

  it('does not commit an unchanged value and disables on read-only', () => {
    const commit = renderName()
    fireEvent.blur(screen.getByLabelText(zh.deviceNameTitle))
    expect(commit).not.toHaveBeenCalled()
    cleanup()
    renderName({ writable: false })
    expect(screen.getByLabelText<HTMLInputElement>(zh.deviceNameTitle).disabled).toBe(true)
  })
})

const PAIRING: LinkPairingValue = {
  v: 1,
  kind: 'dsh-link-pairing',
  hostId: 'host-1',
  hostName: 'Studio Desk',
  endpoint: 'https://192.168.1.4:4931',
  spkiFingerprint: 'ab'.repeat(32),
  code: 'pair-once',
  expiresAt: 1_800_000_000_000,
}

describe('RemoteDevicesRow', () => {
  function renderDevices(options: {
    enabled?: boolean
    status?: { listening: boolean; endpoint?: string; bindError?: string }
    devices?: Array<{ deviceId: string; name: string; role: 'observer' | 'controller'; lastSeenAt?: number; revokedAt?: number }>
    failing?: boolean
  } = {}) {
    const store = createSnapshotStore<Snapshot>({ ...BASE, value: { enabled: options.enabled ?? true, allowRemoteApproval: false, deviceName: 'Studio Desk' } })
    const api = {
      status: vi.fn(() => options.failing
        ? Promise.reject(new Error('down'))
        : Promise.resolve({
          listening: options.status?.listening ?? true,
          ...(options.status?.endpoint === undefined ? {} : { endpoint: options.status.endpoint }),
          ...(options.status?.bindError === undefined ? {} : { bindError: options.status.bindError }),
          hostName: 'Studio Desk',
          allowRemoteApproval: false,
          deviceCount: options.devices?.length ?? 0,
        })),
      createPairing: vi.fn(() => Promise.resolve(PAIRING)),
      devices: vi.fn(() => Promise.resolve(options.devices ?? [])),
      revokeDevice: vi.fn((deviceId: string) => Promise.resolve(
        options.devices?.find(device => device.deviceId === deviceId) === undefined
          ? undefined
          : { deviceId, name: 'iPhone', role: 'controller' as const, createdAt: 100, revokedAt: 500 },
      )),
    }
    render(<RemoteDevicesRow {...({
      api,
      useRemote: bindSnapshotSelector(store),
      t,
    } as unknown as RemoteDevicesRowComponentProps)} />)
    return api
  }

  it('shows the listening endpoint and pairs through a QR dialog', async () => {
    const api = renderDevices({ status: { listening: true, endpoint: 'https://192.168.1.4:4931' } })
    await waitFor(() => { expect(screen.getByText(`${zh.lanListening} — https://192.168.1.4:4931`)).not.toBeNull() })
    fireEvent.click(screen.getByText(zh.pairNewDevice))
    await waitFor(() => { expect(screen.getByRole('dialog')).not.toBeNull() })
    expect(api.createPairing).toHaveBeenCalledTimes(1)
    const qr = screen.getByRole('img', { name: `${zh.pairManualCode}: pair-once` })
    expect(qr.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('pair-once')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('explains a stopped carrier and a failed bind', async () => {
    renderDevices({ status: { listening: false } })
    await waitFor(() => { expect(screen.getByText(zh.lanStopped)).not.toBeNull() })
    cleanup()
    renderDevices({ status: { listening: false, bindError: 'EADDRINUSE listen' } })
    await waitFor(() => { expect(screen.getByText(`${zh.lanBindError} — EADDRINUSE listen`)).not.toBeNull() })
  })

  it('lists devices with their role and revokes on demand', async () => {
    const api = renderDevices({ devices: [
      { deviceId: 'device-1', name: 'iPhone', role: 'controller' },
      { deviceId: 'device-2', name: 'iPad', role: 'observer', revokedAt: 400 },
    ] })
    await waitFor(() => { expect(screen.getByText('iPhone')).not.toBeNull() })
    expect(screen.getByText(`${zh.controller} · ${zh.neverSeen}`)).not.toBeNull()
    expect(screen.getByText(`${zh.observer} · ${zh.neverSeen}`)).not.toBeNull()
    expect(screen.getByText(`iPad — ${zh.revoked}`)).not.toBeNull()
    const revokes = screen.getAllByText(zh.revoke)
    // Only trusted devices carry a revoke button; the modal close button shares no copy here.
    expect(revokes).toHaveLength(1)
    fireEvent.click(revokes[0]!)
    await waitFor(() => { expect(api.revokeDevice).toHaveBeenCalledWith('device-1') })
  })

  it('shows last-seen times, renders nothing while loading, and swallows a failed pairing', async () => {
    renderDevices({ devices: [{ deviceId: 'device-1', name: 'iPhone', role: 'controller', lastSeenAt: 200 }] })
    const seen = new Date(200).toLocaleString()
    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.textContent === `${zh.controller} · ${seen}`)).not.toBeNull()
    })
    cleanup()
    const store = createSnapshotStore<Snapshot>({ ...BASE, status: 'loading', value: undefined })
    render(<RemoteDevicesRow {...({
      api: {
        status: vi.fn(() => Promise.resolve({ listening: true, hostName: 'x', allowRemoteApproval: false, deviceCount: 0 })),
        createPairing: vi.fn(() => Promise.resolve(PAIRING)),
        devices: vi.fn(() => Promise.resolve([])),
        revokeDevice: vi.fn(() => Promise.resolve(undefined)),
      },
      useRemote: bindSnapshotSelector(store),
      t,
    } as unknown as RemoteDevicesRowComponentProps)} />)
    expect(screen.queryByText(zh.devicesTitle)).toBeNull()
    cleanup()
    const failing = {
      status: vi.fn(() => Promise.resolve({ listening: true, hostName: 'x', allowRemoteApproval: false, deviceCount: 0 })),
      createPairing: vi.fn(() => Promise.reject(new Error('link-disabled'))),
      devices: vi.fn(() => Promise.resolve([])),
      revokeDevice: vi.fn(() => Promise.resolve(undefined)),
    }
    render(<RemoteDevicesRow {...({
      api: failing,
      useRemote: bindSnapshotSelector(createSnapshotStore<Snapshot>({ ...BASE })),
      t,
    } as unknown as RemoteDevicesRowComponentProps)} />)
    await waitFor(() => { expect(screen.getByText(zh.pairNewDevice)).not.toBeNull() })
    fireEvent.click(screen.getByText(zh.pairNewDevice))
    await waitFor(() => { expect(failing.createPairing).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('renders the empty list, the load failure, and disables pairing while off', async () => {
    renderDevices({ devices: [] })
    await waitFor(() => { expect(screen.getByText(zh.noDevices)).not.toBeNull() })
    cleanup()
    renderDevices({ failing: true })
    await waitFor(() => { expect(screen.getByText(zh.loadFailed)).not.toBeNull() })
    cleanup()
    renderDevices({ enabled: false })
    await waitFor(() => { expect(screen.getByText<HTMLButtonElement>(zh.pairNewDevice).disabled).toBe(true) })
  })
})

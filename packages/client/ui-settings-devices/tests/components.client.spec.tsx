// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { DevicesSettingsSection } from '../src/client/DevicesSettingsSection.tsx'
import type {
  DevicesSettingsSectionInjected,
  DevicesSettingsSectionProps,
} from '../src/client/DevicesSettingsSection.tsx'
import { en, type DevicesLocaleKey } from '../src/client/locales.ts'
import type { DeviceView } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(cleanup)

const t = ((key: DevicesLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as DevicesSettingsSectionProps['t']

const formatTime = (epochMs: number): string => `T${epochMs}`

/** A roster with one active device per shape nuance the rows render. */
const DEVICES = [
  {
    deviceId: 'd-observer',
    deviceName: 'Pixel 9',
    role: 'viewer',
    keyFingerprint: '0123456789abcdef0123456789abcdef',
    pairedAt: 1000,
    platform: 'android',
    lastSeenAt: 2000,
  },
  {
    deviceId: 'd-controller',
    deviceName: 'MacBook',
    role: 'controller',
    keyFingerprint: 'fedcba9876543210fedcba9876543210',
    pairedAt: 3000,
    lastSeenAt: 3500,
    revokedAt: 4000,
  },
  {
    deviceId: 'd-owner',
    deviceName: '办公室主机',
    role: 'owner',
    keyFingerprint: 'aabbccddeeff00112233aabbccddeeff',
    pairedAt: 5000,
  },
] as unknown as readonly DeviceView[]

function inject(
  overrides: Partial<DevicesSettingsSectionInjected> = {},
): DevicesSettingsSectionInjected {
  return {
    list: vi.fn<DevicesSettingsSectionInjected['list']>().mockResolvedValue(DEVICES),
    rename: vi.fn<DevicesSettingsSectionInjected['rename']>().mockResolvedValue(undefined),
    revoke: vi.fn<DevicesSettingsSectionInjected['revoke']>().mockResolvedValue(undefined),
    revokeAll: vi.fn<DevicesSettingsSectionInjected['revokeAll']>().mockResolvedValue(2),
    formatTime,
    ...overrides,
  }
}

function props(face: DevicesSettingsSectionInjected = inject()): DevicesSettingsSectionProps {
  return { ...face, t, close: () => {} } as unknown as DevicesSettingsSectionProps
}

async function renderReady(face: DevicesSettingsSectionInjected = inject()): Promise<ReturnType<typeof render>> {
  const view = render(<DevicesSettingsSection {...props(face)} />)
  await screen.findByText('Pixel 9')
  return view
}

describe('DevicesSettingsSection', () => {
  it('renders one row per grant with role, platform, timing and fingerprint', async () => {
    await renderReady()
    expect(screen.getByText('MacBook')).toBeDefined()
    expect(screen.getByText('办公室主机')).toBeDefined()
    expect(screen.getByText(en['role.viewer'])).toBeDefined()
    expect(screen.getByText(en['role.controller'])).toBeDefined()
    expect(screen.getByText(en['role.owner'])).toBeDefined()
    expect(screen.getByText('android')).toBeDefined()
    expect(screen.getByText(en.pairedAt.replace('{time}', 'T1000'))).toBeDefined()
    expect(screen.getByText(en.lastSeenAt.replace('{time}', 'T2000'))).toBeDefined()
    expect(screen.getByText(en.fingerprint.replace('{value}', '0123456789abcdef'))).toBeDefined()
    expect(screen.queryByText('ios')).toBeNull()
  })

  it('distinguishes never-admitted and revoked rows', async () => {
    await renderReady()
    expect(screen.getByText(en.neverSeen)).toBeDefined()
    expect(screen.getByText(en.revoked)).toBeDefined()
    const revokedRow = screen.getByText('MacBook').closest('li')!
    expect(revokedRow.querySelector('button')).toBeNull()
    const activeRow = screen.getByText('Pixel 9').closest('li')!
    expect(activeRow.querySelectorAll('button').length).toBe(2)
  })

  it('shows the empty state when the Host holds no grants', async () => {
    render(<DevicesSettingsSection {...props(inject({ list: vi.fn().mockResolvedValue([]) }))} />)
    expect(await screen.findByText(en.empty)).toBeDefined()
  })

  it('maps a failed list read to its class copy', async () => {
    render(<DevicesSettingsSection
      {...props(inject({ list: vi.fn().mockRejectedValue(new RemoteError('device/admission-expired' as never, 'expired', {} as never)) }))}
    />)
    expect((await screen.findByRole('alert')).textContent).toContain(en['failure.authentication'])
  })

  it('maps an unclassified failure to the raw diagnostic', async () => {
    render(<DevicesSettingsSection
      {...props(inject({ list: vi.fn().mockRejectedValue(new Error('gateway exploded')) }))}
    />)
    expect((await screen.findByRole('alert')).textContent).toContain('gateway exploded')
  })

  it('renames through the inject face with a trimmed name', async () => {
    const face = inject()
    await renderReady(face)
    fireEvent.click(screen.getAllByRole('button', { name: en.rename })[0]!)
    const input = screen.getByRole('textbox', { name: en.rename }) as HTMLInputElement
    expect(input.value).toBe('Pixel 9')
    fireEvent.change(input, { target: { value: '  Pixel 9 Pro  ' } })
    fireEvent.click(screen.getByRole('button', { name: en.renameSave }))
    await waitFor(() => { expect(face.rename).toHaveBeenCalledWith('d-observer', 'Pixel 9 Pro') })
    expect(screen.queryByRole('textbox', { name: en.rename })).toBeNull()
    await waitFor(() => { expect(face.list).toHaveBeenCalledTimes(2) })
  })

  it('rejects an empty rename locally without calling the Host', async () => {
    const face = inject()
    await renderReady(face)
    fireEvent.click(screen.getAllByRole('button', { name: en.rename })[0]!)
    const input = screen.getByRole('textbox', { name: en.rename }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: en.renameSave }))
    expect(face.rename).not.toHaveBeenCalled()
    expect((await screen.findByRole('alert')).textContent).toContain(en.renameEmpty)
  })

  it('shows the class copy when the Host rejects a rename', async () => {
    const face = inject({ rename: vi.fn().mockRejectedValue(new RemoteError('device/not-found' as never, 'gone', {} as never)) })
    await renderReady(face)
    fireEvent.click(screen.getAllByRole('button', { name: en.rename })[0]!)
    fireEvent.click(screen.getByRole('button', { name: en.renameSave }))
    expect((await screen.findByRole('alert')).textContent).toContain(en['failure.unavailable'])
  })

  it('revokes one device only after inline confirmation', async () => {
    const face = inject()
    await renderReady(face)
    const row = within(screen.getByText('Pixel 9').closest('li')!)
    fireEvent.click(row.getByRole('button', { name: en.revoke }))
    expect(face.revoke).not.toHaveBeenCalled()
    fireEvent.click(row.getByRole('button', { name: en.revokeCancelled }))
    expect(screen.queryByText(en.revokeConfirm)).toBeNull()
    fireEvent.click(row.getByRole('button', { name: en.revoke }))
    fireEvent.click(row.getByRole('button', { name: en.revokeConfirmAction }))
    await waitFor(() => { expect(face.revoke).toHaveBeenCalledWith('d-observer') })
    await waitFor(() => { expect(face.list).toHaveBeenCalledTimes(2) })
    expect(screen.queryByText(en.revokeConfirm)).toBeNull()
  })

  it('revokes every active grant after confirmation and reports the count', async () => {
    const face = inject()
    await renderReady(face)
    fireEvent.click(screen.getByRole('button', { name: en.revokeAll }))
    expect(face.revokeAll).not.toHaveBeenCalled()
    expect(screen.getByText(en.revokeAllConfirm)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.revokeAllConfirmAction }))
    await waitFor(() => { expect(face.revokeAll).toHaveBeenCalledTimes(1) })
    expect(screen.getByText(en.revokeAllDone.replace('{count}', '2'))).toBeDefined()
    await waitFor(() => { expect(face.list).toHaveBeenCalledTimes(2) })
  })

  it('refreshes without reporting a count when revoke-all fails', async () => {
    const face = inject({ revokeAll: vi.fn().mockRejectedValue(new RemoteError('device/admission-expired' as never, 'expired', {} as never)) })
    await renderReady(face)
    fireEvent.click(screen.getByRole('button', { name: en.revokeAll }))
    fireEvent.click(screen.getByRole('button', { name: en.revokeAllConfirmAction }))
    await waitFor(() => { expect(face.list).toHaveBeenCalledTimes(2) })
    expect(screen.queryByText(en.revokeAllDone.replace('{count}', '2'))).toBeNull()
  })

  it('re-reads the roster on refresh', async () => {
    const face = inject()
    await renderReady(face)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(face.list).toHaveBeenCalledTimes(2) })
  })
})

// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativePairingPayload } from '@deepseek-ai/dsh-api-remotes/client'
import { PairingPanel, type PairingActions } from '../src/client/PairingPanel.tsx'
import type { DevicesSettingsSectionProps } from '../src/client/DevicesSettingsSection.tsx'
import { en, type DevicesLocaleKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const t = ((key: DevicesLocaleKey, params: Record<string, string> = {}) =>
  Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as DevicesSettingsSectionProps['t']
const payload = (): NativePairingPayload => ({
  kind: 'dsh-native-pairing', version: 1, endpoint: 'https://host.test:8443',
  hostId: 'host-fixture' as NativePairingPayload['hostId'], displayName: 'Fixture Host',
  spkiFingerprint: 'a'.repeat(64), code: 'fixture-one-time', expiresAt: Date.now() + 60_000, role: 'viewer',
})
function setup(create = vi.fn<PairingActions['create']>().mockResolvedValue(payload())) {
  const close = vi.fn()
  const view = render(<StrictMode><PairingPanel actions={{ create }} t={t} formatTime={time => String(time)}
    failureCopy={() => 'Fixture refusal'} close={close} /></StrictMode>)
  const generate = async () => {
    fireEvent.change(screen.getByLabelText(en['pairing.address']), { target: { value: 'https://host.test:8443' } })
    await act(async () => { fireEvent.click(screen.getByText(en['pairing.generate'])) })
  }
  return { ...view, create, close, generate }
}

describe('native pairing panel', () => {
  it('uses the selected role and displays one matching QR and copyable payload', async () => {
    const next = { ...payload(), role: 'controller' as const }
    const b = setup(vi.fn<PairingActions['create']>().mockResolvedValue(next))
    fireEvent.change(screen.getByLabelText(en['pairing.role']), { target: { value: 'controller' } })
    expect(screen.getByText(en['pairing.permission.controller'])).toBeDefined()
    await b.generate()
    expect(b.create).toHaveBeenCalledWith('https://host.test:8443', 'controller')
    expect(screen.getByLabelText<HTMLTextAreaElement>(en['pairing.payload']).value).toBe(JSON.stringify(next))
    expect(b.container.querySelector('svg title')?.textContent).toBe(en['pairing.qr'])
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    await act(async () => { fireEvent.click(screen.getByText(en['pairing.copy'])) })
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(next))
    expect(screen.getByText(en['pairing.copied'])).toBeDefined()
    fireEvent.click(screen.getByText(en['pairing.close']))
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('keeps a selectable payload when clipboard permission is denied', async () => {
    const b = setup()
    await b.generate()
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } } }))
    await act(async () => { fireEvent.click(screen.getByText(en['pairing.copy'])) })
    expect(screen.getByText(en['pairing.copyFailed'])).toBeDefined()
    expect(screen.getByLabelText(en['pairing.payload'])).toBeDefined()
  })

  it.each(['pairing.address', 'pairing.role'] as const)('hides the previous grant when editing %s', async (field) => {
    const b = setup()
    await b.generate()
    fireEvent.change(screen.getByLabelText(en[field]), { target: { value: field === 'pairing.role' ? 'owner' : 'https://another.test:8443' } })
    expect(screen.queryByLabelText(en['pairing.payload'])).toBeNull()
    expect(b.container.querySelector('svg')).toBeNull()
  })

  it.each(['invalid', 'failure', 'expired'] as const)('presents %s without a QR or secret', async (reason) => {
    const create = vi.fn<PairingActions['create']>()
    if (reason === 'failure') create.mockRejectedValue(new Error('refused'))
    else create.mockResolvedValue(reason === 'invalid' ? undefined : { ...payload(), expiresAt: Date.now() - 1 })
    const b = setup(create)
    await b.generate()
    expect(screen.getByText(reason === 'failure' ? 'Fixture refusal' : en[reason === 'invalid' ? 'pairing.invalidAddress' : 'pairing.expired'])).toBeDefined()
    expect(screen.queryByLabelText(en['pairing.payload'])).toBeNull()
    expect(b.container.querySelector('svg')).toBeNull()
  })

  it('removes the secret and QR at expiry and cancels a pending clipboard result', async () => {
    vi.useFakeTimers({ now: 1000 })
    const copied = Promise.withResolvers<undefined>()
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText: () => copied.promise } } }))
    const b = setup()
    await b.generate()
    fireEvent.click(screen.getByText(en['pairing.copy']))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    await act(async () => { copied.resolve(undefined); await copied.promise })
    expect(screen.getByText(en['pairing.expired'])).toBeDefined()
    expect(screen.queryByLabelText(en['pairing.payload'])).toBeNull()
    expect(b.container.querySelector('svg')).toBeNull()
    expect(screen.queryByText(en['pairing.copied'])).toBeNull()
    b.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)('discards issuance that will %s after the panel was closed', async (outcome) => {
    const issued = Promise.withResolvers<NativePairingPayload>()
    const b = setup(vi.fn<PairingActions['create']>().mockReturnValue(issued.promise))
    await b.generate()
    expect(screen.getByText<HTMLButtonElement>(en['pairing.working']).disabled).toBe(true)
    b.unmount()
    await act(async () => {
      if (outcome === 'resolve') issued.resolve(payload())
      else issued.reject(new Error('closed request failed'))
      await issued.promise.catch(() => undefined)
    })
    expect(screen.queryByLabelText(en['pairing.payload'])).toBeNull()
  })

  it('refuses a copy after the clock passes expiry before the timer runs', async () => {
    vi.useFakeTimers({ now: 1000 })
    const b = setup()
    await b.generate()
    const writeText = vi.fn()
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    vi.setSystemTime(62_000)
    await act(async () => { fireEvent.click(screen.getByText(en['pairing.copy'])) })
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.getByText(en['pairing.expired'])).toBeDefined()
    expect(screen.queryByLabelText(en['pairing.payload'])).toBeNull()
  })

  it('discards clipboard failure after the displayed payload was edited', async () => {
    const copied = Promise.withResolvers<undefined>()
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText: () => copied.promise } } }))
    const b = setup()
    await b.generate()
    fireEvent.click(screen.getByText(en['pairing.copy']))
    fireEvent.change(screen.getByLabelText(en['pairing.address']), { target: { value: 'https://other.test:8443' } })
    await act(async () => { copied.reject(new Error('clipboard denied')); await copied.promise.catch(() => undefined) })
    expect(screen.queryByText(en['pairing.copyFailed'])).toBeNull()
  })
})

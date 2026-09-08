// @vitest-environment jsdom
/** Localized export feedback and suppression of duplicate clicks or post-unmount updates. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopSupportResult } from '@deepseek-ai/dsh-host-electron-ipc/types'
import { SupportExportRow, type SupportExportRowProps } from '../src/client/SupportExportRow.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

it.each([en, zh])('disables export while native work is pending and renders the localized saved result', async (copy) => {
  const result = Promise.withResolvers<DesktopSupportResult>()
  const exportSupport = vi.fn(() => result.promise)
  render(<SupportExportRow {...({ exportSupport, t: (key: keyof typeof copy) => copy[key] } as unknown as SupportExportRowProps)} />)
  const button = screen.getByRole('button', { name: copy.supportExport })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(exportSupport).toHaveBeenCalledOnce()
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(copy.supportWorking)
  result.resolve({ status: 'saved', bytes: 42, sha256: 'a'.repeat(64), complete: false })
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(copy.supportSaved) })
  expect((button as HTMLButtonElement).disabled).toBe(false)
})

it.each([
  [{ status: 'cancelled' }, 'supportCancelled'],
  [{ status: 'busy' }, 'supportBusy'],
  [{ status: 'failed', reason: 'unavailable' }, 'supportUnavailable'],
  [{ status: 'failed', reason: 'secrets-detected' }, 'supportRejected'],
] as const)('renders a refusal or cancellation without displaying native details', async (result, key) => {
  const props = { exportSupport: () => Promise.resolve(result), t: (key: keyof typeof en) => en[key] } as unknown as SupportExportRowProps
  render(<SupportExportRow {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.supportExport }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en[key]) })
})

it('contains a transport failure and ignores completion after unmount', async () => {
  const pending = Promise.withResolvers<DesktopSupportResult>()
  const callback = vi.fn((): Promise<DesktopSupportResult> => Promise.reject(new Error('private transport text')))
  const props = { exportSupport: callback, t: (key: keyof typeof en) => en[key] } as unknown as SupportExportRowProps
  const rendered = render(<SupportExportRow {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en.supportExport }))
  await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.supportUnavailable) })
  expect(screen.queryByText('private transport text')).toBeNull()
  callback.mockImplementation(() => pending.promise)
  fireEvent.click(screen.getByRole('button', { name: en.supportExport }))
  rendered.unmount()
  pending.resolve({ status: 'cancelled' })
  await Promise.resolve()
  expect(screen.queryByRole('status')).toBeNull()
})

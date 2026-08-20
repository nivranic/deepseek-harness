// @vitest-environment jsdom
/**
 * The General-section row: a two-option radio group over the bound namespace
 * snapshot. Loading, absent namespaces, and a not-yet-accepted value render
 * nothing; a read-only document disables the control without hiding it.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { CloseActionRow } from '../src/client/CloseActionRow.tsx'
import type { CloseActionRowComponentProps } from '../src/client/CloseActionRow.tsx'
import type { DesktopSettings } from '../src/desktop-settings.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = SettingsScopeSnapshot<DesktopSettings>

const BASE: Snapshot = {
  status: 'ready',
  value: { closeAction: 'tray' },
  base: undefined,
  user: undefined,
  revision: 1,
  writable: true,
  mode: 'host',
}

function renderRow(state: Partial<Snapshot> = {}) {
  const store = createSnapshotStore<Snapshot>({ ...BASE, ...state })
  const select = vi.fn()
  render(<CloseActionRow {...({
    select,
    useDesktopClose: bindSnapshotSelector(store),
    t: (key: keyof typeof zh) => zh[key],
  } as unknown as CloseActionRowComponentProps)} />)
  return select
}

describe('CloseActionRow', () => {
  it('renders the two behaviors with the current one checked', () => {
    renderRow()
    const group = screen.getByRole('radiogroup', { name: zh.title })
    expect(group).not.toBeNull()
    const tray = screen.getByRole('radio', { name: zh.tray })
    const quit = screen.getByRole('radio', { name: zh.quit })
    expect(tray.getAttribute('aria-checked')).toBe('true')
    expect(quit.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(zh.description)).not.toBeNull()
  })

  it('marks quit checked when the stored value is quit', () => {
    renderRow({ value: { closeAction: 'quit' } })
    expect(screen.getByRole('radio', { name: zh.quit }).getAttribute('aria-checked')).toBe('true')
  })

  it('selects only the other option', () => {
    const select = renderRow()
    fireEvent.click(screen.getByRole('radio', { name: zh.tray }))
    fireEvent.click(screen.getByRole('radio', { name: zh.quit }))
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith('quit')
  })

  it('disables both options on a read-only document', () => {
    renderRow({ writable: false })
    const tray = screen.getByRole('radio', { name: zh.tray }) as HTMLButtonElement
    const quit = screen.getByRole('radio', { name: zh.quit }) as HTMLButtonElement
    expect(tray.disabled).toBe(true)
    expect(quit.disabled).toBe(true)
  })

  it.each([
    ['loading', { status: 'loading' as const, value: undefined }],
    ['unavailable', { status: 'unavailable' as const, value: undefined }],
    ['not yet accepted', { value: undefined }],
  ])('renders nothing while the value is %s', (_name, state) => {
    renderRow(state)
    expect(screen.queryByText(zh.title)).toBeNull()
  })
})

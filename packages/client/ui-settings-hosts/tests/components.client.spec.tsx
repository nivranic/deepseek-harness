// @vitest-environment jsdom
/** Host roster presentation over observable target and roster snapshots. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { HostsSettingsSection, type HostsSettingsSectionInjected, type HostsSettingsSectionProps } from '../src/client/HostsSettingsSection.tsx'
import { en, type HostsLocaleKey } from '../src/client/locales.ts'
import type { SavedHost } from '@deepseek-ai/dsh-client-connection/client'

afterEach(cleanup)
const t = ((key: HostsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as HostsSettingsSectionProps['t']
const ROWS: readonly SavedHost[] = [
  { hostId: 'work', displayName: 'Workstation', platform: 'win32', origin: 'https://work.local', lastConnectedAt: 4000 },
  { hostId: 'local', displayName: undefined, platform: undefined, origin: 'in-process', lastConnectedAt: 2000 },
]

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
  }
}

function useSource<T, R>(value: ReturnType<typeof source<T>>, select: (value: T) => R): R {
  return select(useSyncExternalStore(value.subscribe, value.getSnapshot))
}

function bench(rows = ROWS, selected?: string) {
  const roster = source<readonly SavedHost[]>(rows)
  const target = source<string | undefined>(selected)
  const face: HostsSettingsSectionInjected = {
    hooks: { savedHosts: roster, selectedOrigin: target },
    pageOrigin: 'https://page.local',
    switchTo: vi.fn((hostId: string) => {
      const row = roster.getSnapshot().find(value => value.hostId === hostId)
      if (row !== undefined) target.set(row.origin)
      return row
    }),
    useLocalHost: vi.fn(() => { target.set(undefined) }),
    forget: vi.fn((hostId: string) => { roster.set(roster.getSnapshot().filter(row => row.hostId !== hostId)) }),
    rename: vi.fn((hostId: string, customName: string | undefined) => {
      roster.set(roster.getSnapshot().map((row) => {
        if (row.hostId !== hostId) return row
        const refreshed: SavedHost = {
          hostId: row.hostId, displayName: row.displayName, platform: row.platform,
          origin: row.origin, lastConnectedAt: row.lastConnectedAt,
        }
        return customName === undefined ? refreshed : { ...refreshed, customName }
      }))
    }),
    formatTime: time => `T${time}`,
  }
  const props = {
    ...face, t, close: () => {},
    useSavedHosts: <R,>(select: (value: readonly SavedHost[]) => R) => useSource(roster, select),
    useSelectedOrigin: <R,>(select: (value: string | undefined) => R) => useSource(target, select),
  } as unknown as HostsSettingsSectionProps // Unused framework props are outside this presentation harness.
  return { face, props, roster, target }
}

describe('HostsSettingsSection', () => {
  it('presents identity, timing, and only routable Host actions', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} />)
    expect(screen.getByText('Workstation')).toBeDefined()
    expect(screen.getByText('https://work.local')).toBeDefined()
    expect(screen.getByText(en.inProcess)).toBeDefined()
    expect(document.querySelector('[data-host-id="local"] [data-host-switch]')).toBeNull()
    expect(screen.queryByText(en.useLocal)).toBeNull()
  })

  it('updates the selected tag immediately after an external target change', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} />)
    act(() => { h.target.set('https://work.local') })
    expect(document.querySelector('[data-host-id="work"]')?.hasAttribute('data-host-selected')).toBe(true)
    expect(document.querySelector('[data-host-id="work"] [data-host-switch]')).toBeNull()
    expect(screen.getByText(en.current)).toBeDefined()
    expect(screen.queryByText('Refresh')).toBeNull()
  })

  it('selects a row, then hides its action notice after an external target change', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} pageOrigin="https://work.local" />)
    fireEvent.click(screen.getByRole('button', { name: en.switch }))
    expect(h.face.switchTo).toHaveBeenCalledExactlyOnceWith('work')
    expect(screen.getByText(en.switchedTo.replace('{name}', 'Workstation'))).toBeDefined()
    act(() => { h.target.set('https://other.local') })
    expect(screen.queryByText(en.switchedTo.replace('{name}', 'Workstation'))).toBeNull()
  })

  it('renames a row from its presented name and rejects an empty draft', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} />)
    fireEvent.click(document.querySelector<HTMLElement>('[data-host-id="work"] [data-host-rename]')!)
    const input = screen.getByRole('textbox', { name: en.rename }) as HTMLInputElement
    expect(input.value).toBe('Workstation')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: en.renameSave }))
    expect(h.face.rename).not.toHaveBeenCalled()
    expect(screen.getByText(en.renameEmpty)).toBeDefined()
    fireEvent.change(input, { target: { value: ' Desk ' } })
    fireEvent.click(screen.getByRole('button', { name: en.renameSave }))
    expect(h.face.rename).toHaveBeenCalledExactlyOnceWith('work', 'Desk')
    expect(screen.getByText('Desk')).toBeDefined()
    expect(screen.queryByRole('textbox', { name: en.rename })).toBeNull()
  })

  it('presents a custom name in the switch notice and offers reset back to descriptor facts', () => {
    const h = bench([{ ...ROWS[0]!, customName: 'Desk' }, ROWS[1]!])
    render(<HostsSettingsSection {...h.props} pageOrigin="https://work.local" />)
    expect(screen.getByText('Desk')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.switch }))
    expect(screen.getByText(en.switchedTo.replace('{name}', 'Desk'))).toBeDefined()
    fireEvent.click(document.querySelector<HTMLElement>('[data-host-id="work"] [data-host-rename-reset]')!)
    expect(h.face.rename).toHaveBeenCalledExactlyOnceWith('work', undefined)
  })

  it('hides the reset action until a custom name exists', () => {
    render(<HostsSettingsSection {...bench().props} />)
    expect(document.querySelector('[data-host-id="work"] [data-host-rename-reset]')).toBeNull()
  })

  it('forgets exactly one row and reacts to the published roster', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} />)
    fireEvent.click(document.querySelector<HTMLElement>('[data-host-id="local"] [data-host-forget]')!)
    expect(h.face.forget).toHaveBeenCalledExactlyOnceWith('local')
    expect(document.querySelector('[data-host-id="local"]')).toBeNull()
  })

  it('returns to the page Host through the action and observable snapshot', () => {
    const h = bench(ROWS, 'https://work.local')
    render(<HostsSettingsSection {...h.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.useLocal }))
    expect(h.face.useLocalHost).toHaveBeenCalledOnce()
    expect(screen.getByText(en.currentPage)).toBeDefined()
    expect(screen.queryByText(en.useLocal)).toBeNull()
  })

  it('presents the empty roster', () => {
    render(<HostsSettingsSection {...bench([]).props} />)
    expect(screen.getByText(en.empty)).toBeDefined()
  })

  it('offers a separate page instead of an in-page switch for cross-origin Hosts', () => {
    const h = bench([...ROWS, { ...ROWS[0]!, hostId: 'page', origin: 'https://page.local' }])
    render(<HostsSettingsSection {...h.props} />)
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: en.openHost })
    expect(link.href).toBe('https://work.local/')
    expect(link.rel).toBe('noopener noreferrer')
    expect(link.target).toBe('_blank')
    expect(document.querySelector('[data-host-id="work"] [data-host-switch]')).toBeNull()
    expect(document.querySelector('[data-host-id="page"] [data-host-switch]')).not.toBeNull()
    expect(screen.getByText(en.pairingHint)).toBeDefined()
  })
})

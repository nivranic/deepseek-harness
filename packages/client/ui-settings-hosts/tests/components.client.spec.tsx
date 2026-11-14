// @vitest-environment jsdom
/** Host roster presentation over observable target and roster snapshots. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { HostsSettingsSection, type HostsSettingsSectionInjected, type HostsSettingsSectionProps } from '../src/client/HostsSettingsSection.tsx'
import { en, type HostsLocaleKey } from '../src/client/locales.ts'
import type { SavedHost } from '../src/client/saved-hosts.ts'
import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'

const hostId = (value: string): HostId => value as HostId

afterEach(cleanup)
const t = ((key: HostsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as HostsSettingsSectionProps['t']
const ROWS: readonly SavedHost[] = [
  { hostId: hostId('work'), displayName: 'Workstation', platform: 'win32', origin: 'https://work.local', lastConnectedAt: 4000 },
  { hostId: hostId('local'), displayName: undefined, platform: undefined, origin: 'in-process', lastConnectedAt: 2000 },
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

function bench(rows = ROWS, selected?: HostId) {
  const roster = source<readonly SavedHost[]>(rows)
  const target = source<HostId | undefined>(selected)
  const face: HostsSettingsSectionInjected = {
    hooks: { savedHosts: roster, currentHostId: target },
    pageOrigin: 'https://page.local',
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
    move: vi.fn((hostId: string, direction: 'up' | 'down') => {
      const rows = [...roster.getSnapshot()]
      const index = rows.findIndex(row => row.hostId === hostId)
      const target = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || target < 0 || target >= rows.length) return
      const [moved, displaced] = [rows[target]!, rows[index]!] as const
      rows[index] = moved
      rows[target] = displaced
      roster.set(rows)
    }),
    formatTime: time => `T${time}`,
  }
  const props: HostsSettingsSectionProps = {
    ...({} as GlobalStandardProps), ...face, t, close: () => {},
    useSavedHosts: <R,>(select: (value: readonly SavedHost[]) => R) => useSource(roster, select),
    useCurrentHostId: <R,>(select: (value: HostId | undefined) => R) => useSource(target, select),
  }
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
  })

  it('updates the selected tag immediately after an external target change', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} />)
    act(() => { h.target.set(hostId('work')) })
    expect(document.querySelector('[data-host-id="work"]')?.hasAttribute('data-host-selected')).toBe(true)
    expect(document.querySelector('[data-host-id="work"] [data-host-switch]')).toBeNull()
    expect(screen.getByText(en.current)).toBeDefined()
    expect(screen.queryByText('Refresh')).toBeNull()
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

  it('presents a custom name and offers reset back to descriptor facts', () => {
    const h = bench([{ ...ROWS[0]!, customName: 'Desk' }, ROWS[1]!])
    render(<HostsSettingsSection {...h.props} pageOrigin="https://work.local" />)
    expect(screen.getByText('Desk')).toBeDefined()
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

  it('moves a row through the action with boundary buttons disabled and re-renders the roster', () => {
    const h = bench()
    render(<HostsSettingsSection {...h.props} />)
    const rowIds = (): (string | undefined)[] =>
      [...document.querySelectorAll('[data-host-id]')].map(node => (node as HTMLElement).dataset.hostId)
    const button = (row: string, kind: 'up' | 'down'): HTMLButtonElement =>
      document.querySelector(`[data-host-id="${row}"] [data-host-move-${kind}]`) as HTMLButtonElement
    expect(rowIds()).toEqual(['work', 'local'])
    expect(button('work', 'up').disabled).toBe(true)
    expect(button('work', 'down').disabled).toBe(false)
    expect(button('local', 'up').disabled).toBe(false)
    expect(button('local', 'down').disabled).toBe(true)
    fireEvent.click(button('work', 'down'))
    expect(h.face.move).toHaveBeenCalledExactlyOnceWith('work', 'down')
    expect(rowIds()).toEqual(['local', 'work'])
  })

  it('presents the empty roster', () => {
    render(<HostsSettingsSection {...bench([]).props} />)
    expect(screen.getByText(en.empty)).toBeDefined()
  })

  it('offers a separate page instead of an in-page switch for cross-origin Hosts', () => {
    const h = bench([...ROWS, { ...ROWS[0]!, hostId: hostId('page'), origin: 'https://page.local' }])
    render(<HostsSettingsSection {...h.props} />)
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: en.openHost })
    expect(link.href).toBe('https://work.local/')
    expect(link.rel).toBe('noopener noreferrer')
    expect(link.target).toBe('_blank')
    expect(document.querySelector('[data-host-id="work"] [data-host-switch]')).toBeNull()
    expect(document.querySelector('[data-host-id="page"] [data-host-switch]')).toBeNull()
    expect(screen.getByText(en.pairingHint)).toBeDefined()
  })
})

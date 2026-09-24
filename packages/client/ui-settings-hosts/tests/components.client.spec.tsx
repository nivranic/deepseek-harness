// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostsSettingsSection } from '../src/client/HostsSettingsSection.tsx'
import type {
  HostsSettingsSectionInjected,
  HostsSettingsSectionProps,
} from '../src/client/HostsSettingsSection.tsx'
import { en, type HostsLocaleKey } from '../src/client/locales.ts'
import type { SavedHost } from '@deepseek-ai/dsh-client-connection/client'

afterEach(cleanup)

const t = ((key: HostsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as HostsSettingsSectionProps['t']

const formatTime = (epochMs: number): string => `T${epochMs}`

/** A roster with one row per shape nuance the section renders. */
const ROWS: readonly SavedHost[] = [
  {
    hostId: 'h-workstation',
    displayName: 'Workstation',
    platform: 'win32',
    origin: 'https://workstation.local:8787',
    lastConnectedAt: 4000,
  },
  {
    hostId: 'h-plain',
    displayName: undefined,
    platform: undefined,
    origin: 'in-process',
    lastConnectedAt: 2000,
  },
]

function inject(overrides: Partial<HostsSettingsSectionInjected> = {}): HostsSettingsSectionInjected {
  return {
    rows: () => ROWS,
    selectedOrigin: () => undefined,
    switchTo: vi.fn<HostsSettingsSectionInjected['switchTo']>().mockImplementation(
      hostId => ROWS.find(row => row.hostId === hostId),
    ),
    useLocalHost: vi.fn(),
    forget: vi.fn(),
    subscribe: () => () => {},
    formatTime,
    ...overrides,
  }
}

function props(overrides: Partial<HostsSettingsSectionInjected> = {}): HostsSettingsSectionProps {
  return { ...inject(overrides), t, close: () => {} } as unknown as HostsSettingsSectionProps
}

describe('HostsSettingsSection', () => {
  it('renders one row per saved Host with name, origin, timing, and the in-page marker', () => {
    render(<HostsSettingsSection {...props()} />)
    expect(screen.getByText('Workstation')).toBeDefined()
    expect(screen.getByText('https://workstation.local:8787')).toBeDefined()
    expect(screen.getByText(en['inProcess'])).toBeDefined()
    expect(screen.getByText(en['lastConnectedAt'].replaceAll('{time}', 'T4000'))).toBeDefined()
  })

  it('marks the selected row, hides its switch action, and offers returning to the page Host', () => {
    render(<HostsSettingsSection {...props({ selectedOrigin: () => 'https://workstation.local:8787' })} />)
    expect(screen.getByText(en.current)).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.useLocal }).disabled).toBe(false)
    expect(document.querySelector('[data-host-id="h-workstation"] [data-host-switch]')).toBeNull()
    expect(document.querySelector('[data-host-id="h-plain"] [data-host-switch]')).toBeNull()
  })

  it('shows the page-Host status without a selection and no return action', () => {
    render(<HostsSettingsSection {...props()} />)
    expect(screen.getByText(en.currentPage)).toBeDefined()
    expect(screen.queryByText(en.useLocal)).toBeNull()
  })

  it('switches through the face and reports the switched name', () => {
    const face = inject()
    render(<HostsSettingsSection {...props(face)} />)
    fireEvent.click(document.querySelector('[data-host-id="h-workstation"] [data-host-switch]') as HTMLElement)
    expect(face.switchTo).toHaveBeenCalledExactlyOnceWith('h-workstation')
    expect(screen.getByText(en.switchedTo.replaceAll('{name}', 'Workstation'))).toBeDefined()
  })

  it('forgets one row through the face', () => {
    const face = inject()
    render(<HostsSettingsSection {...props(face)} />)
    fireEvent.click(document.querySelector('[data-host-id="h-plain"] [data-host-forget]') as HTMLElement)
    expect(face.forget).toHaveBeenCalledExactlyOnceWith('h-plain')
  })

  it('returns to the page Host through the face and clears the notice', () => {
    let current: string | undefined
    const face = inject({
      selectedOrigin: () => current,
      switchTo: vi.fn<HostsSettingsSectionInjected['switchTo']>().mockImplementation((hostId) => {
        const row = ROWS.find(item => item.hostId === hostId)
        if (row !== undefined) current = row.origin
        return row
      }),
      useLocalHost: vi.fn<HostsSettingsSectionInjected['useLocalHost']>().mockImplementation(() => { current = undefined }),
    })
    render(<HostsSettingsSection {...props(face)} />)
    fireEvent.click(document.querySelector('[data-host-id="h-workstation"] [data-host-switch]') as HTMLElement)
    expect(screen.getByText(en.switchedTo.replaceAll('{name}', 'Workstation'))).toBeDefined()
    fireEvent.click(screen.getByText(en.useLocal))
    expect(face.useLocalHost).toHaveBeenCalledOnce()
    expect(screen.queryByText(en.switchedTo.replaceAll('{name}', 'Workstation'))).toBeNull()
  })

  it('renders the empty state without rows', () => {
    render(<HostsSettingsSection {...props({ rows: () => [] })} />)
    expect(screen.getByText(en.empty)).toBeDefined()
    expect(screen.queryByText('Workstation')).toBeNull()
  })
})

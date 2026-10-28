// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HealthComponent, HealthSnapshot } from '@deepseek-ai/dsh-api-host-diagnostics/client'
import { HOST_STATUS_COMPONENTS, HostStatusSection } from '../src/client/HostStatusSection.tsx'
import type { HostStatusSectionProps } from '../src/client/HostStatusSection.tsx'
import type { HostStatusComponentName, HostStatusLocaleKey } from '../src/client/locales.ts'
import { en, zh } from '../src/client/locales.ts'
// Type-only: pulls the 'settings.hostStatus' LocaleNamespaceMap merge into the program.
import type {} from '../src/client/index.ts'

afterEach(cleanup)

const t = ((key: HostStatusLocaleKey): string => en[key]) as HostStatusSectionProps['t']

/** One all-green component set; per-test scenarios replace whole components and the verdict. */
const greenComponents: Record<HostStatusComponentName, HealthComponent> = {
  process: { state: 'up', detail: 'main fiber running' },
  runtime: { state: 'up', detail: 'node v24.10.0' },
  sessionStore: { state: 'up', detail: 'sqlite session store at schema 3' },
  pluginState: { state: 'up', detail: 'plugin registry mounted' },
  connection: { state: 'up', detail: 'loopback carrier' },
  modelProvider: { state: 'up', detail: 'deepseek provider configured' },
}

function sectionProps(health: () => Promise<HealthSnapshot>): HostStatusSectionProps {
  return { close: () => {}, t, health } as unknown as HostStatusSectionProps
}

/** An all-green snapshot with `ready` true. */
const greenSnapshot = (): HealthSnapshot => ({ ...greenComponents, ready: true })

/** Replace one component and set the verdict the Host would derive from it. */
function withComponent(name: HostStatusComponentName, component: HealthComponent, ready: boolean): HealthSnapshot {
  return { ...greenComponents, [name]: component, ready }
}

describe('HostStatusSection', () => {
  it('renders the six all-green rows under a ready verdict, with each detail passed through', async () => {
    const { container } = render(<HostStatusSection {...sectionProps(() => Promise.resolve(greenSnapshot()))} />)
    await waitFor(() => { expect(container.querySelector('[data-host-ready="true"]')).not.toBeNull() })
    const verdict = container.querySelector('[data-host-ready="true"]') as HTMLElement
    expect(within(verdict).getByText(en.ready)).toBeDefined()
    expect(screen.queryByText(en.notReady)).toBeNull()
    expect(container.querySelectorAll('[data-component]')).toHaveLength(HOST_STATUS_COMPONENTS.length)
    for (const name of HOST_STATUS_COMPONENTS) {
      const row = container.querySelector(`[data-component="${name}"]`) as HTMLElement
      expect(row.getAttribute('data-component-state')).toBe('up')
      expect(within(row).getByText(en[`component.${name}`])).toBeDefined()
      // The probe detail renders verbatim from the snapshot value.
      expect(within(row).getByText(greenComponents[name].detail)).toBeDefined()
    }
  })

  it('flips the verdict when modelProvider degrades', async () => {
    const snapshot = withComponent('modelProvider', { state: 'degraded', detail: 'no provider configured' }, false)
    const { container } = render(<HostStatusSection {...sectionProps(() => Promise.resolve(snapshot))} />)
    await waitFor(() => { expect(container.querySelector('[data-host-ready="false"]')).not.toBeNull() })
    const verdict = container.querySelector('[data-host-ready="false"]') as HTMLElement
    expect(within(verdict).getByText(en.notReady)).toBeDefined()
    expect(container.querySelector('[data-component="modelProvider"]')?.getAttribute('data-component-state')).toBe('degraded')
  })

  it('flips the verdict when sessionStore is down', async () => {
    const snapshot = withComponent('sessionStore', { state: 'down', detail: 'session store owner absent' }, false)
    const { container } = render(<HostStatusSection {...sectionProps(() => Promise.resolve(snapshot))} />)
    await waitFor(() => { expect(container.querySelector('[data-host-ready="false"]')).not.toBeNull() })
    const verdict = container.querySelector('[data-host-ready="false"]') as HTMLElement
    expect(within(verdict).getByText(en.notReady)).toBeDefined()
    expect(container.querySelector('[data-component="sessionStore"]')?.getAttribute('data-component-state')).toBe('down')
  })

  it('reports a failed read and recovers through retry', async () => {
    let calls = 0
    const health = (): Promise<HealthSnapshot> => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('host unreachable')) : Promise.resolve(greenSnapshot())
    }
    const { container } = render(<HostStatusSection {...sectionProps(health)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(container.querySelector('[data-host-ready="true"]')).not.toBeNull() })
    expect(container.querySelectorAll('[data-component]')).toHaveLength(HOST_STATUS_COMPONENTS.length)
  })

  it('shows the busy loading line until the first snapshot settles', () => {
    render(<HostStatusSection {...sectionProps(() => new Promise<HealthSnapshot>(() => {}))} />)
    expect(screen.getByText(en.loading).getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps a non-empty name and state entry for every component in both dictionaries', () => {
    for (const dict of [en, zh]) {
      for (const name of HOST_STATUS_COMPONENTS) {
        expect(dict[`component.${name}`].length).toBeGreaterThan(0)
      }
      for (const state of ['up', 'degraded', 'down'] as const) {
        expect(dict[`state.${state}`].length).toBeGreaterThan(0)
      }
    }
  })
})

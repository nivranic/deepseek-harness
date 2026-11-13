// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { TelemetryConsent } from '@deepseek-ai/dsh-session-telemetry'
import { TELEMETRY_CONSENT_KINDS, TelemetrySettingsSection } from '../src/client/TelemetrySettingsSection.tsx'
import type { TelemetrySettingsSectionProps, TelemetrySettingsValue } from '../src/client/TelemetrySettingsSection.tsx'
import { en, zh, type TelemetrySettingsLocaleKey } from '../src/client/locales.ts'
// Type-only: pulls the 'settings.telemetry' LocaleNamespaceMap merge into the program.
import type {} from '../src/client/index.ts'

afterEach(cleanup)

const t = ((key: TelemetrySettingsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as TelemetrySettingsSectionProps['t']

const OFF: TelemetryConsent = {
  sessionTelemetry: false,
  providerMetadata: false,
  relayMetadata: false,
  deviceTrustMetadata: false,
  crashDiagnostics: false,
}

/** Scriptable consent scope: publishes snapshots, records writes, and settles each write on demand. */
class FakeConsentScope {
  private listeners = new Set<() => void>()
  private gates: Array<(accepted: boolean) => void> = []
  private snapshot: ConfigFormSnapshot<TelemetrySettingsValue>
  /** Every queued write, in order. */
  readonly writes: Array<readonly [field: string, value: unknown]> = []

  constructor(value: TelemetryConsent) {
    this.snapshot = { status: 'ready', value: { consent: value }, base: undefined, user: { consent: value }, revision: 3, writable: true }
  }

  getSnapshot = (): ConfigFormSnapshot<TelemetrySettingsValue> => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Fold one committed write's answer into the held snapshot. */
  commit(field: string, value: unknown): void {
    const current = this.snapshot.value?.consent ?? OFF
    this.publish({
      ...this.snapshot,
      value: { consent: { ...current, [field]: value } },
      revision: (this.snapshot.revision ?? 0) + 1,
    })
  }

  /** A refused write's recovery re-read: the stored value stands under a new revision. */
  refuse(): void {
    this.publish({ ...this.snapshot, revision: (this.snapshot.revision ?? 0) + 1 })
  }

  /** Resolve every in-flight write settlement (commit or refusal first, as the scenario chose). */
  settleWrites(accepted = true): void {
    for (const gate of this.gates.splice(0)) gate(accepted)
  }

  publish(snapshot: ConfigFormSnapshot<TelemetrySettingsValue>): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  set = (field: string, value: unknown): Promise<boolean> => new Promise<boolean>((resolve) => {
    this.writes.push([field, value])
    this.gates.push(resolve)
  })
}

function sectionProps(scope: FakeConsentScope): TelemetrySettingsSectionProps {
  return {
    ...({} as GlobalStandardProps),
    close: () => {},
    t,
    set: scope.set,
    useConsent: bindSnapshotSelector(scope),
  }
}

const switchState = (name: string): { checked: string; disabled: boolean } => {
  const control = screen.getByRole('switch', { name }) as HTMLButtonElement
  return { checked: control.getAttribute('aria-checked') ?? '', disabled: control.disabled }
}

describe('TelemetrySettingsSection', () => {
  it('renders exactly one switch per data kind, each with its name and description', () => {
    const { container } = render(<TelemetrySettingsSection {...sectionProps(new FakeConsentScope(OFF))} />)
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(TELEMETRY_CONSENT_KINDS.length)
    // Every button is one kind's switch: no master control exists anywhere in the section.
    expect(container.querySelectorAll('button')).toHaveLength(TELEMETRY_CONSENT_KINDS.length)
    for (const kind of TELEMETRY_CONSENT_KINDS) {
      const row = container.querySelector(`[data-kind="${kind}"]`) as HTMLElement
      expect(within(row).getByText(en[`kind.${kind}`])).toBeDefined()
      expect(within(row).getByText(en[`desc.${kind}`])).toBeDefined()
    }
  })

  it('writes one kind per gesture without queuing writes for the others', async () => {
    const scope = new FakeConsentScope(OFF)
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    fireEvent.click(screen.getByRole('switch', { name: en['kind.crashDiagnostics'] }))
    await waitFor(() => { expect(scope.writes).toEqual([['crashDiagnostics', true]]) })
    scope.commit('crashDiagnostics', true)
    scope.settleWrites()
    await waitFor(() => { expect(switchState(en['kind.crashDiagnostics']).checked).toBe('true') })
    fireEvent.click(screen.getByRole('switch', { name: en['kind.providerMetadata'] }))
    await waitFor(() => { expect(scope.writes).toEqual([['crashDiagnostics', true], ['providerMetadata', true]]) })
  })

  it('turns a kind off again through its own switch', async () => {
    const scope = new FakeConsentScope({ ...OFF, relayMetadata: true })
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    expect(switchState(en['kind.relayMetadata']).checked).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: en['kind.relayMetadata'] }))
    await waitFor(() => { expect(scope.writes).toEqual([['relayMetadata', false]]) })
    scope.commit('relayMetadata', false)
    scope.settleWrites()
    await waitFor(() => { expect(switchState(en['kind.relayMetadata']).checked).toBe('false') })
  })

  it('locks only the kind whose write is in flight', async () => {
    const scope = new FakeConsentScope(OFF)
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    fireEvent.click(screen.getByRole('switch', { name: en['kind.relayMetadata'] }))
    await waitFor(() => { expect(switchState(en['kind.relayMetadata']).disabled).toBe(true) })
    expect(switchState(en['kind.crashDiagnostics']).disabled).toBe(false)
    scope.commit('relayMetadata', true)
    scope.settleWrites()
    await waitFor(() => { expect(switchState(en['kind.relayMetadata']).disabled).toBe(false) })
  })

  it('keeps the switch on the re-read Host value and reports a write that did not take', async () => {
    const scope = new FakeConsentScope(OFF)
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    fireEvent.click(screen.getByRole('switch', { name: en['kind.sessionTelemetry'] }))
    await waitFor(() => { expect(scope.writes).toEqual([['sessionTelemetry', true]]) })
    scope.refuse()
    scope.settleWrites(false)
    expect((await screen.findByRole('alert')).textContent).toBe(en.writeNotApplied)
    expect(switchState(en['kind.sessionTelemetry']).checked).toBe('false')
    // One row reports its own gesture; the untouched kinds stay notice-free.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('clears a row notice on that kind\'s next gesture', async () => {
    const scope = new FakeConsentScope(OFF)
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    fireEvent.click(screen.getByRole('switch', { name: en['kind.deviceTrustMetadata'] }))
    await waitFor(() => { expect(scope.writes).toHaveLength(1) })
    scope.refuse()
    scope.settleWrites(false)
    expect(await screen.findByRole('alert')).toBeDefined()
    fireEvent.click(screen.getByRole('switch', { name: en['kind.deviceTrustMetadata'] }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    scope.commit('deviceTrustMetadata', true)
    scope.settleWrites()
    await waitFor(() => { expect(switchState(en['kind.deviceTrustMetadata']).checked).toBe('true') })
  })

  it('renders nothing while the namespace is not exposed', () => {
    const scope = new FakeConsentScope(OFF)
    scope.publish({
      status: 'unavailable', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false,
    })
    const { container } = render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    expect(container.textContent).toBe('')
  })

  it('shows the loading line until the first accepted section', () => {
    const scope = new FakeConsentScope(OFF)
    scope.publish({
      status: 'loading', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false,
    })
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    expect(screen.getByText(en.loading)).toBeDefined()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('keeps the stored values and reports a transport failure', async () => {
    const props = sectionProps(new FakeConsentScope(OFF))
    render(<TelemetrySettingsSection {...props} set={() => Promise.reject(new Error('offline'))} />)
    fireEvent.click(screen.getByRole('switch', { name: en['kind.sessionTelemetry'] }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.writeNotApplied)
    expect(switchState(en['kind.sessionTelemetry'])).toEqual({ checked: 'false', disabled: false })
  })

  it('disables every switch with the lock copy while the document is read-only', () => {
    const scope = new FakeConsentScope(OFF)
    scope.publish({ ...scope.getSnapshot(), writable: false })
    render(<TelemetrySettingsSection {...sectionProps(scope)} />)
    for (const kind of TELEMETRY_CONSENT_KINDS) {
      const state = switchState(en[`kind.${kind}`])
      expect(state.disabled).toBe(true)
      expect(screen.getByRole('switch', { name: en[`kind.${kind}`] }).getAttribute('title')).toBe(en.readonlyHint)
    }
  })

  it('keeps a non-empty name and description for every kind in both dictionaries', () => {
    for (const kind of TELEMETRY_CONSENT_KINDS) {
      for (const dict of [en, zh]) {
        expect(dict[`kind.${kind}`].length).toBeGreaterThan(0)
        expect(dict[`desc.${kind}`].length).toBeGreaterThan(0)
      }
    }
  })
})

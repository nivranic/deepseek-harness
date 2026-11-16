// @vitest-environment jsdom
/** Host readiness registration keeps Remote failures visible and withdraws on disposal. */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel, type GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { HealthSnapshot } from '@deepseek-ai/dsh-api-host-diagnostics/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject, type HostStatusSectionInjected, type HostStatusSectionProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

usePinnedBrowserLanguages('en-US')

it('registers the localized section, renders health, and retains a structured Remote refusal', async () => {
  const ctx = new Context()
  onTestFinished(async () => { cleanup(); await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const component = { state: 'up' as const, detail: 'ready' }
  const snapshot: HealthSnapshot = { ready: true, process: component, runtime: component, sessionStore: component,
    pluginState: component, connection: component, modelProvider: component }
  const health = vi.fn<() => Promise<RemoteResult<HealthSnapshot>>>(async () => ({ ok: true, value: snapshot }))
  new TestRemote(ctx, { hostDiagnostics: { health } })
  const slots = ctx.slots
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  const owner = await ctx.plugin({ inject, apply })
  const entry = slots.entries('settings.section')[0]!
  expect(resolveSlotLabel(entry.options.label)).toBe(en.nav)
  const face = entry.inject!() as HostStatusSectionInjected & Record<string, unknown>
  const Section = entry.component as ComponentType<HostStatusSectionProps>
  render(<Section {...({} as GlobalStandardProps)} {...face} t={ctx.locale.bind('settings.hostStatus')} close={() => {}} />)
  expect(await screen.findByText(en.ready)).toBeDefined()
  const failure = new RemoteError('gateway/connection-unavailable', 'offline', { endpoint: 'hostDiagnostics/health' })
  health.mockResolvedValueOnce({ ok: false, error: failure })
  await expect(face.health()).rejects.toBe(failure)
  await owner.dispose()
  expect(slots.entries('settings.section')).toHaveLength(0)
})

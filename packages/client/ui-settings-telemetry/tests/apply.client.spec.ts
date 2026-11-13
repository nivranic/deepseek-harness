/** Consent edits use the backend entry's shared, revision-fenced configuration form. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import type { TelemetrySettingsSectionInjected } from '../src/client/TelemetrySettingsSection.tsx'

it('follows the backend entry, writes only one nested consent field, and retains Host values after refusal', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  let view: SettingsNamespaceView = {
    ns: 'session-telemetry-otel', autoGenerate: true, applies: 'live', secrets: [], revision: 3,
    schema: { type: 'any' },
    value: { mode: 'FEEDBACK_ONLY', consent: { sessionTelemetry: false, crashDiagnostics: true } },
  }
  let namespaces: SettingsNamespaceView[] = []
  const describe = vi.fn(async () => ({ ok: true as const, value: { writable: true, hasDocument: true, namespaces } }))
  let refused = false
  const mutate = vi.fn(async () => refused
    ? { ok: false as const, error: new RemoteError('gateway/connection-unavailable', 'offline', { endpoint: 'settings/mutate' }) }
    : { ok: true as const, value: view })
  const remote = new TestRemote(ctx, { settings: { describe, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  await ctx.configForms.describe().ensure()
  expect(slots.entries('settings.section')).toHaveLength(0)

  namespaces = [view]
  remote.emit('settings/document-updated', [view.ns, view.revision])
  await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  const entry = slots.entries('settings.section')[0]!
  const face = entry.inject!() as TelemetrySettingsSectionInjected & Record<string, unknown>
  expect(face.hooks.consent.getSnapshot()).toMatchObject({ status: 'ready', revision: 3 })
  view = { ...view, revision: 4, value: { mode: 'FEEDBACK_ONLY', consent: { sessionTelemetry: true, crashDiagnostics: true } } }
  await expect(face.set('sessionTelemetry', true)).resolves.toBe(true)
  expect(mutate).toHaveBeenCalledExactlyOnceWith(view.ns, [{ op: 'set', path: ['consent', 'sessionTelemetry'], value: true }], 3)
  expect(face.hooks.consent.getSnapshot().value).toEqual(view.value)

  refused = true
  namespaces = [view]
  await expect(face.set('crashDiagnostics', false)).resolves.toBe(false)
  expect(face.hooks.consent.getSnapshot().value).toEqual(view.value)

  namespaces = []
  remote.emit('settings/document-updated', [view.ns, 5])
  await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(0) })
  namespaces = [view]
  remote.emit('settings/document-updated', [view.ns, 6])
  await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  await fiber.dispose()
  expect(slots.entries('settings.section')).toHaveLength(0)
})

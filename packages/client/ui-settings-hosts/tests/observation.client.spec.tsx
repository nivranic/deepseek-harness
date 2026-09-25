// @vitest-environment jsdom
/** Real Slot subscriptions observe changes made outside the Hosts section. */
import { act, screen, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as connectionApply, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'

usePinnedBrowserLanguages('en-US')

it('rerenders external target and roster changes through framework-bound hooks', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(async () => { await runtime.dispose() })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  await runtime.mount({ inject: [], apply: connectionApply })
  const connection = runtime.ctx.get('connection') as ConnectionHandle
  connection.savedHosts.record({
    hostId: 'observer-host', displayName: 'Observed Host', platform: 'linux',
    origin: 'https://observed.local', lastConnectedAt: 1,
  })
  await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderSlot('settings.section', { close: () => {} })
  await screen.findByText('Observed Host')
  act(() => { connection.retarget('https://observed.local') })
  await waitFor(() => {
    expect(view.container.querySelector('[data-host-id="observer-host"]')?.hasAttribute('data-host-selected')).toBe(true)
  })
  expect(screen.getByText('Selected', { exact: true })).toBeDefined()
  act(() => { connection.savedHosts.remove('observer-host') })
  await waitFor(() => { expect(screen.queryByText('Observed Host')).toBeNull() })
  act(() => { connection.retarget(undefined) })
  expect(screen.getByText('Using the page Host')).toBeDefined()
})

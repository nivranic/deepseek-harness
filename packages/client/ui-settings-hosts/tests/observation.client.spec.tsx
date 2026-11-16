// @vitest-environment jsdom
/** Real Slot hooks observe discovery, local edits, and loss of current identity. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { setup } from './fixture.client.ts'

usePinnedBrowserLanguages('en-US')

it('renders bookmarks and current identity through framework-bound hooks', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(async () => { await runtime.dispose() })
  const fixture = setup(runtime.ctx, runtime.remote)
  runtime.slots.installLocale(fixture.locale)
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  await runtime.mount({ inject, apply })
  const view = runtime.renderSlot('settings.section', { close: () => {} })
  await screen.findByText('Fixture Host')
  expect(screen.getByText('Current Host')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Rename' }), { target: { value: 'My desk' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('My desk')
  fixture.describe.mockRejectedValueOnce(new Error('offline'))
  act(() => { fixture.refresh() })
  await waitFor(() => { expect(screen.queryByText('Current Host')).toBeNull() })
  expect(screen.getByText('My desk')).toBeDefined()
  expect(view.container.querySelector('[data-host-switch]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Forget' }))
  await screen.findByText('No saved Hosts yet')
})

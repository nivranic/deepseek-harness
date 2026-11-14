import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopShellBehavior } from '../src/shell-behavior.ts'
import { DesktopShellPreferences } from '../src/shell-preferences.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-shell-behavior-'))
  roots.push(root)
  const events: string[] = []
  let destroyed = false
  const tray = {
    destroy: vi.fn(() => { events.push('destroy'); destroyed = true }),
    isDestroyed: () => destroyed,
  }
  const effects = {
    createTray: vi.fn(() => { events.push('create'); destroyed = false; return tray }),
    reveal: vi.fn(() => { events.push('reveal') }),
    reportTrayFailure: vi.fn(),
  }
  const preferences = new DesktopShellPreferences(join(root, 'preferences.json'))
  const behavior = new DesktopShellBehavior(preferences, effects)
  const event = { preventDefault: vi.fn(() => { events.push('prevent') }) }
  const window = { hide: vi.fn(() => { events.push('hide') }) }
  return { behavior, preferences, event, window, events, effects, tray }
}

it('preserves normal window closing until the user enables the tray preference', () => {
  const h = harness()
  h.behavior.closeWindow(h.event, h.window)
  expect(h.events).toEqual([])
})

it('creates a restore affordance before cancelling close and hiding a window', async () => {
  const h = harness()
  await h.preferences.setCloseToTray(true)
  h.behavior.closeWindow(h.event, h.window)
  expect(h.events).toEqual(['create', 'prevent', 'hide'])
  await h.behavior.close()
  expect(h.tray.destroy).toHaveBeenCalledOnce()
})

it('does not prevent closing or hide when tray creation fails', async () => {
  const h = harness()
  await h.preferences.setCloseToTray(true)
  const failure = new Error('native tray unavailable')
  h.effects.createTray.mockImplementation(() => { throw failure })
  h.behavior.closeWindow(h.event, h.window)
  expect(h.event.preventDefault).not.toHaveBeenCalled()
  expect(h.window.hide).not.toHaveBeenCalled()
  expect(h.effects.reportTrayFailure).toHaveBeenCalledWith(failure)
})

it('refuses to enable the preference when its tray cannot be created', async () => {
  const h = harness()
  h.effects.createTray.mockImplementation(() => { throw new Error('icon missing') })
  await expect(h.behavior.setCloseToTray(true)).rejects.toThrow('icon missing')
  expect(h.behavior.closeToTray).toBe(false)
})

it('reveals the primary window before removing its tray and stops intercepting closes', async () => {
  const h = harness()
  await h.behavior.setCloseToTray(true)
  h.behavior.closeWindow(h.event, h.window)
  await h.behavior.setCloseToTray(false)
  expect(h.events).toEqual(['create', 'prevent', 'hide', 'reveal', 'destroy'])
  h.event.preventDefault.mockClear()
  h.behavior.closeWindow(h.event, h.window)
  expect(h.event.preventDefault).not.toHaveBeenCalled()
})

it('keeps login hiding independent of the close-button preference', async () => {
  const h = harness()
  expect(h.behavior.hideAtLogin(h.window)).toBe(true)
  expect(h.events).toEqual(['create', 'hide'])
  expect(h.behavior.closeToTray).toBe(false)
  await h.behavior.close()
  h.behavior.closeWindow(h.event, h.window)
  expect(h.event.preventDefault).not.toHaveBeenCalled()
  expect(h.behavior.hideAtLogin(h.window)).toBe(false)
  await expect(h.behavior.setCloseToTray(true)).rejects.toThrow('closing')
})

it('joins a pending preference change on quit without revealing a closing window', async () => {
  const h = harness()
  await h.behavior.setCloseToTray(true)
  const change = h.behavior.setCloseToTray(false)
  const closing = h.behavior.close()
  await Promise.all([change, closing])
  expect(h.preferences.closeToTray).toBe(false)
  expect(h.events).toEqual(['create', 'destroy'])
})

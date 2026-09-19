import type { LoginItemSettings } from 'electron'
import { expect, it, vi } from 'vitest'
import { DesktopLoginItem } from '../src/login-item.ts'

function harness(platform: NodeJS.Platform = 'win32', packaged = true) {
  const state: LoginItemSettings = {
    openAtLogin: false, wasOpenedAtLogin: false, status: 'not-registered',
    executableWillLaunchAtLogin: false, launchItems: [],
  }
  const app = {
    isPackaged: packaged,
    getLoginItemSettings: vi.fn(() => ({ ...state })),
    setLoginItemSettings: vi.fn((next: { openAtLogin?: boolean }) => {
      state.openAtLogin = next.openAtLogin === true
      state.executableWillLaunchAtLogin = state.openAtLogin
      state.status = state.openAtLogin ? 'enabled' : 'not-registered'
    }),
  }
  return { app, state, login: new DesktopLoginItem(app, 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe', platform) }
}

it.each([['win32', false], ['darwin', false], ['linux', true]] as const)(
  'does not read or register login startup for %s packaged=%s', (platform, packaged) => {
    const h = harness(platform, packaged)
    expect(h.login.available).toBe(false)
    expect(h.login.enabled).toBe(false)
    expect(h.login.openedAtLogin).toBe(false)
    expect(() => { h.login.setEnabled(true) }).toThrow('packaged')
    expect(h.app.getLoginItemSettings).not.toHaveBeenCalled()
    expect(h.app.setLoginItemSettings).not.toHaveBeenCalled()
  },
)

it('uses the same executable and argv for Windows registration and its verified read', () => {
  const h = harness()
  h.login.setEnabled(true)
  const target = { path: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe', args: ['--hidden'] }
  expect(h.app.setLoginItemSettings).toHaveBeenCalledWith({ ...target, openAtLogin: true, enabled: true })
  expect(h.app.getLoginItemSettings).toHaveBeenLastCalledWith(target)
  expect(h.login.enabled).toBe(true)
  h.state.executableWillLaunchAtLogin = false
  expect(h.login.enabled).toBe(false)
  h.login.setEnabled(false)
  expect(h.state.openAtLogin).toBe(false)
})

it('reports macOS pending approval without claiming that login startup is enabled', () => {
  const h = harness('darwin')
  h.app.setLoginItemSettings.mockImplementation(() => {
    h.state.openAtLogin = true
    h.state.status = 'requires-approval'
  })
  expect(() => { h.login.setEnabled(true) }).toThrow('did not apply')
  expect(h.login.enabled).toBe(false)
  h.state.wasOpenedAtLogin = true
  expect(h.login.openedAtLogin).toBe(true)
})

it('propagates OS refusal without storing a second login preference', () => {
  const h = harness()
  const failure = new Error('registration denied')
  h.app.setLoginItemSettings.mockImplementation(() => { throw failure })
  expect(() => { h.login.setEnabled(true) }).toThrow(failure)
  expect(h.login.enabled).toBe(false)
})

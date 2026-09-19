/** Generated legacy files exercise import without opening a user's historical Harness home. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { LegacyDesktopSettingsImport, LegacySettingsError } from '../src/legacy-settings.ts'
import { DesktopShellPreferences } from '../src/shell-preferences.ts'
import { DesktopShellBehavior } from '../src/shell-behavior.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(text: string | Buffer, extension = 'yaml') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-legacy-settings-'))
  roots.push(root)
  const source = join(root, `旧设置.${extension}`)
  writeFileSync(source, text)
  return { root, source }
}

it.each([
  ['desktop: {}\n', 'yaml', true, false],
  ['formatVersion: 1\ndesktop:\n  closeAction: quit\n  launchAtLogin: true\n', 'yml', false, true],
  ['{"formatVersion":1,"desktop":{"closeAction":"tray","launchAtLogin":false}}', 'json', true, false],
] as const)('previews legacy defaults and explicit fields in %s', async (text, extension, closeToTray, launchAtLogin) => {
  const { source } = fixture(text, extension)
  const preview = await LegacyDesktopSettingsImport.read(source)
  expect(preview.closeToTray).toBe(closeToTray)
  expect(preview.launchAtLogin).toBe(launchAtLogin)
  expect(readFileSync(source, 'utf8')).toBe(text)
})

it.each([
  ['formatVersion: 2\ndesktop: {}', 'version'],
  ['formatVersion: 0\ndesktop: {}', 'version'],
  ['formatVersion: "1"\ndesktop: {}', 'version'],
  ['desktop: {closeAction: null}', 'invalid'],
  ['desktop: {launchAtLogin: null}', 'invalid'],
  ['desktop: {closeAction: minimize}', 'invalid'],
  ['desktop: {launchAtLogin: "true"}', 'invalid'],
  ['desktop: {closeAction: tray, future: true}', 'invalid'],
  ['desktop: {closeAction: tray, closeAction: quit}', 'invalid'],
  ['desktop: [tray]', 'invalid'],
  ['model: {key: PRIVATE_FIXTURE_VALUE}', 'invalid'],
  ['desktop: !!js/function "PRIVATE_FIXTURE_VALUE"', 'invalid'],
  ['null', 'invalid'],
  ['[]', 'invalid'],
  ['desktop: [PRIVATE_FIXTURE_VALUE', 'invalid'],
] as const)('refuses unsupported input without parser excerpts: %s', async (text, reason) => {
  const { source } = fixture(text)
  await expect(LegacyDesktopSettingsImport.read(source)).rejects.toEqual(new LegacySettingsError(reason))
  expect(readFileSync(source, 'utf8')).toBe(text)
})

it('requires JSON syntax for a .json selection and rejects duplicate JSON keys', async () => {
  for (const text of ['desktop: {}', '{"desktop":{"closeAction":"tray","closeAction":"quit"}}']) {
    const { source } = fixture(text, 'json')
    await expect(LegacyDesktopSettingsImport.read(source)).rejects.toEqual(new LegacySettingsError('invalid'))
  }
})

it('refuses oversized files, invalid UTF-8, unknown extensions, and missing sources', async () => {
  const { source, root } = fixture('desktop: {}\n' + ' '.repeat(1024 * 1024))
  await expect(LegacyDesktopSettingsImport.read(source)).rejects.toEqual(new LegacySettingsError('invalid'))
  writeFileSync(source, Buffer.from([0xff, 0xfe]))
  await expect(LegacyDesktopSettingsImport.read(source)).rejects.toEqual(new LegacySettingsError('invalid'))
  await expect(LegacyDesktopSettingsImport.read(join(root, 'missing.json'))).rejects.toEqual(new LegacySettingsError('unreadable'))
  await expect(LegacyDesktopSettingsImport.read(join(root, 'settings.env'))).rejects.toEqual(new LegacySettingsError('invalid'))
})

it('imports through the real tray and preference owners and retains the complete source bytes', async () => {
  const text = '# legacy file\nformatVersion: 1\ndesktop: {closeAction: tray, launchAtLogin: true}\nmodels: {value: PRIVATE_FIXTURE_VALUE}\n'
  const { source, root } = fixture(text)
  const target = join(root, 'preferences.json')
  const preferences = new DesktopShellPreferences(target)
  const createTray = vi.fn(() => ({ destroy: vi.fn(), isDestroyed: () => false }))
  const shell = new DesktopShellBehavior(preferences, { createTray, reveal: vi.fn(), reportTrayFailure: vi.fn() })
  try {
    const preview = await LegacyDesktopSettingsImport.read(source)
    await preview.apply(shell)
    expect(createTray).toHaveBeenCalledTimes(1)
    expect(new DesktopShellPreferences(target).closeToTray).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ schemaVersion: 1, closeToTray: true })
    expect(readFileSync(source, 'utf8')).toBe(text)
    await shell.setCloseToTray(false)
    expect(new DesktopShellPreferences(target).closeToTray).toBe(false)
  } finally {
    await shell.close()
  }
})

it('refuses a changed source before admitting a preference write', async () => {
  const { source } = fixture('desktop: {closeAction: tray}\n')
  const preview = await LegacyDesktopSettingsImport.read(source)
  writeFileSync(source, 'desktop: {closeAction: quit}\n')
  const shell = { setCloseToTray: vi.fn() }
  await expect(preview.apply(shell)).rejects.toEqual(new LegacySettingsError('changed'))
  expect(shell.setCloseToTray).not.toHaveBeenCalled()
  expect(readFileSync(source, 'utf8')).toBe('desktop: {closeAction: quit}\n')
})

it('keeps a committed preference when the tray cannot be created', async () => {
  const { source, root } = fixture('desktop: {closeAction: tray}\n')
  const target = join(root, 'preferences.json')
  const preferences = new DesktopShellPreferences(target)
  await preferences.setCloseToTray(false)
  const before = readFileSync(target)
  const failure = new Error('tray unavailable')
  const shell = new DesktopShellBehavior(preferences, {
    createTray: () => { throw failure }, reveal: vi.fn(), reportTrayFailure: vi.fn(),
  })
  try {
    await expect((await LegacyDesktopSettingsImport.read(source)).apply(shell)).rejects.toBe(failure)
    expect(readFileSync(target)).toEqual(before)
  } finally {
    await shell.close()
  }
})

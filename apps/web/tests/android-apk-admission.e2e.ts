/** APK admission rejects stale installed artifacts before mutating or launching the acceptance application. */
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, expect, it, vi } from 'vitest'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const native = vi.hoisted(() => ({
  execute: vi.fn<(
    file: string, args: readonly string[], options: { windowsHide: boolean },
  ) => Promise<{ stdout: string; stderr: string }>>(),
  spawn: vi.fn(() => { throw new Error('APK admission must not launch instrumentation') }),
  open: vi.fn<(path: string, flags: string, mode: number) => Promise<{ close: () => Promise<void> }>>(),
  close: vi.fn<() => Promise<void>>(),
  unlink: vi.fn<(path: string) => Promise<void>>(),
  readFile: vi.fn<(path: string) => Promise<Buffer>>(),
}))

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return {
    // Node's execFile custom promisification returns both captured output streams.
    execFile: Object.assign(vi.fn(), { [promisify.custom]: native.execute }),
    spawn: native.spawn,
  }
})
vi.mock('node:fs/promises', () => ({ open: native.open, unlink: native.unlink, readFile: native.readFile }))

const apks = [
  {
    packageName: 'com.deepseek.harness.companion.nativeacceptance',
    buildPath: fileURLToPath(new URL('../../android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url)),
    installedPath: '/data/app/application/base.apk',
    bytes: Buffer.from('current application APK'),
  },
  {
    packageName: 'com.deepseek.harness.companion.nativeacceptance.test',
    buildPath: fileURLToPath(new URL('../../android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk', import.meta.url)),
    installedPath: '/data/app/instrumentation/base.apk',
    bytes: Buffer.from('current instrumentation APK'),
  },
] as const

beforeEach(() => { vi.resetAllMocks() })

it.each([
  { label: 'application', mismatch: 0 },
  { label: 'instrumentation', mismatch: 1 },
])('rejects a mismatched installed $label APK and releases the driver lease', async ({ mismatch }) => {
  const adb = 'fixture-adb'
  const serial = 'emulator-5554'
  const leasePath = join(tmpdir(), `dsh-native-acceptance-${serial}.lock`)
  const leases = new Set<string>()
  let closed = false
  native.close.mockImplementation(async () => { closed = true })
  native.open.mockImplementation(async (path) => {
    if (leases.has(path)) throw new Error('Acceptance lease is already held')
    leases.add(path)
    return { close: native.close }
  })
  native.unlink.mockImplementation(async (path) => {
    expect(closed).toBe(true)
    expect(leases.delete(path)).toBe(true)
  })
  native.readFile.mockImplementation(async (path) => {
    const apk = apks.find(candidate => candidate.buildPath === path)
    if (apk === undefined) throw new Error('Unexpected APK build read')
    return apk.bytes
  })
  native.execute.mockImplementation(async (_file, args) => {
    const command = args.slice(2)
    if (command[0] === 'shell' && command[1] === 'pm' && command[2] === 'path') {
      const apk = apks.find(candidate => candidate.packageName === command[3])
      if (apk !== undefined) return { stdout: `package:${apk.installedPath}\n`, stderr: '' }
    }
    if (command[0] === 'shell' && command[1] === 'sha256sum') {
      const index = apks.findIndex(candidate => candidate.installedPath === command[2])
      const apk = apks[index]
      if (apk !== undefined) {
        const bytes = index === mismatch ? Buffer.from('stale installed APK') : apk.bytes
        return { stdout: `${createHash('sha256').update(bytes).digest('hex')}  ${apk.installedPath}\n`, stderr: '' }
      }
    }
    throw new Error(`Unexpected ADB operation: ${command.join(' ')}`)
  })

  await expect(startAndroidCompanionUiDriver(adb, serial, 44301, true, [44302])).rejects.toThrow(
    `Installed ${apks[mismatch]!.packageName} differs from its current build; install both acceptance APKs before running UI tests`,
  )

  const checked = apks.slice(0, mismatch + 1)
  expect(native.readFile.mock.calls).toEqual(checked.map(apk => [apk.buildPath]))
  expect(native.execute.mock.calls).toEqual(checked.flatMap(apk => [
    [adb, ['-s', serial, 'shell', 'pm', 'path', apk.packageName], { windowsHide: true }],
    [adb, ['-s', serial, 'shell', 'sha256sum', apk.installedPath], { windowsHide: true }],
  ]))
  expect(native.spawn).not.toHaveBeenCalled()
  expect(native.open).toHaveBeenCalledExactlyOnceWith(leasePath, 'wx', 0o600)
  expect(native.close).toHaveBeenCalledTimes(1)
  expect(native.unlink).toHaveBeenCalledExactlyOnceWith(leasePath)
  expect(leases.size).toBe(0)
}, 5_000)

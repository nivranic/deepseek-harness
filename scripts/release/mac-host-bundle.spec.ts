/** Reject wrong native payloads before a candidate can be represented as a Mac Host bundle. */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyMacHostExecutables, macHostTestRunnerEntitlements, verifyMacHostMachO } from './mac-host-bundle.ts'

const modern = 'cmd LC_BUILD_VERSION\nplatform MACOS\nminos 14.0\nsdk 15.5\n'

describe('Mac Host test-runner signing', () => {
  const generated = {
    'com.apple.application-identifier': 'com.deepseek-harness.host.startup-tests.xctrunner',
    'com.apple.security.get-task-allow': true,
    'com.apple.security.app-sandbox': true,
    'com.apple.security.network.client': true,
    'com.apple.security.temporary-exception.mach-lookup.global-name': ['com.apple.testmanagerd'],
  }
  it('changes only the test runner sandbox entitlement and preserves generated XCTest permissions', () => {
    expect(macHostTestRunnerEntitlements(generated)).toEqual({ ...generated, 'com.apple.security.app-sandbox': false })
    expect(generated['com.apple.security.app-sandbox']).toBe(true)
  })
  it.each([
    null, [], 'plist', {},
    { ...generated, 'com.apple.application-identifier': 'com.deepseek-harness.host.mac' },
    { ...generated, 'com.apple.security.get-task-allow': false },
    { ...generated, 'com.apple.security.app-sandbox': 'true' },
  ])('rejects malformed or non-test-target entitlements %j', (value) => {
    expect(() => macHostTestRunnerEntitlements(value)).toThrow()
  })
})

describe('Mac Host native platform', () => {
  it('accepts native and universal macOS inputs including legacy deployment commands', () => {
    expect(() => { verifyMacHostMachO('arm64', 'arm64', modern) }).not.toThrow()
    expect(() => { verifyMacHostMachO('arm64', 'arm64', modern + 'ntools 1\ntool LD\nversion 1230.1\n') }).not.toThrow()
    expect(() => { verifyMacHostMachO('x86_64', 'x86_64 arm64', modern) }).not.toThrow()
    expect(() => { verifyMacHostMachO('arm64', 'arm64', 'cmd LC_VERSION_MIN_MACOSX\nversion 11.0\nsdk 12.0') }).not.toThrow()
  })
  it.each([
    ['x86_64', modern], ['arm64 arm64', modern], ['arm64 i386', modern],
    ['arm64', modern.replace('MACOS', 'IOSSIMULATOR')],
    ['arm64', modern.replace('MACOS', 'IOS')], ['arm64', modern + modern],
    ['arm64', modern.replace('14.0', '14.1')], ['arm64', modern.replace('14.0', '15.0')],
    ['arm64', modern.replace('14.0', '15.0') + 'ntools 1\ntool LD\nversion 13.0\n'],
    ['arm64', modern.replace('14.0', '0.0')], ['arm64', modern.replace('minos 14.0\n', '')],
    ['arm64', modern + 'cmd LC_VERSION_MIN_MACOSX\nversion 11.0\n'],
  ])('rejects incompatible or ambiguous executable metadata %s', (slices, build) => {
    expect(() => { verifyMacHostMachO('arm64', slices, build) }).toThrow()
  })
})

describe('Mac Host executable assembly', () => {
  it.skipIf(process.platform === 'win32')('preserves executable bytes and refuses stale outputs, empty files, and directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mac-host-copy-'))
    try {
      // Separate payloads from their destination on case-insensitive macOS volumes.
      const inputDirectory = join(root, 'inputs')
      await mkdir(inputDirectory)
      const inputs = await Promise.all(['runtime', 'rg', 'spawn-helper', 'HostRuntimeSupervisor'].map(async (name) => {
        const path = join(inputDirectory, name)
        await writeFile(path, name, { mode: 0o755 })
        return path
      }))
      const output = join(root, 'Runtime')
      expect(await copyMacHostExecutables(output, inputs)).toHaveLength(4)
      expect(await readFile(join(output, 'rg'), 'utf8')).toBe('rg')
      await expect(copyMacHostExecutables(output, inputs)).rejects.toThrow()
      await expect(copyMacHostExecutables(join(root, 'duplicate'), [inputs[0]!, inputs[0]!, ...inputs.slice(2)])).rejects.toThrow('distinct')
      await chmod(inputs[0]!, 0o644)
      await expect(copyMacHostExecutables(join(root, 'not-executable'), inputs)).rejects.toThrow('regular file')
      await chmod(inputs[0]!, 0o755)
      await writeFile(inputs[0]!, '')
      await expect(copyMacHostExecutables(join(root, 'empty'), inputs)).rejects.toThrow('regular file')
      await writeFile(inputs[0]!, 'runtime')
      await mkdir(join(root, 'directory'))
      await expect(copyMacHostExecutables(join(root, 'directory-output'), [join(root, 'directory'), ...inputs.slice(1)])).rejects.toThrow('regular file')
      await symlink(inputs[0]!, join(root, 'link'))
      await expect(copyMacHostExecutables(join(root, 'symlink-output'), [join(root, 'link'), ...inputs.slice(1)])).rejects.toThrow('regular file')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

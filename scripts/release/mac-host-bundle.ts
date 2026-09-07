/** Validate and copy native executables into an empty Direct Host resource directory. */
import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { hashRcOutput } from './rc-output.ts'

/**
 * Preserve XCTest permissions while allowing its independent native process observer to execute.
 * @param value - Xcode's generated test-runner entitlements decoded by plutil.
 * @returns Entitlements for the test runner and its XCTest bundle only.
 */
export function macHostTestRunnerEntitlements(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mac Host test-runner entitlements must be a dictionary')
  }
  const fields = value as Record<string, unknown>
  if (fields['com.apple.application-identifier'] !== 'com.deepseek-harness.host.startup-tests.xctrunner'
    || fields['com.apple.security.get-task-allow'] !== true
    || typeof fields['com.apple.security.app-sandbox'] !== 'boolean') {
    throw new Error('Mac Host observer signing requires the generated XCTest runner entitlements')
  }
  return { ...fields, 'com.apple.security.app-sandbox': false }
}

/**
 * Require a macOS executable slice for the selected native candidate architecture.
 * @param architecture - Xcode/lipo CPU spelling selected by the native producer.
 * @param slices - lipo -archs output from the actual executable.
 * @param build - vtool -show-build output for that architecture.
 */
export function verifyMacHostMachO(architecture: 'arm64' | 'x86_64', slices: string, build: string): void {
  const actual = slices.trim().split(/\s+/)
  if (!actual.includes(architecture) || new Set(actual).size !== actual.length
    || actual.some(slice => slice !== 'arm64' && slice !== 'x86_64')) {
    throw new Error('Mac Host executable does not contain the required architecture')
  }
  const platforms = [...build.matchAll(/^\s*platform\s+(\S+)\s*$/gm)].map(match => match[1])
  const legacy = [...build.matchAll(/^\s*cmd\s+LC_VERSION_MIN_MACOSX\s*$/gm)]
  const modern = [...build.matchAll(/^\s*cmd\s+LC_BUILD_VERSION\s*$/gm)]
  if (!((platforms.length === 1 && platforms[0] === 'MACOS' && modern.length === 1 && legacy.length === 0)
    || (platforms.length === 0 && modern.length === 0 && legacy.length === 1))) {
    throw new Error('Mac Host executable must declare exactly one macOS platform')
  }
  // LC_BUILD_VERSION also reports each build tool's version after its minimum OS field.
  const versionField = modern.length === 1
    ? /^\s*minos\s+(\d+(?:\.\d+){0,2})\s*$/gm
    : /^\s*version\s+(\d+(?:\.\d+){0,2})\s*$/gm
  const versions = [...build.matchAll(versionField)]
  if (versions.length !== 1) throw new Error('Mac Host executable must declare one minimum OS version')
  const version = versions[0]?.[1]?.split('.').map(Number) ?? []
  if ((version[0] ?? 0) < 1 || (version[0] ?? 0) > 14
    || (version[0] === 14 && version.slice(1).some(part => part !== 0))) {
    throw new Error('Mac Host executable requires a newer OS than macOS 14.0')
  }
}

/**
 * Copy the producer's native inputs without overwriting an existing bundle or following source symlinks.
 * @param destination - new Runtime directory inside the producer-owned app.
 * @param inputs - explicit executable paths already inspected by the native binary tools.
 * @returns packaged executable bytes and SHA256 digests, verified against the source bytes.
 */
export async function copyMacHostExecutables(
  destination: string, inputs: readonly string[],
): Promise<{ path: string; bytes: number; sha256: string }[]> {
  const names = inputs.map(path => basename(path))
  if (inputs.length !== 4 || new Set(names).size !== inputs.length) throw new Error('Mac Host requires four distinct executables')
  for (const path of inputs) {
    const item = await lstat(path)
    if (!item.isFile() || item.size === 0 || (item.mode & 0o111) === 0) {
      throw new Error('Mac Host executable input must be a nonempty executable regular file')
    }
  }
  await mkdir(destination, { recursive: false })
  const files: { path: string; bytes: number; sha256: string }[] = []
  for (const path of inputs) {
    const before = await hashRcOutput(path)
    const target = join(destination, basename(path))
    await copyFile(path, target, constants.COPYFILE_EXCL)
    await chmod(target, 0o755)
    const after = await hashRcOutput(target)
    if (before.bytes !== after.bytes || before.sha256 !== after.sha256) throw new Error('Mac Host executable copy changed bytes')
    files.push({ path: basename(path), ...after })
  }
  return files
}

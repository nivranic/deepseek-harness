/** Build and exercise one ad-hoc Mac Host candidate from its exact clean source checkout. */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { appleArchiveSettings } from './release/apple-archive.ts'
import { inventoryAppleArchive } from './release/apple-archive-files.ts'
import { verifyAppleProduct } from './release/apple-product.ts'
import { captureCiSource } from './release/ci-source.ts'
import { copyMacHostExecutables, macHostTestRunnerEntitlements, verifyMacHostMachO } from './release/mac-host-bundle.ts'
import { parseMacSupportScannerIdentity, verifyMacSupportScannerFiles } from './release/mac-support-scanner.ts'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'
import { hashRcOutput, writeRcOutput } from './release/rc-output.ts'

const execute = promisify(execFile)
const repository = process.cwd()
const workflow = '.github/workflows/mac-host-candidate.yml'
const [option, directory, ...extra] = process.argv.slice(2)
if (option !== '--output' || directory === undefined || extra.length !== 0) {
  throw new Error('usage: produce-mac-host.ts --output <new-directory>')
}
if (process.platform !== 'darwin' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Mac Host application acceptance requires an ephemeral hosted macOS runner')
}
if (process.arch !== 'arm64' && process.arch !== 'x64') throw new Error('unsupported Mac Host architecture')
const sourceSha = process.env.DSH_RC_SOURCE_SHA
if (sourceSha === undefined || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('an immutable DSH_RC_SOURCE_SHA is required')
const environment = { ...process.env, DSH_CI_CANDIDATE_SHA: sourceSha }
const source = captureCiSource(repository, workflow, environment)
if (source.checkoutSha !== sourceSha || source.dirty) throw new Error('Mac Host producer requires the exact clean candidate checkout')
const identity = readProductIdentity(repository)
if (staleProductIdentityFiles(repository, identity).length !== 0) throw new Error('generated product identity is stale')
const output = resolve(directory)
await mkdir(output, { recursive: false })

async function command(file: string, args: string[], cwd = repository, log?: string): Promise<string> {
  try {
    const result = await execute(file, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, DSH_BUILD_CLIENT_PROFILE: 'official', DSH_TELEMETRY_DISABLED: '1' } })
    if (log !== undefined) await writeFile(join(output, log), result.stdout + result.stderr, { flag: 'wx' })
    return result.stdout.trim()
  } catch (error) {
    if (log !== undefined && error instanceof Error && 'stdout' in error && 'stderr' in error) {
      await writeFile(join(output, log), String(error.stdout) + String(error.stderr), { flag: 'wx' })
    }
    // Build commands contain no credentials; application smoke owns payload-free failure diagnostics.
    throw error
  }
}

await writeRcOutput(output, 'source.json', source)
await writeRcOutput(output, 'toolchain.json', {
  xcode: await command('/usr/bin/xcodebuild', ['-version']),
  swift: await command('/usr/bin/xcrun', ['swift', '--version']),
  xcodegen: await command('xcodegen', ['--version']), node: process.version,
})
await command('pnpm', ['exec', 'tsx', 'scripts/build-exe-for-python-sdk.ts', `--targets=node24-macos-${process.arch}`], repository, 'runtime-build.log')
const apple = join(repository, 'apps/apple')
const scratch = join(output, 'swift')
await command('/usr/bin/xcrun', ['swift', 'build', '--package-path', apple, '--scratch-path', scratch,
  '-c', 'release', '--product', 'HostRuntimeSupervisor'], repository, 'helper-build.log')
const swiftBin = await command('/usr/bin/xcrun', ['swift', 'build', '--package-path', apple,
  '--scratch-path', scratch, '-c', 'release', '--show-bin-path'])
await command('xcodegen', ['generate'], apple)
const derived = join(output, 'derived')
const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64'
const options = ['-project', 'Companion.xcodeproj', '-scheme', 'DirectHostMac', '-configuration', 'Release',
  '-destination', 'platform=macOS', '-derivedDataPath', derived, `ARCHS=${architecture}`, 'ONLY_ACTIVE_ARCH=YES',
  'CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_STYLE=Manual']
const settings = appleArchiveSettings(JSON.parse(await command('/usr/bin/xcodebuild', [
  ...options, '-showBuildSettings', '-json',
], apple)) as unknown, 'DirectHostMac')
await command('/usr/bin/xcodebuild', [...options, 'build-for-testing'], apple, 'app-build.log')
const testRunner = join(derived, 'Build/Products/Release/DirectHostStartupUITests-Runner.app')
const generatedEntitlements = join(derived, 'Build/Intermediates.noindex/Companion.build/Release',
  'DirectHostStartupUITests.build/DirectHostStartupUITests.xctest.xcent')
const observerEntitlements = macHostTestRunnerEntitlements(JSON.parse(await command('/usr/bin/plutil', [
  '-convert', 'json', '-o', '-', generatedEntitlements,
])) as unknown)
const observerPlist = join(output, 'test-runner-entitlements.plist')
await writeFile(observerPlist, JSON.stringify(observerEntitlements), { flag: 'wx' })
await command('/usr/bin/plutil', ['-convert', 'xml1', observerPlist])
for (const target of [join(testRunner, 'Contents/PlugIns/DirectHostStartupUITests.xctest'), testRunner]) {
  await command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--entitlements', observerPlist, target])
}
await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', testRunner])
await command('/usr/bin/codesign', [
  '--display', '--entitlements', '-', testRunner,
], apple, 'test-runner-signing.log')
const app = join(derived, 'Build/Products/Release/DSH Host.app')
const executable = join(app, 'Contents/MacOS/DSH Host')
const plist: unknown = JSON.parse(await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]))
verifyAppleProduct(identity, settings, plist)
if (plist === null || typeof plist !== 'object' || !('CFBundleIdentifier' in plist)
  || plist.CFBundleIdentifier !== 'com.deepseek-harness.host.mac') throw new Error('Mac Host bundle identifier differs from its target')
const runtime = join(repository, 'dist-exe', `deepseek-harness-sdk-runtime-macos-${process.arch}`)
const inputs = [runtime, `${runtime}-rg`, `${runtime}-spawn-helper`, join(swiftBin, 'HostRuntimeSupervisor')]
const inspections = await Promise.all([executable, ...inputs].map(async (file) => {
  const slices = await command('/usr/bin/lipo', ['-archs', file])
  const build = await command('/usr/bin/xcrun', ['vtool', '-show-build', '-arch', architecture, file])
  // Keep native build fields without source paths, command arguments or runtime output.
  const fields = build.split(/\r?\n/).filter(line => /^\s*(cmd|cmdsize|platform|minos|sdk|ntools|tool|version)\s+/.test(line)).join('\n')
  return { name: basename(file), slices, build: fields }
}))
await writeRcOutput(output, 'binary-inspections.json', { sourceSha, architecture, binaries: inspections })
for (const { slices, build } of inspections) {
  verifyMacHostMachO(architecture, slices, build)
}
const resources = join(app, 'Contents/Resources/Runtime')
await mkdir(join(app, 'Contents/Resources'), { recursive: true })
const files = await copyMacHostExecutables(resources, inputs)
await writeRcOutput(output, 'runtime-inputs.json', { sourceSha, architecture, files })
const bundledRuntime = join(resources, `deepseek-harness-sdk-runtime-macos-${process.arch}`)
if (await command(bundledRuntime, ['--version'], output) !== identity.version) {
  throw new Error('bundled dsh version differs from the Mac Host product identity')
}
for (const file of files) {
  await command('/usr/bin/codesign', ['--verify', '--strict', join(resources, file.path)])
}
const supportResources = join(app, 'Contents/Resources/SupportScanner')
const scanner = parseMacSupportScannerIdentity(JSON.parse(await command('python3', [
  'scripts/stage-support-scanner.py', '--output', supportResources,
])) as unknown)
await verifyMacSupportScannerFiles(supportResources, scanner)
const scannerExecutable = join(supportResources, 'gitleaks')
verifyMacHostMachO(architecture, await command('/usr/bin/lipo', ['-archs', scannerExecutable]),
  await command('/usr/bin/xcrun', ['vtool', '-show-build', '-arch', architecture, scannerExecutable]))
await command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', scannerExecutable])
await command('/usr/bin/codesign', ['--verify', '--strict', scannerExecutable])
const signedScanner = { ...scanner, binarySha256: (await hashRcOutput(scannerExecutable)).sha256 }
await writeFile(join(supportResources, 'scanner.json'), `${JSON.stringify(signedScanner, null, 2)}\n`)
await writeRcOutput(output, 'support-scanner.json', { sourceSha, ...signedScanner })
// The SEA builder owns its JIT signature. Seal only the assembled app; never recursively replace nested entitlements.
await command('/usr/bin/codesign', ['--force', '--sign', '-', app])
await command('/usr/bin/codesign', ['--verify', '--strict', '--deep', app])
await command('python3', [join(repository, 'scripts/smoke-packaged-web.py'), '--exe',
  bundledRuntime], output, 'packaged-web.log')
const before = await inventoryAppleArchive(app)
await writeRcOutput(output, 'native-test-start.json', { epochSeconds: Date.now() / 1000 })
await command('/usr/bin/xcodebuild', [...options, '-resultBundlePath', join(output, 'HostStartup.xcresult'),
  'test-without-building'], apple, 'app-test.log')
const supportAttachments = join(output, 'support-attachments')
await command('/usr/bin/xcrun', ['xcresulttool', 'export', 'attachments', '--path', join(output, 'HostStartup.xcresult'),
  '--output-path', supportAttachments])
await command('python3', ['scripts/verify-support-exports.py', '--attachments', supportAttachments,
  '--scanner-directory', supportResources, '--approved', join(output, 'approved-support'),
  '--output', join(output, 'support-exports.json')])
if (JSON.stringify(await inventoryAppleArchive(app)) !== JSON.stringify(before)) throw new Error('Mac Host application bytes changed during acceptance')
const zip = join(output, 'DSH-Host.app.zip')
await command('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
const recheck = join(output, 'recheck')
await mkdir(recheck)
await command('/usr/bin/ditto', ['-x', '-k', zip, recheck])
if (JSON.stringify(await inventoryAppleArchive(join(recheck, 'DSH Host.app'))) !== JSON.stringify(before)) {
  throw new Error('Mac Host ZIP round trip changed packaged files or permissions')
}
await writeRcOutput(output, 'inventory.json', { sourceSha, files: before })
const finalSource = captureCiSource(repository, workflow, environment)
if (finalSource.dirty || finalSource.checkoutSha !== source.checkoutSha || finalSource.treeSha !== source.treeSha
  || finalSource.workflowSha256 !== source.workflowSha256) throw new Error('source checkout changed during Mac Host production')
const producers = [workflow, 'scripts/produce-mac-host.ts', 'scripts/release/mac-host-bundle.ts',
  'scripts/release/mac-support-scanner.ts', 'scripts/stage-support-scanner.py', 'scripts/release/support_scanner.py',
  'scripts/verify-support-exports.py', 'scripts/release/support_exports.py',
  'scripts/release/secret_scan.py', '.github/security/scanners.json',
  'scripts/release/mac_host_crash.py',
  'scripts/release/apple-archive-files.ts', 'scripts/release/apple-product.ts', 'scripts/release/apple-archive.ts',
  'scripts/release/ci-source.ts', 'scripts/release/ci-evidence.ts', 'scripts/release/rc-output.ts',
  'scripts/release/product-files.ts', 'scripts/release/product-identity.ts', 'scripts/build-exe-for-python-sdk.ts',
  'scripts/build-exe-for-python-sdk-native-pty.ts', 'scripts/smoke-packaged-web.py', 'pnpm-lock.yaml']
await writeRcOutput(output, 'bundle.json', {
  schemaVersion: 1, kind: 'mac-host-candidate', sourceSha, identity, architecture, runtimeClass: 'full',
  status: 'BUNDLE_AND_STARTUP_VERIFIED',
  archive: { path: 'DSH-Host.app.zip', ...await hashRcOutput(zip) },
  evidence: await Promise.all([
    'source.json', 'toolchain.json', 'binary-inspections.json', 'runtime-inputs.json', 'inventory.json',
    'support-scanner.json',
    'support-exports.json',
    'packaged-web.log', 'app-test.log', 'test-runner-signing.log',
  ].map(async path => ({ path, ...await hashRcOutput(join(output, path)) }))),
  producers: await Promise.all(producers.map(async path => ({ path, ...await hashRcOutput(join(repository, path)) }))),
  signing: { kind: 'ad-hoc', developerId: 'NOT_EXECUTED', notarization: 'NOT_EXECUTED' },
  noOrphan: { status: 'INCOMPLETE', reason: 'Detached tools, PTY sessions and abrupt helper death require external ownership.' },
  completeRc: false,
})
console.log('Mac Host: candidate bytes, architecture, product identity, packaged Web, native UI and ZIP round trip PASS')

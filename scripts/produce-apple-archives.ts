/** Build unprovisioned Companion archives at one clean candidate SHA; no install, export or submission. */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { APPLE_ARCHIVE_TARGETS, appleArchiveSettings, readAppleArchiveProperties, verifyAppleArchive } from './release/apple-archive.ts'
import { inventoryAppleArchive } from './release/apple-archive-files.ts'
import { captureCiSource } from './release/ci-source.ts'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'
import { hashRcOutput } from './release/rc-output.ts'

const execute = promisify(execFile)
const repository = process.cwd()
const [option, outputArg, ...extra] = process.argv.slice(2)
if (option !== '--output' || outputArg === undefined || extra.length !== 0) {
  throw new Error('usage: produce-apple-archives.ts --output <new-directory>')
}
if (process.platform !== 'darwin') throw new Error('Apple archives require macOS and Xcode')
const sourceSha = process.env.DSH_RC_SOURCE_SHA
if (sourceSha === undefined || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('an immutable DSH_RC_SOURCE_SHA is required')
const source = captureCiSource(repository, '.github/workflows/apple-archives.yml', {
  ...process.env, DSH_CI_CANDIDATE_SHA: sourceSha,
})
if (source.checkoutSha !== sourceSha || source.dirty) throw new Error('Apple archive producer requires the exact clean candidate checkout')
const identity = readProductIdentity(repository)
if (staleProductIdentityFiles(repository, identity).length !== 0) throw new Error('generated product identity is stale')
const output = resolve(outputArg)
await mkdir(output, { recursive: false })

async function jsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
}

async function command(file: string, args: string[], cwd = repository): Promise<string> {
  const result = await execute(file, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return result.stdout.trim()
}

await jsonFile(join(output, 'source.json'), source)
await jsonFile(join(output, 'toolchain.json'), {
  xcode: await command('/usr/bin/xcodebuild', ['-version']),
  swift: await command('/usr/bin/xcrun', ['swift', '--version']),
  xcodegen: await command('xcodegen', ['--version']), node: process.version,
})
const appleRoot = join(repository, 'apps/apple')
await command('xcodegen', ['generate'], appleRoot)
const artifacts: Record<string, unknown>[] = []
for (const target of APPLE_ARCHIVE_TARGETS) {
  const targetRoot = join(output, target.platform)
  await mkdir(targetRoot)
  const archiveName = `${target.scheme}.xcarchive`
  const archivePath = join(targetRoot, archiveName)
  const options = [
    '-project', 'Companion.xcodeproj', '-scheme', target.scheme, '-configuration', 'Release',
    '-destination', target.destination, '-derivedDataPath', join(targetRoot, 'derived'),
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'ONLY_ACTIVE_ARCH=NO',
    `ARCHS=${target.architectures.join(' ')}`,
  ]
  const settings = appleArchiveSettings(JSON.parse(await command('/usr/bin/xcodebuild', [
    ...options, '-showBuildSettings', '-json',
  ], appleRoot)) as unknown, target.scheme)
  try {
    const result = await execute('/usr/bin/xcodebuild', [
      ...options, '-archivePath', archivePath, '-resultBundlePath', join(targetRoot, 'Archive.xcresult'), 'archive',
    ], { cwd: appleRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    await writeFile(join(targetRoot, 'build.log'), result.stdout + result.stderr, { flag: 'wx' })
  } catch (error) {
    // execFile attaches captured process output to build failures; retain it for the hosted diagnostic artifact.
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      await writeFile(join(targetRoot, 'build.log'), String(error.stdout) + String(error.stderr), { flag: 'wx' })
    }
    throw error
  }
  const appRoot = join(archivePath, 'Products/Applications/DSH Companion.app')
  const plistPath = target.platform === 'macos' ? join(appRoot, 'Contents/Info.plist') : join(appRoot, 'Info.plist')
  const appPlist: unknown = JSON.parse(await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath]))
  const archivePlist = await readAppleArchiveProperties(join(archivePath, 'Info.plist'))
  // The executable path is fixed by the target policy before reading untrusted plist fields.
  const executable = target.platform === 'macos' ? join(appRoot, 'Contents/MacOS/DSH Companion') : join(appRoot, 'DSH Companion')
  const architectures = (await command('/usr/bin/lipo', ['-archs', executable])).split(/\s+/)
  const binaryPlatforms: string[] = []
  for (const architecture of architectures) {
    const loadCommands = await command('/usr/bin/xcrun', ['vtool', '-show-build', '-arch', architecture, executable])
    const platforms = [...loadCommands.matchAll(/^\s*platform\s+(\S+)\s*$/gm)].map(match => match[1])
    const [platform] = platforms
    if (platforms.length !== 1 || platform === undefined) throw new Error('expected one LC_BUILD_VERSION platform per executable slice')
    binaryPlatforms.push(platform)
  }
  verifyAppleArchive(identity, target, { settings, appPlist, archivePlist, architectures, binaryPlatforms })
  const files = await inventoryAppleArchive(archivePath)
  const inventoryPath = join(targetRoot, 'inventory.json')
  await jsonFile(inventoryPath, { schemaVersion: 1, sourceSha, archive: archiveName, files })
  const zipPath = join(targetRoot, `${archiveName}.zip`)
  await command('/usr/bin/ditto', ['-c', '-k', '--keepParent', archivePath, zipPath])
  const extractedRoot = join(targetRoot, 'recheck')
  await mkdir(extractedRoot)
  await command('/usr/bin/ditto', ['-x', '-k', zipPath, extractedRoot])
  const extractedInventory = await inventoryAppleArchive(join(extractedRoot, archiveName))
  if (JSON.stringify(extractedInventory) !== JSON.stringify(files)) throw new Error('archive ZIP round trip changes packaged files or permissions')
  artifacts.push({
    platform: target.platform, runtimeClass: 'companion', scheme: target.scheme,
    bundleId: target.bundleId, architectures, binaryPlatforms,
    path: `${target.platform}/${archiveName}.zip`, ...await hashRcOutput(zipPath),
    inventory: { path: `${target.platform}/inventory.json`, ...await hashRcOutput(inventoryPath) },
    executable: await hashRcOutput(executable),
  })
  console.log(`${target.scheme}: archive identity, executable platform and ZIP round trip PASS`)
}
const producerPaths = ['scripts/produce-apple-archives.ts', 'scripts/release/apple-archive.ts', 'scripts/release/apple-archive-files.ts',
  'scripts/release/apple-product.ts', 'scripts/release/product-files.ts', 'scripts/release/product-identity.ts',
  'scripts/release/ci-source.ts', 'scripts/release/ci-evidence.ts', 'scripts/release/rc-output.ts',
  'scripts/release/rc-manifest.ts', '.github/workflows/apple-archives.yml', 'pnpm-lock.yaml']
const finalSource = captureCiSource(repository, '.github/workflows/apple-archives.yml', {
  ...process.env, DSH_CI_CANDIDATE_SHA: sourceSha,
})
if (finalSource.dirty || finalSource.checkoutSha !== source.checkoutSha || finalSource.treeSha !== source.treeSha
  || finalSource.workflowSha256 !== source.workflowSha256) throw new Error('source checkout changed during archive production')
await jsonFile(join(output, 'archives.json'), {
  schemaVersion: 1, kind: 'apple-companion-archives', status: 'ARCHIVES_VERIFIED', sourceSha, identity,
  source: { path: 'source.json', ...await hashRcOutput(join(output, 'source.json')) },
  toolchain: { path: 'toolchain.json', ...await hashRcOutput(join(output, 'toolchain.json')) },
  producers: await Promise.all(producerPaths.map(async path => ({ path, ...await hashRcOutput(join(repository, path)) }))),
  artifacts, signing: { requested: false, provisioning: 'absent', distributionExport: 'NOT_EXECUTED' },
  startup: { status: 'NOT_EXECUTED', reason: 'Archive verification does not run an application; simulator builds are different binaries.' },
  fullRuntime: { status: 'NOT_PRODUCED', reason: 'DirectHostMac has no embedded runtime producer.' },
  completeRc: false,
})

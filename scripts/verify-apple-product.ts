/** Verify the tested iOS installation and built Mac applications, retaining payload-free identity receipts. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { appleApplicationSourceSettings, verifyAppleApplicationSource, verifyAppleProduct } from './release/apple-product.ts'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'
import { hashRcOutput } from './release/rc-output.ts'

const root = process.cwd()
const source = {
  checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  treeSha: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
}
const [output, simulator, ...extra] = process.argv.slice(2)
if (output === undefined || simulator === undefined || extra.length !== 0
  || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(simulator)) {
  throw new Error('usage: verify-apple-product.ts <receipt.json> <test-simulator-uuid>')
}
const iosBundleId = 'com.deepseek-harness.companion.ios'
const installedIosApp = execFileSync('xcrun', ['simctl', 'get_app_container', simulator, iosBundleId, 'app'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
}).trim()
if (!isAbsolute(installedIosApp) || !installedIosApp.endsWith('.app')) throw new Error('test simulator did not return an installed application')
const identity = readProductIdentity(root)
if (staleProductIdentityFiles(root, identity).length !== 0) throw new Error('generated product identity is stale')
const schemes = [
  { scheme: 'CompanioniOS', destination: 'generic/platform=iOS Simulator' },
  { scheme: 'CompanionMac', destination: 'platform=macOS' },
  { scheme: 'DirectHostMac', destination: 'platform=macOS' },
]
const scannerChecks: Record<string, unknown>[] = []
for (const { scheme, destination } of schemes) {
  const json: unknown = JSON.parse(execFileSync('xcodebuild', [
    '-project', 'Companion.xcodeproj', '-scheme', scheme, '-configuration', 'Debug',
    '-destination', destination, '-showBuildSettings', '-json',
    ...appleApplicationSourceSettings(source),
  ], { cwd: join(root, 'apps/apple'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
  if (!Array.isArray(json)) throw new Error('xcodebuild settings must be an array')
  const targets = json.filter((row: unknown): row is { target: string; buildSettings: Record<string, unknown> } => {
    return row !== null && typeof row === 'object' && 'target' in row && row.target === scheme
      && 'buildSettings' in row && row.buildSettings !== null && typeof row.buildSettings === 'object'
  })
  const [target] = targets
  if (targets.length !== 1 || target === undefined) throw new Error(`expected one application target for ${scheme}`)
  const settings = target.buildSettings
  const { TARGET_BUILD_DIR, INFOPLIST_PATH } = settings
  if (typeof TARGET_BUILD_DIR !== 'string' || typeof INFOPLIST_PATH !== 'string') throw new Error(`missing built plist path for ${scheme}`)
  const plistPath = scheme === 'CompanioniOS' ? join(installedIosApp, 'Info.plist') : join(TARGET_BUILD_DIR, INFOPLIST_PATH)
  const plist: unknown = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' }))
  verifyAppleProduct(identity, settings, plist)
  verifyAppleApplicationSource(source, settings, plist)
  if (scheme !== 'DirectHostMac') {
    if (settings.FULL_PRODUCT_NAME !== 'DSH Companion.app') throw new Error('unexpected Companion application name')
    const directory = join(dirname(resolve(output)), `${scheme}-scanner`)
    execFileSync('python3', ['-B', 'scripts/verify-apple-app-scanner.py',
      '--app', scheme === 'CompanioniOS' ? installedIosApp : join(TARGET_BUILD_DIR, settings.FULL_PRODUCT_NAME),
      '--platform', scheme === 'CompanioniOS' ? 'ios' : 'macos',
      '--stage', join(root, 'apps/apple/.support-scanner'), '--output', directory,
    ], { cwd: root, stdio: 'inherit' })
    scannerChecks.push({ scheme, path: `${scheme}-scanner/verification.json`, ...await hashRcOutput(join(directory, 'verification.json')) })
  }
  console.log(`Apple product identity: ${scheme} PASS`)
}
mkdirSync(dirname(resolve(output)), { recursive: true })
writeFileSync(output, `${JSON.stringify({
  schemaVersion: 1, status: 'PASS', sourceSha: source.checkoutSha, treeSha: source.treeSha,
  identity, configuration: 'Debug', schemes: schemes.map(row => row.scheme), scannerChecks,
  iosApplication: { origin: 'test-simulator-installation', bundleId: iosBundleId },
}, null, 2)}\n`)

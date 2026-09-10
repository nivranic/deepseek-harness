/** Verify the three built Apple applications and retain a payload-free identity receipt on macOS. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { verifyAppleProduct } from './release/apple-product.ts'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'
import { hashRcOutput } from './release/rc-output.ts'

const root = process.cwd()
const output = process.argv[2]
if (output === undefined) throw new Error('usage: verify-apple-product.ts <receipt.json>')
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
  const plist: unknown = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(TARGET_BUILD_DIR, INFOPLIST_PATH)], { encoding: 'utf8' }))
  verifyAppleProduct(identity, settings, plist)
  if (scheme !== 'DirectHostMac') {
    if (settings.FULL_PRODUCT_NAME !== 'DSH Companion.app') throw new Error('unexpected Companion application name')
    const directory = join(dirname(resolve(output)), `${scheme}-scanner`)
    execFileSync('python3', ['-B', 'scripts/verify-apple-app-scanner.py',
      '--app', join(TARGET_BUILD_DIR, settings.FULL_PRODUCT_NAME), '--platform', scheme === 'CompanioniOS' ? 'ios' : 'macos',
      '--stage', join(root, 'apps/apple/.support-scanner'), '--output', directory,
    ], { cwd: root, stdio: 'inherit' })
    scannerChecks.push({ scheme, path: `${scheme}-scanner/verification.json`, ...await hashRcOutput(join(directory, 'verification.json')) })
  }
  console.log(`Apple product identity: ${scheme} PASS`)
}
mkdirSync(dirname(resolve(output)), { recursive: true })
writeFileSync(output, `${JSON.stringify({
  schemaVersion: 1, status: 'PASS', sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  identity, configuration: 'Debug', schemes: schemes.map(row => row.scheme), scannerChecks,
}, null, 2)}\n`)

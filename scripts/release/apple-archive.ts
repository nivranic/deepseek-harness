/** Validate device and desktop Companion archive metadata independently of simulator builds. */
import { verifyAppleProduct } from './apple-product.ts'
import type { ProductIdentity } from './product-identity.ts'

/** Fixed Companion archive targets; the Direct Host requires a separate embedded runtime producer. */
export const APPLE_ARCHIVE_TARGETS = [
  {
    scheme: 'CompanioniOS', platform: 'ios', destination: 'generic/platform=iOS',
    platformName: 'iphoneos', supportedPlatform: 'iPhoneOS', binaryPlatform: 'IOS',
    bundleId: 'com.deepseek-harness.companion.ios', architectures: ['arm64'],
  },
  {
    scheme: 'CompanionMac', platform: 'macos', destination: 'generic/platform=macOS',
    platformName: 'macosx', supportedPlatform: 'MacOSX', binaryPlatform: 'MACOS',
    bundleId: 'com.deepseek-harness.companion.mac', architectures: ['arm64', 'x86_64'],
  },
] as const

/** One supported archive target. */
export type AppleArchiveTarget = typeof APPLE_ARCHIVE_TARGETS[number]

/** Tool output captured from one Release archive and its actual executable. */
export interface AppleArchiveObservation {
  settings: unknown
  archivePlist: unknown
  appPlist: unknown
  architectures: string[]
  binaryPlatforms: string[]
}

function fields(value: unknown, owner: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${owner} must be an object`)
  return value as Record<string, unknown>
}

function equalFields(actual: Record<string, unknown>, expected: Record<string, string>, owner: string): void {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`${owner} ${key} does not match the archive target`)
  }
}

/**
 * Resolve the single application target from Xcode's parsed settings output.
 * @param input - JSON emitted by xcodebuild -showBuildSettings -json.
 * @param scheme - selected application target.
 * @returns the target's settings, rejecting absent or duplicate targets.
 */
export function appleArchiveSettings(input: unknown, scheme: string): Record<string, unknown> {
  if (!Array.isArray(input)) throw new Error('Xcode settings must be an array')
  const matches = input.map(row => fields(row, 'Xcode target')).filter(row => row.target === scheme)
  const [match] = matches
  if (matches.length !== 1 || match === undefined) throw new Error('expected exactly one archive application target')
  return fields(match.buildSettings, 'Xcode buildSettings')
}

/**
 * Check metadata and executable slices against repository-owned identity and target policy.
 * @param identity - validated release identity.
 * @param target - selected device or desktop Companion target.
 * @param observation - actual Xcode, plist, lipo and vtool outputs.
 * @returns the executable basename after all comparisons pass.
 */
export function verifyAppleArchive(
  identity: ProductIdentity, target: AppleArchiveTarget, observation: AppleArchiveObservation,
): string {
  verifyAppleProduct(identity, observation.settings, observation.appPlist)
  const settings = fields(observation.settings, 'build settings')
  const plist = fields(observation.appPlist, 'application plist')
  const properties = fields(fields(observation.archivePlist, 'archive plist').ApplicationProperties, 'archive application')
  equalFields(settings, {
    CONFIGURATION: 'Release', PLATFORM_NAME: target.platformName,
    PRODUCT_BUNDLE_IDENTIFIER: target.bundleId, FULL_PRODUCT_NAME: 'DSH Companion.app', CODE_SIGNING_ALLOWED: 'NO',
  }, 'build settings')
  equalFields(plist, { CFBundleIdentifier: target.bundleId, CFBundlePackageType: 'APPL', DTPlatformName: target.platformName }, 'application plist')
  equalFields(properties, {
    ApplicationPath: 'Applications/DSH Companion.app', CFBundleIdentifier: target.bundleId,
    CFBundleShortVersionString: identity.marketingVersion, CFBundleVersion: identity.appleBuildVersion,
  }, 'archive application')
  if (!Array.isArray(plist.CFBundleSupportedPlatforms) || plist.CFBundleSupportedPlatforms.length !== 1
    || plist.CFBundleSupportedPlatforms[0] !== target.supportedPlatform) {
    throw new Error('application plist has the wrong supported platform')
  }
  const executable = plist.CFBundleExecutable
  if (typeof executable !== 'string' || executable.length === 0 || /[/\\\x00-\x1f]/.test(executable)
    || executable === '.' || executable === '..' || settings.EXECUTABLE_NAME !== executable) {
    throw new Error('application executable must match the Xcode basename')
  }
  if (observation.architectures.length !== target.architectures.length
    || [...observation.architectures].sort().join(',') !== [...target.architectures].sort().join(',')) {
    throw new Error('archive executable architectures differ from target policy')
  }
  if (observation.binaryPlatforms.length !== target.architectures.length
    || observation.binaryPlatforms.some(platform => platform !== target.binaryPlatform)) {
    throw new Error('archive executable contains a simulator or wrong-platform slice')
  }
  return executable
}

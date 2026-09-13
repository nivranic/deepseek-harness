/** Compare resolved Xcode settings and built Info.plist values with the committed application identity. */
import type { ProductIdentity } from './product-identity.ts'
import type { CiSourceReceipt } from './ci-evidence.ts'

/**
 * Supply the application's own immutable checkout to Xcode without changing tracked configuration.
 * @param source - validated source receipt for the checkout being built.
 * @returns Command-line build settings shared by settings inspection and application construction.
 */
export function appleApplicationSourceSettings(source: Pick<CiSourceReceipt, 'checkoutSha' | 'treeSha'>): string[] {
  return [`DSH_APPLICATION_SOURCE_SHA=${source.checkoutSha}`, `DSH_APPLICATION_SOURCE_TREE=${source.treeSha}`]
}

/**
 * Reject missing or mismatched application source fields in resolved settings and the final bundle.
 * @param source - independently selected application checkout and tree.
 * @param settings - resolved Xcode build settings.
 * @param plist - final application's expanded Info.plist.
 */
export function verifyAppleApplicationSource(source: Pick<CiSourceReceipt, 'checkoutSha' | 'treeSha'>, settings: unknown, plist: unknown): void {
  const checks = [
    { actual: fields(settings, 'build settings'), expected: {
      DSH_APPLICATION_SOURCE_SHA: source.checkoutSha, DSH_APPLICATION_SOURCE_TREE: source.treeSha,
    } },
    { actual: fields(plist, 'Info.plist'), expected: {
      DSHApplicationSourceSHA: source.checkoutSha, DSHApplicationSourceTree: source.treeSha,
    } },
  ]
  for (const { actual, expected } of checks) {
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) throw new Error(`Apple application source differs: ${key}`)
    }
  }
}

function fields(value: unknown, owner: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${owner} must be an object`)
  return value as Record<string, unknown>
}

/**
 * Refuse Apple artifacts whose resolved settings or embedded metadata drift from the release owner.
 * @param identity - validated repository application identity.
 * @param settings - the application's parsed xcodebuild buildSettings object.
 * @param plist - the built application's Info.plist converted to JSON by plutil.
 */
export function verifyAppleProduct(identity: ProductIdentity, settings: unknown, plist: unknown): void {
  const checks = [
    { owner: 'build settings', actual: fields(settings, 'build settings'), expected: {
      MARKETING_VERSION: identity.marketingVersion,
      CURRENT_PROJECT_VERSION: identity.appleBuildVersion,
      DSH_PRODUCT_VERSION: identity.version,
      DSH_PRODUCT_CHANNEL: identity.channel,
      DSH_PRODUCT_BUILD_NUMBER: String(identity.buildNumber),
    } },
    { owner: 'Info.plist', actual: fields(plist, 'Info.plist'), expected: {
      CFBundleShortVersionString: identity.marketingVersion,
      CFBundleVersion: identity.appleBuildVersion,
      DSHProductVersion: identity.version,
      DSHDistributionChannel: identity.channel,
      DSHBuildNumber: String(identity.buildNumber),
    } },
  ]
  for (const { owner, actual, expected } of checks) {
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) throw new Error(`${owner} ${key} does not match the product identity`)
    }
  }
}

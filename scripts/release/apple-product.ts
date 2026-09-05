/** Compare resolved Xcode settings and built Info.plist values with the committed application identity. */
import type { ProductIdentity } from './product-identity.ts'

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

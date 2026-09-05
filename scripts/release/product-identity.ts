/** Application release identity shared by native packaging; protocol versions keep their own owners. */

/** A distribution audience; it does not select runtime composition or protocol support. */
export type ProductChannel = 'dev' | 'canary' | 'beta' | 'stable'

/** Validated application identity, including each platform's numeric version representation. */
export interface ProductIdentity {
  readonly schemaVersion: 1
  readonly version: string
  readonly marketingVersion: string
  readonly buildNumber: number
  readonly channel: ProductChannel
  readonly windowsFileVersion: string
  readonly appleBuildVersion: string
}

const NUMBER = '(0|[1-9][0-9]*)'
const PRERELEASE = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
// The repository release sequence accepts SemVer without build metadata.
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${PRERELEASE}(?:\\.${PRERELEASE})*))?$`)
// Windows stores each file-version component in one unsigned 16-bit word.
const MAX_FILE_VERSION_COMPONENT = 65_535
const METADATA_KEYS = new Set(['schemaVersion', 'buildNumber', 'channel'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate the root manifest and release metadata before generating platform inputs.
 * @param manifest - parsed root package.json; its version is the sole application SemVer owner.
 * @param metadata - parsed release/product.json; unknown fields and unsupported channel/version pairs fail.
 * @returns The complete application identity with bounded, monotonic platform build representations.
 */
export function parseProductIdentity(manifest: unknown, metadata: unknown): ProductIdentity {
  if (!isRecord(manifest)) throw new Error('package.json must be an object')
  const version = manifest.version
  const match = typeof version === 'string' ? VERSION.exec(version) : null
  if (typeof version !== 'string' || match === null || match[0] !== version) {
    throw new Error('package.json version must be a canonical SemVer without build metadata')
  }
  const numbers = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (numbers.some(value => !Number.isSafeInteger(value) || value > MAX_FILE_VERSION_COMPONENT)) {
    throw new Error('application version exceeds a Windows file-version component (65535)')
  }
  if (!isRecord(metadata)) throw new Error('release/product.json must be an object')
  const unknownKeys = Object.keys(metadata).filter(key => !METADATA_KEYS.has(key))
  if (unknownKeys.length !== 0) throw new Error(`release/product.json has unknown fields: ${unknownKeys.join(', ')}`)
  if (metadata.schemaVersion !== 1) throw new Error('release/product.json schemaVersion must be 1')
  const buildNumber = metadata.buildNumber
  if (typeof buildNumber !== 'number' || !Number.isInteger(buildNumber)
    || buildNumber < 1 || buildNumber > MAX_FILE_VERSION_COMPONENT) {
    throw new Error('release/product.json buildNumber must be an integer from 1 to 65535')
  }
  const channel = metadata.channel
  if (channel !== 'dev' && channel !== 'canary' && channel !== 'beta' && channel !== 'stable') {
    throw new Error('release/product.json channel must be dev, canary, beta, or stable')
  }
  const prerelease = match[4]
  if ((channel === 'stable' && prerelease !== undefined)
    || (channel === 'canary' && prerelease === undefined)
    || (channel === 'beta' && !/^(beta|rc)(\.|$)/.test(prerelease ?? ''))) {
    throw new Error(`application version ${version} is incompatible with channel ${channel}`)
  }
  const marketingVersion = numbers.join('.')
  return {
    schemaVersion: 1,
    version,
    marketingVersion,
    buildNumber,
    channel,
    windowsFileVersion: `${marketingVersion}.${String(buildNumber)}`,
    appleBuildVersion: [1 + Math.floor(buildNumber / 10_000), Math.floor(buildNumber / 100) % 100, buildNumber % 100].join('.'),
  }
}

/**
 * Reject a reused or decreasing build number for a new distributed candidate.
 * @param previous - the last distributed identity, parsed from its retained manifest.
 * @param next - the new candidate's validated identity; same-artifact retries do not call this operation.
 */
export function assertBuildAdvances(previous: ProductIdentity, next: ProductIdentity): void {
  if (next.buildNumber <= previous.buildNumber) {
    throw new Error('a new distributed candidate must increase buildNumber across versions and channels')
  }
}

/**
 * Render every generated application version file from one validated identity.
 * @param identity - the validated root version, build number, and channel.
 * @returns Repository-relative output names and their complete UTF-8 text, each ending with one newline.
 */
export function renderProductIdentity(identity: ProductIdentity): Readonly<Record<string, string>> {
  return {
    'release/product.generated.json': `${JSON.stringify(identity, null, 2)}\n`,
    'apps/android/product-version.properties': [
      '# Generated by gen-product-identity. Edit package.json or release/product.json.',
      `versionName=${identity.version}`,
      `versionCode=${String(identity.buildNumber)}`,
      `channel=${identity.channel}`,
      '',
    ].join('\n'),
    'apps/apple/Config/Product.xcconfig': [
      '// Generated by gen-product-identity. Edit package.json or release/product.json.',
      `MARKETING_VERSION = ${identity.marketingVersion}`,
      `CURRENT_PROJECT_VERSION = ${identity.appleBuildVersion}`,
      `DSH_PRODUCT_VERSION = ${identity.version}`,
      `DSH_PRODUCT_CHANNEL = ${identity.channel}`,
      `DSH_PRODUCT_BUILD_NUMBER = ${String(identity.buildNumber)}`,
      '',
    ].join('\n'),
  }
}

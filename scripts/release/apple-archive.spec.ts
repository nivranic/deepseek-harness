/** Archive checks distinguish device binaries, release identity and desktop slices. */
import { describe, expect, it } from 'vitest'
import { APPLE_ARCHIVE_TARGETS, appleArchiveSettings, verifyAppleArchive } from './apple-archive.ts'
import type { AppleArchiveObservation, AppleArchiveTarget } from './apple-archive.ts'
import { parseProductIdentity } from './product-identity.ts'

const identity = parseProductIdentity({ version: '1.2.3-beta.1' }, { schemaVersion: 1, buildNumber: 12345, channel: 'beta' })

function fixture(target: AppleArchiveTarget): AppleArchiveObservation {
  return {
    settings: {
      MARKETING_VERSION: '1.2.3', CURRENT_PROJECT_VERSION: '2.23.45', DSH_PRODUCT_VERSION: '1.2.3-beta.1',
      DSH_PRODUCT_CHANNEL: 'beta', DSH_PRODUCT_BUILD_NUMBER: '12345', CONFIGURATION: 'Release',
      PLATFORM_NAME: target.platformName, PRODUCT_BUNDLE_IDENTIFIER: target.bundleId,
      FULL_PRODUCT_NAME: 'DSH Companion.app', EXECUTABLE_NAME: 'DSH Companion', CODE_SIGNING_ALLOWED: 'NO',
    },
    archivePlist: { ApplicationProperties: {
      ApplicationPath: 'Applications/DSH Companion.app', CFBundleIdentifier: target.bundleId,
      CFBundleShortVersionString: '1.2.3', CFBundleVersion: '2.23.45',
    } },
    appPlist: {
      CFBundleShortVersionString: '1.2.3', CFBundleVersion: '2.23.45', DSHProductVersion: '1.2.3-beta.1',
      DSHDistributionChannel: 'beta', DSHBuildNumber: '12345', CFBundleIdentifier: target.bundleId,
      CFBundlePackageType: 'APPL', CFBundleExecutable: 'DSH Companion', DTPlatformName: target.platformName,
      CFBundleSupportedPlatforms: [target.supportedPlatform],
    },
    architectures: [...target.architectures], binaryPlatforms: target.architectures.map(() => target.binaryPlatform),
  }
}

describe('Apple Companion archive verification', () => {
  for (const target of APPLE_ARCHIVE_TARGETS) {
    it(`accepts the ${target.platform} Release application`, () => {
      expect(verifyAppleArchive(identity, target, fixture(target))).toBe('DSH Companion')
    })
    for (const [field, patch] of [
      ['settings', { CONFIGURATION: 'Debug' }],
      ['settings', { CODE_SIGNING_ALLOWED: 'YES' }],
      ['settings', { DSH_PRODUCT_VERSION: '1.2.3' }],
      ['settings', { PRODUCT_BUNDLE_IDENTIFIER: 'com.deepseek-harness.host.mac' }],
      ['appPlist', { DSHBuildNumber: '12346' }],
      ['appPlist', { CFBundleExecutable: '../outside' }],
      ['appPlist', { CFBundleSupportedPlatforms: ['iPhoneSimulator'] }],
    ] as const) {
      it(`rejects ${target.platform} ${Object.keys(patch)[0]} drift`, () => {
        const observed = fixture(target)
        observed[field] = { ...observed[field] as Record<string, unknown>, ...patch }
        expect(() => verifyAppleArchive(identity, target, observed)).toThrow()
      })
    }
    it(`rejects ${target.platform} archive application substitution`, () => {
      const observed = fixture(target)
      observed.archivePlist = { ApplicationProperties: { ApplicationPath: '../outside.app' } }
      expect(() => verifyAppleArchive(identity, target, observed)).toThrow('archive application')
    })
    it(`rejects ${target.platform} simulator slices despite device plist metadata`, () => {
      const observed = fixture(target)
      observed.binaryPlatforms[0] = 'IOSSIMULATOR'
      expect(() => verifyAppleArchive(identity, target, observed)).toThrow('wrong-platform slice')
    })
    it(`rejects ${target.platform} missing executable slices`, () => {
      const observed = fixture(target)
      observed.architectures.pop()
      expect(() => verifyAppleArchive(identity, target, observed)).toThrow('architectures')
    })
  }
  it('rejects missing and duplicate Xcode application targets', () => {
    expect(() => appleArchiveSettings({}, 'CompanioniOS')).toThrow('array')
    expect(() => appleArchiveSettings([null], 'CompanioniOS')).toThrow('object')
    expect(() => appleArchiveSettings([], 'CompanioniOS')).toThrow('exactly one')
    expect(() => appleArchiveSettings([{ target: 'CompanioniOS' }], 'CompanioniOS')).toThrow('buildSettings')
    const row = { target: 'CompanioniOS', buildSettings: fixture(APPLE_ARCHIVE_TARGETS[0]).settings }
    expect(() => appleArchiveSettings([row, row], 'CompanioniOS')).toThrow('exactly one')
    expect(appleArchiveSettings([{ target: 'Other' }, row], 'CompanioniOS')).toEqual(row.buildSettings)
  })
})

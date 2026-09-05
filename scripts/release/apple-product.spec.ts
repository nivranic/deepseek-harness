/** Apple packaging verification rejects resolved-setting and embedded-identity drift. */
import { describe, expect, it } from 'vitest'
import { verifyAppleProduct } from './apple-product.ts'
import { parseProductIdentity } from './product-identity.ts'

const identity = parseProductIdentity({ version: '1.2.3-beta.1' }, { schemaVersion: 1, buildNumber: 12345, channel: 'beta' })
const settings = {
  MARKETING_VERSION: '1.2.3', CURRENT_PROJECT_VERSION: '2.23.45', DSH_PRODUCT_VERSION: '1.2.3-beta.1',
  DSH_PRODUCT_CHANNEL: 'beta', DSH_PRODUCT_BUILD_NUMBER: '12345',
}
const plist = {
  CFBundleShortVersionString: '1.2.3', CFBundleVersion: '2.23.45', DSHProductVersion: '1.2.3-beta.1',
  DSHDistributionChannel: 'beta', DSHBuildNumber: '12345',
}

describe('Apple product artifact identity', () => {
  it('accepts matching resolved and embedded identities', () => {
    expect(() => { verifyAppleProduct(identity, settings, plist) }).not.toThrow()
  })
  for (const key of Object.keys(settings)) {
    it(`rejects stale build setting ${key}`, () => {
      expect(() => { verifyAppleProduct(identity, { ...settings, [key]: 'stale' }, plist) }).toThrow(key)
    })
  }
  for (const key of Object.keys(plist)) {
    it(`rejects missing embedded field ${key}`, () => {
      const missing = Object.fromEntries(Object.entries(plist).filter(([field]) => field !== key))
      expect(() => { verifyAppleProduct(identity, settings, missing) }).toThrow(key)
    })
  }
  it('rejects malformed parser output', () => {
    expect(() => { verifyAppleProduct(identity, [], plist) }).toThrow('build settings must be an object')
    expect(() => { verifyAppleProduct(identity, settings, null) }).toThrow('Info.plist must be an object')
  })
})

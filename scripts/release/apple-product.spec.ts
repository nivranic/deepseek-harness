/** Apple packaging verification rejects resolved-setting and embedded-identity drift. */
import { describe, expect, it } from 'vitest'
import { appleApplicationSourceSettings, verifyAppleApplicationSource, verifyAppleProduct } from './apple-product.ts'
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

describe('Apple application source in the actual bundle', () => {
  const source = { checkoutSha: 'a'.repeat(40), treeSha: 'b'.repeat(40) }
  const sourceSettings = Object.fromEntries(appleApplicationSourceSettings(source).map((value) => {
    const separator = value.indexOf('=')
    return [value.slice(0, separator), value.slice(separator + 1)] as const
  }))
  const sourcePlist = { DSHApplicationSourceSHA: source.checkoutSha, DSHApplicationSourceTree: source.treeSha }

  it('accepts the checkout supplied to Xcode only when the bundle contains both matching fields', () => {
    expect(() => { verifyAppleApplicationSource(source, sourceSettings, sourcePlist) }).not.toThrow()
    expect(() => { verifyAppleApplicationSource({ ...source, checkoutSha: 'c'.repeat(40) }, sourceSettings, sourcePlist) })
      .toThrow('DSH_APPLICATION_SOURCE_SHA')
  })

  it.each(['DSHApplicationSourceSHA', 'DSHApplicationSourceTree'] as const)('rejects missing, unresolved or different %s', (key) => {
    for (const changed of ['', '$(UNRESOLVED)', 'c'.repeat(40), true, undefined]) {
      expect(() => { verifyAppleApplicationSource(source, sourceSettings, { ...sourcePlist, [key]: changed }) }).toThrow(key)
    }
  })

  it.each(['DSH_APPLICATION_SOURCE_SHA', 'DSH_APPLICATION_SOURCE_TREE'])('rejects an unstamped resolved setting %s', (key) => {
    expect(() => { verifyAppleApplicationSource(source, { ...sourceSettings, [key]: '' }, sourcePlist) }).toThrow(key)
  })
})

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

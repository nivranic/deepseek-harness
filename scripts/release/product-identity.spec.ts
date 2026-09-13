import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertBuildAdvances, parseProductIdentity, renderProductIdentity } from './product-identity.ts'
import { readProductIdentity, staleProductIdentityFiles, writeProductIdentity } from './product-files.ts'

const metadata = { schemaVersion: 1, buildNumber: 1, channel: 'dev' }
const parse = (version: string, overrides: Record<string, unknown> = {}) =>
  parseProductIdentity({ version }, { ...metadata, ...overrides })

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-identity-'))
  roots.push(root)
  mkdirSync(join(root, 'release'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.2-alpha.1' }))
  writeFileSync(join(root, 'release/product.json'), JSON.stringify(metadata))
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('product release identity', () => {
  it('projects the root prerelease into the three platform version formats', () => {
    expect(parse('0.1.2-alpha.1')).toEqual({
      schemaVersion: 1,
      version: '0.1.2-alpha.1',
      marketingVersion: '0.1.2',
      buildNumber: 1,
      channel: 'dev',
      windowsFileVersion: '0.1.2.1',
      appleBuildVersion: '1.0.1',
    })
  })

  it.each([
    [99, '1.0.99'], [100, '1.1.0'], [9999, '1.99.99'], [10000, '2.0.0'], [65535, '7.55.35'],
  ])('maps build %i without a decreasing Apple component', (buildNumber, expected) => {
    expect(parse('1.2.3', { buildNumber }).appleBuildVersion).toBe(expected)
  })

  it.each([
    ['dev', '1.2.3-alpha.1'], ['canary', '1.2.3-canary.7'],
    ['beta', '1.2.3-beta.1'], ['beta', '1.2.3-rc.1'], ['stable', '1.2.3'],
  ])('admits the %s distribution of %s', (channel, version) => {
    expect(parse(version, { channel }).channel).toBe(channel)
  })

  it.each([
    ['canary', '1.2.3'], ['beta', '1.2.3'], ['beta', '1.2.3-alpha.1'], ['stable', '1.2.3-rc.1'],
  ])('refuses the %s distribution of %s', (channel, version) => {
    expect(() => parse(version, { channel })).toThrow('channel')
  })

  it.each([
    '1.2', '01.2.3', '1.2.3-01', '1.2.3-rc..1', '1.2.3+local', '1.2.3\n', '1.2.3-rc.1\r',
    '65536.1.2', '1.65536.2', '1.2.65536',
  ])('rejects unsupported application version %s', (version) => {
    expect(() => parse(version)).toThrow('version')
  })

  it.each([0, -1, 1.5, 65536, '1', null])('rejects invalid build number %s', (buildNumber) => {
    expect(() => parse('0.1.2-alpha.1', { buildNumber })).toThrow('buildNumber')
  })

  it('rejects malformed and duplicated source owners at the file input', () => {
    expect(() => parseProductIdentity(null, metadata)).toThrow('package.json')
    expect(() => parseProductIdentity({ version: 1 }, metadata)).toThrow('version')
    expect(() => parseProductIdentity({ version: '1.2.3' }, [])).toThrow('release/product.json')
    expect(() => parse('1.2.3', { version: '2.0.0' })).toThrow('unknown')
    expect(() => parse('1.2.3', { schemaVersion: 2 })).toThrow('schemaVersion')
    expect(() => parse('1.2.3', { channel: 'production' })).toThrow('channel')
  })

  it('requires new distributed candidates to advance the shared build sequence', () => {
    const previous = parse('0.1.2-alpha.1')
    expect(() => { assertBuildAdvances(previous, parse('0.1.2-beta.1', { channel: 'beta' })) }).toThrow('buildNumber')
    expect(() => { assertBuildAdvances(previous, parse('0.1.2-beta.1', { channel: 'beta', buildNumber: 2 })) }).not.toThrow()
  })

  it('renders deterministic inputs for all consumers without protocol versions', () => {
    const identity = parse('0.1.2-alpha.1')
    const files = renderProductIdentity(identity)
    expect(Object.keys(files).sort()).toEqual([
      'apps/android/product-version.properties', 'apps/apple/Config/Product.xcconfig', 'release/product.generated.json',
    ])
    expect(files).toEqual(renderProductIdentity(identity))
    expect(files['apps/android/product-version.properties']).toContain('versionName=0.1.2-alpha.1\n')
    expect(files['apps/android/product-version.properties']).toContain('versionCode=1\n')
    expect(files['apps/apple/Config/Product.xcconfig']).toContain('CURRENT_PROJECT_VERSION = 1.0.1\n')
    expect(files['apps/apple/Config/Product.xcconfig']).toContain('MARKETING_VERSION = 0.1.2\n')
    expect(JSON.parse(files['release/product.generated.json'] ?? '')).toEqual(identity)
    for (const value of Object.values(files)) {
      expect(value.endsWith('\n') && !value.endsWith('\n\n')).toBe(true)
      expect(value).not.toMatch(/protocolVersion|contractVersion|sessionFormatVersion/)
    }
  })

  it('rejects every missing or edited projection without rewriting the offending bytes', () => {
    const root = fixture()
    const identity = readProductIdentity(root)
    const files = renderProductIdentity(identity)
    expect(staleProductIdentityFiles(root, identity).sort()).toEqual(Object.keys(files).sort())
    writeProductIdentity(root, identity)
    expect(staleProductIdentityFiles(root, identity)).toEqual([])
    for (const name of Object.keys(files)) {
      const path = join(root, name)
      writeFileSync(path, 'versionName=0.1.0\n')
      expect(staleProductIdentityFiles(root, identity)).toEqual([name])
      expect(readFileSync(path, 'utf8')).toBe('versionName=0.1.0\n')
      writeProductIdentity(root, identity)
    }
    writeProductIdentity(root, identity)
    expect(staleProductIdentityFiles(root, identity)).toEqual([])
  })

  it('makes a root-version edit stale on every native projection', () => {
    const root = fixture()
    writeProductIdentity(root, readProductIdentity(root))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.3-alpha.1' }))
    const identity = readProductIdentity(root)
    expect(staleProductIdentityFiles(root, identity).sort()).toEqual(Object.keys(renderProductIdentity(identity)).sort())
  })

  it('leaves the prior projections intact when a new source input is invalid', () => {
    const root = fixture()
    const identity = readProductIdentity(root)
    writeProductIdentity(root, identity)
    writeFileSync(join(root, 'release/product.json'), JSON.stringify({ ...metadata, channel: 'stable' }))
    expect(() => { writeProductIdentity(root, readProductIdentity(root)) }).toThrow('channel')
    for (const [name, value] of Object.entries(renderProductIdentity(identity))) {
      expect(readFileSync(join(root, name), 'utf8')).toBe(value)
    }
    rmSync(join(root, 'release/product.json'))
    expect(() => readProductIdentity(root)).toThrow()
    mkdirSync(dirname(join(root, 'release/product.json')), { recursive: true })
    writeFileSync(join(root, 'release/product.json'), '{')
    expect(() => readProductIdentity(root)).toThrow()
  })
})

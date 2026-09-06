import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProductIdentity } from './product-identity.ts'
import { classifyRcAdvance, parseRcManifest, parseRcPath, parseRcPlatformReceipt, parseRcPolicy, type RcManifest, type RcPlatformReceipt } from './rc-manifest.ts'

const policyJson: unknown = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../release/rc-policy.json'), 'utf8'))
const policy = parseRcPolicy(policyJson)
const identity = parseProductIdentity({ version: '0.1.2-alpha.1' }, { schemaVersion: 1, buildNumber: 1, channel: 'dev' })
function manifest(): RcManifest {
  const sourceSha = 'a'.repeat(40)
  const ref = (path: string) => ({ path, bytes: 1, sha256: 'b'.repeat(64) })
  const platforms = policy.platforms.map(({ platform, artifacts: required }): RcPlatformReceipt => ({
    schemaVersion: 1, sourceSha, identity: { ...identity }, platform,
    artifacts: required.map((artifact, index) => ({ ...ref(`${platform}/artifact-${index}`), ...artifact, signing: 'unsigned' })),
    checks: policy.requiredChecks.map(name => ({ ...ref(`${platform}/${name}.json`), name })),
    sbom: { ...ref(`${platform}/sbom.json`), format: 'cyclonedx-1.6', tool: { name: 'scanner', version: '1' } },
    provenance: { ...ref(`${platform}/provenance.json`), builderId: 'builder', invocationId: 'run' },
  }))
  return { schemaVersion: 1, sourceSha, identity: { ...identity }, platforms }
}

describe('release candidate metadata', () => {
  it('requires the repository platform, runtime and packaging responsibilities', () => {
    expect(policy.requiredChecks).toEqual(['identity', 'startup'])
    expect(policy.platforms).toEqual([
      { platform: 'windows', artifacts: [{ kind: 'installer', runtimeClass: 'full' }, { kind: 'portable', runtimeClass: 'full' }] },
      { platform: 'macos', artifacts: [{ kind: 'archive', runtimeClass: 'full' }, { kind: 'archive', runtimeClass: 'companion' }] },
      { platform: 'ios', artifacts: [{ kind: 'archive', runtimeClass: 'companion' }] },
      { platform: 'android', artifacts: [{ kind: 'bundle', runtimeClass: 'companion' }, { kind: 'mapping', runtimeClass: 'companion' }] },
    ])
    expect(() => parseRcPolicy({ ...policy, platforms: policy.platforms.slice(1) })).toThrow('four platforms')
    expect(() => parseRcPolicy({ ...policy, platforms: [policy.platforms[0], ...policy.platforms.slice(0, 3)] })).toThrow('duplicate')
  })

  it('canonicalizes platform and file ordering', () => {
    const input = manifest()
    input.platforms.reverse()
    input.platforms.forEach((receipt) => { receipt.artifacts.reverse(); receipt.checks.reverse() })
    expect(parseRcManifest(input, policy)).toEqual(parseRcManifest(manifest(), policy))
  })

  it.each([
    '', '/tmp/file', '../file', 'windows/../file', 'windows/./file', 'windows//file',
    'C:/file', 'C:file', '\\\\server\\file', 'windows\\file', 'windows/file:stream', 'windows/NUL.txt',
    'windows/Com1', 'windows/COM1 .txt', 'windows/COM¹.txt', 'windows/trailing.', 'windows/trailing ', 'windows/file\n', 'windows/e\u0301',
  ])('rejects non-portable path %j', (path) => { expect(() => parseRcPath(path)).toThrow() })

  it.each([
    ['missing platform', (input: RcManifest) => { input.platforms.pop() }, 'four platforms'],
    ['duplicate platform', (input: RcManifest) => { input.platforms[1] = input.platforms[0]! }, 'duplicate'],
    ['mixed source', (input: RcManifest) => { input.platforms[0]!.sourceSha = 'b'.repeat(40) }, 'mixed source'],
    ['mixed identity', (input: RcManifest) => { input.platforms[0]!.identity = { ...input.platforms[0]!.identity, channel: 'canary' } }, 'mixed source'],
    ['derived identity', (input: RcManifest) => { input.identity = { ...input.identity, windowsFileVersion: '9.9.9.9' } }, 'derived'],
    ['missing artifact', (input: RcManifest) => { input.platforms[0]!.artifacts.pop() }, 'required artifact'],
    ['missing check', (input: RcManifest) => { input.platforms[0]!.checks.pop() }, 'required check'],
    ['duplicate check', (input: RcManifest) => { input.platforms[0]!.checks.push(input.platforms[0]!.checks[0]!) }, 'duplicate'],
    ['cross-platform path', (input: RcManifest) => { input.platforms[0]!.artifacts[0]!.path = 'ios/file' }, 'namespace'],
    ['case alias', (input: RcManifest) => { input.platforms[0]!.artifacts[1]!.path = input.platforms[0]!.artifacts[0]!.path.toUpperCase() }, 'duplicate'],
    ['empty file', (input: RcManifest) => { input.platforms[0]!.artifacts[0]!.bytes = 0 }, 'positive'],
    ['short digest', (input: RcManifest) => { input.platforms[0]!.artifacts[0]!.sha256 = 'abcd' }, 'SHA-256'],
    ['short commit', (input: RcManifest) => { input.sourceSha = 'abc' }, 'full Git SHA'],
    ['newline commit', (input: RcManifest) => { input.sourceSha += '\n' }, 'full Git SHA'],
    ['newline digest', (input: RcManifest) => { input.platforms[0]!.artifacts[0]!.sha256 += '\n' }, 'SHA-256'],
  ] as const)('rejects %s', (_name, edit, error) => {
    const input = manifest()
    edit(input)
    expect(() => parseRcManifest(input, policy)).toThrow(error)
  })

  it('rejects unknown schemas, fields and signing classes', () => {
    expect(() => parseRcManifest({ ...manifest(), schemaVersion: 2 }, policy)).toThrow('schema')
    expect(() => parseRcManifest({ ...manifest(), extra: true }, policy)).toThrow('unknown fields')
    const receipt = manifest().platforms[0]!
    expect(() => parseRcPlatformReceipt({ ...receipt, schemaVersion: 2 }, policy)).toThrow('schema')
    expect(() => parseRcPlatformReceipt({ ...receipt, artifacts: receipt.artifacts.map(a => ({ ...a, signing: 'production' })) }, policy)).toThrow('signing')
  })

  it('allows evidence refresh only for the same source, identity and deliverables', () => {
    const previous = parseRcManifest(manifest(), policy), next = structuredClone(previous)
    next.platforms[0]!.provenance.invocationId = 'run-2'
    next.platforms[0]!.checks[0]!.sha256 = 'c'.repeat(64)
    expect(classifyRcAdvance(previous, next)).toBe('retry')
    next.platforms[0]!.artifacts[0]!.sha256 = 'd'.repeat(64)
    expect(() => classifyRcAdvance(previous, next)).toThrow('increase buildNumber')
    next.identity = parseProductIdentity({ version: identity.version }, { schemaVersion: 1, buildNumber: 2, channel: 'dev' })
    next.platforms.forEach((receipt) => { receipt.identity = next.identity })
    expect(classifyRcAdvance(previous, parseRcManifest(next, policy))).toBe('new')
  })

  it('requires advancement for a different source, channel or version', () => {
    for (const field of ['sourceSha', 'channel', 'version'] as const) {
      const previous = parseRcManifest(manifest(), policy), next = structuredClone(previous)
      if (field === 'sourceSha') next.sourceSha = 'c'.repeat(40)
      else next.identity = parseProductIdentity({ version: field === 'version' ? '0.1.3-alpha.1' : identity.version }, {
        schemaVersion: 1, buildNumber: 1, channel: field === 'channel' ? 'canary' : 'dev',
      })
      expect(() => classifyRcAdvance(previous, next)).toThrow('increase buildNumber')
    }
  })
})

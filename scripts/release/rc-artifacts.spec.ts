import { linkSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProductIdentity } from './product-files.ts'
import { verifyRcArtifacts, verifyRcPlatform } from './rc-artifacts.ts'
import { parseRcJson, RcFileReader } from './rc-files.ts'
import { writeRcFixture, writeRcFixtureFile } from './rc-fixture.ts'
import { parseRcPolicy, type RcFile } from './rc-manifest.ts'

const repository = resolve(import.meta.dirname, '../..')
const policy = parseRcPolicy(JSON.parse(readFileSync(join(repository, 'release/rc-policy.json'), 'utf8')) as unknown)
const expected = { sourceSha: 'a'.repeat(40), sourceRepository: 'git+https://example.invalid/repository', identity: readProductIdentity(repository), maxJsonBytes: 1024 * 1024 }
const roots: string[] = []
function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-rc-test-'))
  roots.push(root)
  return root
}
function fixture() {
  const root = directory()
  const manifest = writeRcFixture(root, policy, expected.identity, expected.sourceSha, expected.sourceRepository)
  return { root, manifest, receipt: manifest.platforms[0]! }
}
function rewrite(root: string, file: RcFile, edit: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(join(root, file.path), 'utf8')) as Record<string, unknown>
  edit(value)
  Object.assign(file, writeRcFixtureFile(root, file.path, JSON.stringify(value)))
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('release candidate bytes and claims', () => {
  it('verifies every synthetic platform and permits separate producer verification', async () => {
    const { root, manifest, receipt } = fixture()
    expect((await verifyRcArtifacts(root, manifest, policy, expected)).platforms).toHaveLength(4)
    expect((await verifyRcPlatform(root, receipt, policy, expected)).platform).toBe('windows')
  })

  it.each(['sourceSha', 'identity', 'sourceRepository'] as const)('requires independently expected %s', async (field) => {
    const { root, manifest } = fixture()
    const wrong = { ...expected }
    if (field === 'identity') wrong.identity = { ...expected.identity, channel: 'canary' }
    else wrong[field] = field === 'sourceSha' ? 'b'.repeat(40) : 'git+https://example.invalid/other'
    await expect(verifyRcArtifacts(root, manifest, policy, wrong)).rejects.toThrow(/expected/)
  })

  it.each(['absent', 'size', 'byte', 'digest'] as const)('rejects %s corruption', async (kind) => {
    const { root, manifest, receipt } = fixture()
    const file = receipt.artifacts[0]!, path = join(root, file.path)
    if (kind === 'absent') rmSync(path)
    else if (kind === 'size') writeFileSync(path, 'short')
    else if (kind === 'digest') file.sha256 = '0'.repeat(64)
    else {
      const bytes = readFileSync(path)
      bytes[0] = bytes[0]! ^ 1
      writeFileSync(path, bytes)
    }
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow(kind === 'absent' ? 'ENOENT' : /size mismatch|checksum mismatch/)
  })

  it.each(['status', 'sourceSha', 'identity', 'platform', 'name', 'subjects', 'extra'] as const)('rejects checksum-consistent wrong check %s', async (field) => {
    const { root, manifest, receipt } = fixture()
    rewrite(root, receipt.checks[0]!, (value) => { value[field] = field === 'subjects' ? [] : 'wrong' })
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow(/RC check|subjects/)
  })

  it.each(['schema', 'scanner', 'inventory', 'component', 'nested'] as const)('rejects checksum-consistent SBOM %s errors', async (kind) => {
    const { root, manifest, receipt } = fixture()
    rewrite(root, receipt.sbom, (value) => {
      if (kind === 'schema') value.specVersion = '1.5'
      else if (kind === 'inventory') value.components = []
      else if (kind === 'nested') value.components = [{ type: 'library', name: 'bad', licenses: 'invalid' }]
      else {
        const metadata = value.metadata as Record<string, unknown>
        if (kind === 'scanner') metadata.tools = [{ name: 'wrong', version: '1.0.0' }]
        else delete metadata.component
      }
    })
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow('RC SBOM')
  })

  it.each(['schema', 'subjects', 'source', 'identity', 'builder', 'invocation', 'sbom'] as const)('rejects checksum-consistent provenance %s errors', async (kind) => {
    const { root, manifest, receipt } = fixture()
    rewrite(root, receipt.provenance, (value) => {
      if (kind === 'schema') value.predicateType = 'https://slsa.dev/provenance/v0.2'
      else if (kind === 'subjects') value.subject = []
      else if (kind === 'sbom') value.subject = (value.subject as Array<{ name: string }>).filter(file => file.name !== receipt.sbom.path)
      else {
        const predicate = value.predicate as Record<string, Record<string, unknown>>
        if (kind === 'source') predicate.buildDefinition!.resolvedDependencies = []
        else if (kind === 'identity') predicate.buildDefinition!.externalParameters = {}
        else if (kind === 'builder') predicate.runDetails!.builder = { id: 'wrong' }
        else predicate.runDetails!.metadata = { invocationId: 'wrong' }
      }
    })
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow(/provenance|subjects/)
  })

  it('bounds JSON even when its receipt reports the correct digest and size', async () => {
    const { root, manifest } = fixture()
    await expect(verifyRcArtifacts(root, manifest, policy, { ...expected, maxJsonBytes: 8 })).rejects.toThrow('byte limit')
  })

  it('rejects malformed JSON and UTF-8 without echoing input content', async () => {
    const { root, manifest, receipt } = fixture()
    const file = receipt.checks[0]!
    Object.assign(file, writeRcFixtureFile(root, file.path, 'private-evidence-marker: invalid json'))
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow('RC input must be valid UTF-8 JSON')
    expect(() => parseRcJson(Buffer.from([0xff]))).toThrow('RC input must be valid UTF-8 JSON')
  })

  it('rejects linked platform directories and a linked root', async () => {
    const { root, manifest } = fixture(), outside = directory()
    renameSync(join(root, 'windows'), join(outside, 'windows'))
    symlinkSync(join(outside, 'windows'), join(root, 'windows'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow('real directories')
    const linkedRoot = join(directory(), 'linked')
    symlinkSync(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(verifyRcArtifacts(linkedRoot, manifest, policy, expected)).rejects.toThrow('real directory')
  })

  it.skipIf(process.platform === 'win32')('rejects a leaf symlink even when its target has identical bytes', async () => {
    const { root, manifest, receipt } = fixture(), outside = directory()
    const path = join(root, receipt.artifacts[0]!.path), target = join(outside, 'identical')
    renameSync(path, target)
    symlinkSync(target, path)
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow('regular files')
  })

  it('rejects a hard link even when its bytes match', async () => {
    const { root, manifest, receipt } = fixture()
    linkSync(join(root, receipt.artifacts[0]!.path), join(directory(), 'alias'))
    await expect(verifyRcArtifacts(root, manifest, policy, expected)).rejects.toThrow('hard links')
  })

  it('detects replacement of an already verified file', async () => {
    const { root, receipt } = fixture()
    const reader = await RcFileReader.create(root, expected.maxJsonBytes), file = receipt.artifacts[0]!
    await reader.read(file)
    const path = join(root, file.path), bytes = readFileSync(path)
    renameSync(path, join(root, 'retired'))
    writeFileSync(path, bytes)
    await expect(reader.assertUnchanged()).rejects.toThrow('changed')
  })
})

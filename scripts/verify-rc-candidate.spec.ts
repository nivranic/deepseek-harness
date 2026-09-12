import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProductIdentity } from './release/product-files.ts'
import { writeRcFixture } from './release/rc-fixture.ts'
import { parseRcPolicy } from './release/rc-manifest.ts'
import { verifyRcCandidate } from './verify-rc-candidate.ts'

const repository = resolve(import.meta.dirname, '..')
const policy = parseRcPolicy(JSON.parse(readFileSync(join(repository, 'release/rc-policy.json'), 'utf8')) as unknown)
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-rc-cli-'))
  roots.push(root)
  const manifest = writeRcFixture(root, policy, readProductIdentity(repository), 'a'.repeat(40), 'git+https://example.invalid/source')
  const path = join(root, 'manifest.json')
  writeFileSync(path, JSON.stringify(manifest))
  const args = ['--root', root, '--manifest', path, '--source-sha', manifest.sourceSha, '--source-repository', 'git+https://example.invalid/source']
  return { root, manifest, path, args }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('candidate verifier entry points', () => {
  it('executes the CLI and rejects an altered deliverable with a nonzero status', () => {
    const { root, manifest, args } = fixture()
    const entry = join(repository, 'scripts/verify-rc-candidate.ts')
    const output = execFileSync(process.execPath, ['--import', 'tsx/esm', entry, ...args], { cwd: repository, encoding: 'utf8' })
    expect(JSON.parse(output)).toMatchObject({ status: 'PASS', scope: 'candidate', platforms: 4, advancement: 'not-checked', authenticated: false })
    const path = join(root, manifest.platforms[0]!.artifacts[0]!.path), bytes = readFileSync(path)
    bytes[0] = bytes[0]! ^ 1
    writeFileSync(path, bytes)
    const rejected = spawnSync(process.execPath, ['--import', 'tsx/esm', entry, ...args], { cwd: repository, encoding: 'utf8' })
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('checksum mismatch')
    expect(rejected.stdout).not.toContain('PASS')
  })

  it('executes the policy gate and rejects a narrowed policy', () => {
    const { root } = fixture(), entry = join(repository, 'scripts/verify-rc-policy.ts')
    expect(execFileSync(process.execPath, ['--import', 'tsx/esm', entry], { cwd: repository, encoding: 'utf8' })).toContain('4 platform')
    const path = join(root, 'narrowed-policy.json')
    writeFileSync(path, JSON.stringify({ ...policy, platforms: policy.platforms.slice(0, 3) }))
    const rejected = spawnSync(process.execPath, ['--import', 'tsx/esm', entry, path], { cwd: repository, encoding: 'utf8' })
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('all four platforms')
  })

  it('distinguishes platform verification and unchanged distribution retries', async () => {
    const { root, manifest, path, args } = fixture()
    expect(await verifyRcCandidate([...args, '--previous', path], repository)).toMatchObject({ scope: 'candidate', advancement: 'retry' })
    const receiptPath = join(root, 'receipt.json')
    writeFileSync(receiptPath, JSON.stringify(manifest.platforms[0]))
    const receiptArgs = args.map(value => value === '--manifest' ? '--receipt' : value === path ? receiptPath : value)
    expect(await verifyRcCandidate(receiptArgs, repository)).toMatchObject({ scope: 'platform', platform: 'windows' })
    await expect(verifyRcCandidate([...receiptArgs, '--previous', path], repository)).rejects.toThrow('--previous')
  })

  it('requires explicit source expectations and a bounded input size', async () => {
    const { args, path } = fixture()
    await expect(verifyRcCandidate([], repository)).rejects.toThrow('require --root')
    await expect(verifyRcCandidate([...args, '--receipt', path], repository)).rejects.toThrow('exactly one')
    await expect(verifyRcCandidate([...args, '--max-json-bytes', '0'], repository)).rejects.toThrow('positive')
    await expect(verifyRcCandidate([...args, '--max-json-bytes', '8'], repository)).rejects.toThrow('byte limit')
    await expect(verifyRcCandidate([...args, '--unknown'], repository)).rejects.toThrow('Unknown option')
  })
})

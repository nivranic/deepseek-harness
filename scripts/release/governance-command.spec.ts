/** Real owner calls reject missing, stale and unauthenticated acceptance evidence. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'
import type { CiGithub } from './ci-collector.ts'
import { verifyReleaseReadiness } from './governance-command.ts'
import { readProductIdentity } from './product-files.ts'
import { writeRcFixture } from './rc-fixture.ts'
import { parseRcPolicy } from './rc-manifest.ts'

const repository = resolve(import.meta.dirname, '../..'), roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSafely(root) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-readiness-')); roots.push(root)
  const checkout = join(root, 'checkout'); mkdirSync(checkout)
  const workflows = ['ci', 'apple-swift', 'android-kotlin'].map(name => `.github/workflows/${name}.yml`)
  for (const path of ['package.json', 'release/product.json', 'release/checklist.json', 'release/rc-policy.json', ...workflows]) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), readFileSync(join(repository, path)))
  }
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  git(['init', '--quiet']); git(['add', '.'])
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'])
  const sha = git(['rev-parse', 'HEAD']), tree = git(['rev-parse', 'HEAD^{tree}'])
  const prefix = 'repos/owner/repository'
  const api: CiGithub = {
    async json(endpoint) {
      if (endpoint === `${prefix}/git/commits/${sha}`) return { sha, tree: { sha: tree }, parents: [] }
      const path = workflows.find(value => endpoint === `${prefix}/contents/${value}?ref=${sha}`)
      if (path) return { type: 'file', encoding: 'base64', content: readFileSync(join(checkout, path)).toString('base64') }
      if (workflows.some(value => endpoint === `${prefix}/actions/workflows/${value.split('/').at(-1)}/runs?head_sha=${sha}&event=pull_request&per_page=100&page=1`)) {
        return { total_count: 0, workflow_runs: [] }
      }
      throw new Error('unexpected fixture endpoint')
    },
    async source() { throw new Error('no source artifact exists in this fixture') },
  }
  const args = ['--repo', 'owner/repository', '--source-sha', sha]
  const policy = parseRcPolicy(JSON.parse(readFileSync(join(checkout, 'release/rc-policy.json'), 'utf8')) as unknown)
  const artifacts = join(root, 'artifacts'); mkdirSync(artifacts)
  const manifest = writeRcFixture(artifacts, policy, readProductIdentity(checkout), sha, 'git+https://github.com/owner/repository')
  const manifestPath = join(artifacts, 'manifest.json'); writeFileSync(manifestPath, JSON.stringify(manifest))
  return { root, checkout, sha, tree, args, api, manifest, manifestPath, artifacts,
    artifactArgs: [...args, '--root', artifacts, '--manifest', manifestPath] }
}

it('keeps missing CI pending and absent adapters unavailable with source and policy digests', async () => {
  const f = fixture(), result = await verifyReleaseReadiness(f.args, f.checkout, f.api)
  expect(result).toMatchObject({ decision: 'NO_GO', publicationAuthorized: false, sourceSha: f.sha, treeSha: f.tree,
    ci: { status: 'PENDING' }, artifactIntegrity: { status: 'UNAVAILABLE' } })
  expect(result.policySha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.engineering.find(row => row.id === 'G2-SUPPORT')).toMatchObject({ status: 'UNAVAILABLE' })
  expect(result.engineering.find(row => row.id === 'G2-CI')).toMatchObject({ status: 'PENDING' })
})

it('runs four-platform integrity without promoting unsigned consistent claims to RC acceptance', async () => {
  const f = fixture(), result = await verifyReleaseReadiness(f.artifactArgs, f.checkout, f.api)
  expect(result).toMatchObject({ decision: 'NO_GO', artifactIntegrity: { status: 'PASS', authenticated: false } })
  const rc = result.engineering.find(row => row.id === 'G2-RC')
  expect(rc?.status).toBe('UNAVAILABLE')
  expect(rc?.reason).toContain('authenticated platform execution')
})

it.each(['changed bytes', 'incomplete platforms', 'stale source'])('retains artifact failure for %s', async (kind) => {
  const f = fixture()
  if (kind === 'changed bytes') writeFileSync(join(f.artifacts, f.manifest.platforms[0]!.artifacts[0]!.path), 'changed fixture bytes')
  if (kind === 'incomplete platforms') f.manifest.platforms.pop()
  if (kind === 'stale source') f.manifest.sourceSha = 'a'.repeat(40)
  writeFileSync(f.manifestPath, JSON.stringify(f.manifest))
  const result = await verifyReleaseReadiness(f.artifactArgs, f.checkout, f.api)
  expect(result.artifactIntegrity.status).toBe('FAIL')
  expect(result.engineering.find(row => row.id === 'G2-RC')?.status).toBe('FAIL')
})

it.each(['remote source', 'transport', 'changed workflow'])('rejects %s verification without retaining remote payloads', async (kind) => {
  const f = fixture(), json = f.api.json
  f.api.json = async (endpoint) => {
    if (kind === 'transport') throw new Error('private fixture response')
    if (kind === 'remote source' && endpoint.includes('/git/commits/')) return { sha: f.sha, tree: { sha: 'b'.repeat(40) }, parents: [] }
    if (kind === 'changed workflow' && endpoint.includes('/contents/')) {
      const row = await json(endpoint) as { content: string }
      return { ...row, content: Buffer.from(Buffer.from(row.content, 'base64').toString('utf8') + '\n# changed\n').toString('base64') }
    }
    return json(endpoint)
  }
  const result = await verifyReleaseReadiness(f.args, f.checkout, f.api)
  expect(result).toMatchObject({ decision: 'NO_GO', ci: null })
  expect(result.engineering.find(row => row.id === 'G2-CI')?.status).toBe('FAIL')
  expect(JSON.stringify(result)).not.toContain('private fixture response')
})

it.each(['wrong SHA', 'dirty checkout', 'changed during collection'])('rejects a %s', async (kind) => {
  const f = fixture(), json = f.api.json
  if (kind === 'wrong SHA') f.args[3] = 'f'.repeat(40)
  if (kind === 'dirty checkout') writeFileSync(join(f.checkout, 'untracked'), 'fixture')
  if (kind === 'changed during collection') f.api.json = async (endpoint) => {
    writeFileSync(join(f.checkout, 'untracked'), 'fixture')
    return json(endpoint)
  }
  await expect(verifyReleaseReadiness(f.args, f.checkout, f.api)).rejects.toThrow('clean checkout')
})

it('rejects verdict files, manual waivers and incomplete artifact arguments', async () => {
  const f = fixture()
  for (const extra of [['--evidence', f.manifestPath], ['--waive', 'G2-SUPPORT'], ['--root', f.artifacts]]) {
    await expect(verifyReleaseReadiness([...f.args, ...extra], f.checkout, f.api)).rejects.toThrow()
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', join(repository, 'scripts/verify-release-readiness.ts'), '--waive', 'G2-CI'], {
    cwd: repository, encoding: 'utf8',
  })
  expect(result.status).toBe(1)
  expect(JSON.parse(result.stdout)).toMatchObject({ decision: 'NO_GO', publicationAuthorized: false })
})

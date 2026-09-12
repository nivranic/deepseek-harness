/** Real CLI rejection stages retain source and file checks without echoing rejected input. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { readProductIdentity, writeProductIdentity } from './release/product-files.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const roots: string[] = []
const entry = fileURLToPath(new URL('./collect-product-diagnostics.ts', import.meta.url))
const loader = import.meta.resolve('tsx/esm')
const privateInput = 'synthetic-private-diagnostic-input'
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSafely(root) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-diagnostic-cli-'))
  roots.push(root)
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'empty-global'), GIT_CONFIG_NOSYSTEM: '1',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'pull_request' }
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '--quiet', '--initial-branch=main'])
  git(['config', 'user.name', 'Diagnostic Fixture']); git(['config', 'user.email', 'diagnostic@example.test'])
  for (const name of ['.github/workflows', 'release', 'output']) mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, '.gitignore'), '/output/\n')
  writeFileSync(join(root, '.github/workflows/windows-candidate.yml'), 'name: Fixture\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.2-alpha.1' }))
  writeFileSync(join(root, 'release/product.json'), JSON.stringify({ schemaVersion: 1, buildNumber: 1, channel: 'dev' }))
  writeProductIdentity(root, readProductIdentity(root))
  writeFileSync(join(root, 'output/installer-crash.json'), JSON.stringify({ schemaVersion: 1,
    scope: 'windows-installer-crash-diagnostic', queryState: 'queried', malformedRecords: 0, records: [] }))
  const commit = () => {
    git(['add', '.']); git(['commit', '--quiet', '-m', 'fixture'])
    env.DSH_RC_SOURCE_SHA = git(['rev-parse', 'HEAD'])
  }
  commit()
  const run = (args = ['--platform', 'windows', '--directory', join(root, 'output'), '--max-input-bytes', '4194304']) =>
    spawnSync(process.execPath, ['--import', loader, entry, ...args], { cwd: root, env, encoding: 'utf8', timeout: 10000 })
  return { root, env, run, commit }
}

it.each(['arguments', 'source-metadata', 'source-clean', 'source-candidate', 'product-identity', 'product-freshness', 'native-report'])(
  'reports only the fixed %s failure stage and preserves rejection', (stage) => {
    const { root, env, run, commit } = fixture()
    switch (stage) {
      case 'source-metadata': env.GITHUB_RUN_ID = privateInput; break
      case 'source-clean': writeFileSync(join(root, privateInput), 'dirty'); break
      case 'source-candidate': env.DSH_RC_SOURCE_SHA = 'a'.repeat(40); break
      case 'product-identity': writeFileSync(join(root, 'release/product.json'), privateInput); commit(); break
      case 'product-freshness':
        writeFileSync(join(root, 'release/product.json'), JSON.stringify({ schemaVersion: 1, buildNumber: 2, channel: 'dev' }))
        commit(); break
      case 'native-report': writeFileSync(join(root, 'output/installer-crash.json'), privateInput); break
    }
    const result = stage === 'arguments' ? run(['--unknown-' + privateInput]) : run()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(`product diagnostic collection failed: ${stage}`)
    expect(() => readFileSync(join(root, 'output/product-diagnostics.json'))).toThrow()
  },
)

it('writes a clean candidate projection silently and refuses to replace its bytes', () => {
  const { root, env, run } = fixture()
  const result = run()
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stdout + result.stderr).toBe('')
  const bytes = readFileSync(join(root, 'output/product-diagnostics.json'), 'utf8')
  expect(JSON.parse(bytes)).toMatchObject({ sourceSha: env.DSH_RC_SOURCE_SHA, status: 'NO_REPORT', collectionErrors: 0, errors: [] })
  const rejected = run()
  expect(rejected.status).toBe(1)
  expect(rejected.stderr.trim()).toBe('product diagnostic collection failed: native-report')
  expect(readFileSync(join(root, 'output/product-diagnostics.json'), 'utf8')).toBe(bytes)
})

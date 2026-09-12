/** Workflow dependency and token-permission acceptance, including the CI entry point. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectWorkflowSecurity, readLocalActions } from './workflow-security.ts'

const sha = 'a'.repeat(40)
const pins = { schemaVersion: 1, pins: [{ action: 'actions/checkout', sha, requestedRef: 'v6', repository: 'actions/checkout' }] }
const policy = { schemaVersion: 1, requiredWorkflows: ['ci.yml'], writableJobs: {} }
const valid = `on: pull_request
permissions: { contents: read }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${sha}
        with: { persist-credentials: false }
`
const inspect = (value: string, customPolicy: unknown = policy): string[] => inspectWorkflowSecurity(new Map([['ci.yml', value]]), pins, customPolicy)

describe('workflow security', () => {
  it('accepts a recorded immutable action with read-only permissions', () => {
    expect(inspect(valid)).toEqual([])
  })
  it.each(['v6', 'a'.repeat(7), 'b'.repeat(40)])('rejects unrecorded revision %s', (revision) => {
    expect(inspect(valid.replace(sha, revision)).join('\n')).toContain('action revision')
  })
  it('rejects checkout credential persistence', () => {
    expect(inspect(valid.replace('persist-credentials: false', 'persist-credentials: true')).join('\n')).toContain('persist-credentials')
  })
  it.each(['', 'permissions: write-all\n', 'permissions: { contents: write }\n'])(
    'rejects unsafe workflow default %s', (permissions) => {
      expect(inspect(valid.replace('permissions: { contents: read }\n', permissions)).join('\n')).toContain('permissions')
    },
  )
  it('rejects an unrecorded writable job', () => {
    expect(inspect(valid.replace('runs-on:', 'permissions: { issues: write }\n    runs-on:')).join('\n')).toContain('writable job')
  })
  it('checks the exact permissions and environment of a writable job', () => {
    const customPolicy = { ...policy, writableJobs: {
      'ci.yml#build': { permissions: ['id-token'], environment: 'release-test', reason: 'Fixture-only publisher' },
    } }
    const publisher = valid.replace('runs-on:', 'permissions: { id-token: write }\n    environment: release-test\n    runs-on:')
    expect(inspect(publisher, customPolicy)).toEqual([])
    expect(inspect(publisher.replace('release-test', 'another'), customPolicy).join('\n')).toContain('environment')
    expect(inspect(publisher.replace('id-token: write', 'contents: write'), customPolicy).join('\n')).toContain('writable job')
    expect(inspect(valid, customPolicy).join('\n')).toContain('unused writable job')
  })
  it('accepts an existing local reusable workflow and checks its own contents', () => {
    const caller = 'permissions: {}\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n'
    const files = new Map([['ci.yml', caller], ['reusable.yml', valid]])
    expect(inspectWorkflowSecurity(files, pins, policy)).toEqual([])
    files.delete('reusable.yml')
    expect(inspectWorkflowSecurity(files, pins, policy).join('\n')).toContain('local workflow')
  })
  it('checks external reusable workflow revisions as well as step actions', () => {
    const external = 'permissions: {}\njobs:\n  call:\n    uses: owner/repo/.github/workflows/reuse.yml@main\n'
    expect(inspect(external).join('\n')).toContain('action revision')
  })
  it('checks nested local composite dependencies and checkout credentials', () => {
    const caller = 'permissions: {}\njobs:\n  build:\n    steps:\n      - uses: ./.github/actions/wrapper\n'
    const wrapper = 'runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/nested\n'
    const nested = `runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@${sha}\n      with: { persist-credentials: false }\n`
    const actions = new Map([['./.github/actions/wrapper', wrapper], ['./.github/actions/nested', nested]])
    const check = (): string[] => inspectWorkflowSecurity(new Map([['ci.yml', caller]]), pins, policy, actions)
    expect(check()).toEqual([])
    actions.set('./.github/actions/nested', nested.replace(sha, 'v6'))
    expect(check().join('\n')).toContain('action revision')
    actions.set('./.github/actions/nested', nested.replace('persist-credentials: false', 'persist-credentials: true'))
    expect(check().join('\n')).toContain('persist-credentials')
    actions.set('./.github/actions/nested', wrapper.replace('/nested', '/wrapper'))
    expect(check().join('\n')).toContain('cycle')
    actions.delete('./.github/actions/nested')
    expect(check().join('\n')).toContain('missing or outside')
  })
  it('rejects local Action escapes, unsupported manifests and invalid composite steps', () => {
    const files = new Map([['ci.yml', valid]])
    const shell = 'runs:\n  using: composite\n  steps:\n    - run: echo fixture\n      shell: bash\n'
    expect(inspectWorkflowSecurity(files, pins, policy, new Map([['./.github/actions/a', shell]]))).toEqual([])
    for (const [reference, manifest] of [
      ['./.github/actions/../outside', shell], ['./other/action', shell],
      ['./.github/actions/a', 'runs: [broken'], ['./.github/actions/a', 'runs: { using: node24, main: index.js }'],
      ['./.github/actions/a', 'runs: { using: composite, steps: [] }'],
      ['./.github/actions/a', shell.replace('      shell: bash\n', '')],
      ['./.github/actions/a', shell.replace('    - run: echo fixture', '    - unexpected: value')],
    ]) {
      expect(inspectWorkflowSecurity(files, pins, policy, new Map([[reference!, manifest!]]))).not.toEqual([])
    }
    const job = 'permissions: {}\njobs:\n  build:\n    uses: ./.github/actions/a\n'
    expect(inspectWorkflowSecurity(new Map([['ci.yml', job]]), pins, policy, new Map([['./.github/actions/a', shell]])).join('\n')).toContain('local workflow')
  })
  it('refuses duplicate local manifests and linked Action directories', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-local-action-'))
    const directory = join(fixture, '.github/actions/a')
    try {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'action.yml'), 'name: fixture')
      expect([...readLocalActions(fixture)]).toEqual([['./.github/actions/a', 'name: fixture']])
      writeFileSync(join(directory, 'action.yaml'), 'name: duplicate')
      expect(() => readLocalActions(fixture)).toThrow('one regular manifest')
      rmSync(join(directory, 'action.yaml'))
      symlinkSync(directory, join(fixture, '.github/actions/link'), process.platform === 'win32' ? 'junction' : 'dir')
      expect(() => readLocalActions(fixture)).toThrow('links')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
  it('rejects narrowed and malformed workflow corpora', () => {
    expect(inspectWorkflowSecurity(new Map(), pins, policy).join('\n')).toContain('required workflow')
    expect(inspect('jobs: [broken').join('\n')).toContain('YAML')
    expect(inspect('jobs: {}\npermissions: {}').join('\n')).toContain('jobs')
    expect(inspect(valid.replace('uses:', 'uses: [')).join('\n')).toContain('YAML')
  })
  it('rejects malformed policy and upstream-owner mismatches', () => {
    expect(() => inspect(valid, {})).toThrow('policy')
    expect(() => inspectWorkflowSecurity(new Map([['ci.yml', valid]]), {
      ...pins, pins: [{ ...pins.pins[0], repository: 'different/repo' }],
    }, policy)).toThrow('pin')
  })
  it('makes the executable verifier fail for a mutable action', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-workflow-security-'))
    const write = (path: string, data: string): void => {
      mkdirSync(dirname(join(fixture, path)), { recursive: true })
      writeFileSync(join(fixture, path), data)
    }
    try {
      write('.github/workflows/ci.yml', valid.replace(sha, 'v6'))
      write('release/action-pins.json', JSON.stringify(pins))
      write('release/workflow-security.json', JSON.stringify(policy))
      const invoke = (): ReturnType<typeof spawnSync> => spawnSync(process.execPath,
        ['--import', 'tsx/esm', resolve('scripts/verify-workflow-security.ts'), fixture], { encoding: 'utf8' })
      const rejected = invoke()
      expect(rejected.status).toBe(1)
      expect(String(rejected.stderr)).toContain('action revision must match a recorded upstream commit SHA')
      write('.github/workflows/ci.yml', valid)
      const accepted = invoke()
      expect(accepted.status).toBe(0)
      expect(String(accepted.stdout)).toContain('1 workflows satisfy action and permission policy')
      write('.github/workflows/ci.yml', 'permissions: {}\njobs:\n  build:\n    steps:\n      - uses: ./.github/actions/local\n')
      const action = `runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@${sha}\n      with: { persist-credentials: false }\n`
      write('.github/actions/local/action.yml', action)
      expect(invoke().status).toBe(0)
      write('.github/actions/local/action.yml', action.replace(sha, 'v6'))
      const nestedRejected = invoke()
      expect(nestedRejected.status).toBe(1)
      expect(String(nestedRejected.stderr)).toContain('action revision must match a recorded upstream commit SHA')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

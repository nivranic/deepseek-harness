/** Workflow dependency and token-permission acceptance, including the CI entry point. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectWorkflowSecurity } from './workflow-security.ts'

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
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})

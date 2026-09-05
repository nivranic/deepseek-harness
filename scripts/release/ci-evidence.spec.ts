/** Candidate evidence binds required workflow verdicts to actual checkout receipts. */
import { describe, expect, it } from 'vitest'
import { deriveRequiredChecks, evaluateCandidateChecks } from './ci-evidence.ts'

const sha = 'a'.repeat(40), tree = 'b'.repeat(40), merge = 'c'.repeat(40)
const definitions = new Map([
  ['.github/workflows/ci.yml', `name: CI
jobs:
  node-24: { name: static }
  tests: { name: tests }
  all-checks-passed:
    name: all checks passed
    needs: [node-24, tests]
    if: always() && github.event_name == 'pull_request'
`],
  ['.github/workflows/apple-swift.yml', 'name: Apple Swift\njobs:\n  swift-test: { name: swift test (macOS) }\n'],
  ['.github/workflows/android-kotlin.yml', 'name: Android Kotlin\njobs:\n  gradle-test: { name: gradle test (core) }\n'],
])
const policy = deriveRequiredChecks(definitions)
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('required fixture value is absent')
  return value
}
const successful = () => policy.workflows.map((required, index) => ({
  run: { id: index + 1, run_attempt: 2, head_sha: sha, path: required.path, event: 'pull_request', status: 'completed', conclusion: 'success' },
  jobs: required.sourceJob === required.requiredJob ? [
    { id: 10 + index, name: required.requiredJob, run_attempt: 1, status: 'completed', conclusion: 'success' },
  ] : [
    { id: 10 + index, name: required.requiredJob, run_attempt: 2, status: 'completed', conclusion: 'success' },
    { id: 20 + index, name: required.sourceJob, run_attempt: 1, status: 'completed', conclusion: 'success' },
  ],
  source: {
    schemaVersion: 1, workflow: required.path, workflowSha256: required.workflowSha256, runId: index + 1, runAttempt: 1, event: 'pull_request',
    candidateSha: sha, checkoutSha: merge, treeSha: tree, parents: ['d'.repeat(40), sha], dirty: false,
  },
}))

describe('candidate CI evidence', () => {
  it('derives the aggregate and its dependency IDs from workflow source', () => {
    expect(policy.workflows[0]).toMatchObject({ requiredJob: 'all checks passed', sourceJob: 'static', aggregateNeeds: ['node-24', 'tests'] })
    expect(policy.workflows.map(row => row.path)).toEqual([...definitions.keys()])
    expect(policy.workflows.every(row => /^[a-f0-9]{64}$/.test(row.workflowSha256))).toBe(true)
  })
  it('refuses a missing dependency or non-always CI aggregate', () => {
    const broken = new Map(definitions)
    broken.set('.github/workflows/ci.yml', required(definitions.get('.github/workflows/ci.yml')).replace('node-24, tests', 'node-24, absent'))
    expect(() => deriveRequiredChecks(broken)).toThrow('absent')
    broken.set('.github/workflows/ci.yml', required(definitions.get('.github/workflows/ci.yml')).replace('always()', 'success()'))
    expect(() => deriveRequiredChecks(broken)).toThrow('always')
  })
  it('accepts one candidate tree and records actual merge execution', () => {
    const result = evaluateCandidateChecks(policy, sha, tree, successful())
    expect(result.status).toBe('PASS')
    expect(result.executionSha).toBe(merge)
    expect(result.treeSha).toBe(tree)
  })
  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out'])('refuses required conclusion %s', (conclusion) => {
    const runs = successful()
    required(required(runs[1]).jobs[0]).conclusion = conclusion
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
  })
  it('keeps an in-progress required job pending', () => {
    const runs = successful()
    required(required(runs[2]).jobs[0]).status = 'in_progress'
    required(required(runs[2]).jobs[0]).conclusion = ''
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('PENDING')
  })
  it('rejects a missing job in a completed run instead of accepting the workflow conclusion', () => {
    const runs = successful()
    required(runs[1]).jobs = []
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
  })
  it('reports missing workflows as pending', () => {
    expect(evaluateCandidateChecks(policy, sha, tree, successful().slice(0, 2)).status).toBe('PENDING')
  })
  it('does not allow a previous successful run to hide the latest failure', () => {
    const runs = successful()
    const failed = structuredClone(required(runs[0]))
    failed.run.id = 100
    failed.source.runId = 100
    required(failed.jobs[0]).conclusion = 'failure'
    expect(evaluateCandidateChecks(policy, sha, tree, [...runs, failed]).status).toBe('FAIL')
  })
  it('reports independent Windows failure without overriding the successful mandatory aggregate', () => {
    const runs = successful()
    required(runs[0]).run.conclusion = 'failure'
    required(runs[0]).jobs.push({ id: 50, name: 'windows coverage', run_attempt: 2, status: 'completed', conclusion: 'failure' })
    const result = evaluateCandidateChecks(policy, sha, tree, runs)
    expect(result.status).toBe('PASS')
    expect(required(result.workflows[0]).observations).toContainEqual({ name: 'windows coverage', status: 'completed', conclusion: 'failure' })
  })
  it.each(['candidateSha', 'checkoutSha', 'treeSha'])('refuses mismatched source receipt %s', (field) => {
    const runs = successful()
    Object.assign(required(runs[1]).source, { [field]: 'f'.repeat(40) })
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
  })
  it('rejects an unrelated merge and a dirty checkout', () => {
    const unrelated = successful()
    required(unrelated[1]).source.parents = []
    expect(evaluateCandidateChecks(policy, sha, tree, unrelated).status).toBe('FAIL')
    const dirty = successful()
    required(dirty[1]).source.dirty = true
    expect(evaluateCandidateChecks(policy, sha, tree, dirty).status).toBe('FAIL')
  })
  it('ties source evidence to the producer job attempt, even after another job is retried', () => {
    expect(evaluateCandidateChecks(policy, sha, tree, successful()).status).toBe('PASS')
    const runs = successful()
    required(runs[1]).source.runAttempt = 2
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
  })
  it('rejects duplicate run attempts and jobs from a future attempt', () => {
    const runs = successful()
    expect(() => evaluateCandidateChecks(policy, sha, tree, [...runs, required(runs[0])])).toThrow('duplicate')
    required(required(runs[0]).jobs[0]).run_attempt = 3
    expect(() => evaluateCandidateChecks(policy, sha, tree, runs)).toThrow('job attempt')
  })
  it('does not accept an ordinary child commit as a PR merge', () => {
    const runs = successful()
    required(runs[0]).source.parents = [sha]
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
  })
  it('rejects absent source evidence and a run for another source or event', () => {
    const missing = successful().map(row => ({ ...row, source: undefined }))
    expect(evaluateCandidateChecks(policy, sha, tree, missing).status).toBe('FAIL')
    const runs = successful()
    required(runs[0]).run.head_sha = 'e'.repeat(40)
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
    required(runs[0]).run.head_sha = sha
    required(runs[0]).run.event = 'workflow_dispatch'
    expect(evaluateCandidateChecks(policy, sha, tree, runs).status).toBe('FAIL')
  })
})

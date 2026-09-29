/** GitHub collection rejects stale, mismatched, and incomplete candidate evidence. */
import { expect, it } from 'vitest'
import { deriveRequiredChecks } from './ci-evidence.ts'
import { collectCandidateChecks, type CiGithub } from './ci-collector.ts'

const sha = 'a'.repeat(40), tree = 'b'.repeat(40), merge = 'c'.repeat(40), base = 'd'.repeat(40)
const repository = 'owner/repository', prefix = `repos/${repository}`
const files = new Map([
  ['.github/workflows/ci.yml', 'name: CI\njobs:\n  node-24: {name: static}\n  all-checks-passed:\n    name: all checks passed\n    needs: [node-24]\n    if: always()\n'],
  ['.github/workflows/apple-swift.yml', 'name: Apple\njobs:\n  swift-test: {name: swift}\n'],
  ['.github/workflows/android-kotlin.yml', 'name: Android\njobs:\n  gradle-test: {name: gradle}\n'],
])
const policy = deriveRequiredChecks(files)
const start = '2026-09-05T12:00:00Z', end = '2026-09-05T12:05:00Z'
function fixture() {
  const data = new Map<string, unknown>(), reads = new Map<string, number>()
  const sources = new Map<string, object>()
  const workflows = policy.workflows.map((owner, index) => {
    const id = index + 1
    const run = { id, run_attempt: 2, head_sha: sha, path: owner.path, event: 'pull_request', status: 'completed', conclusion: 'failure' }
    const producer = { id: id * 10, name: owner.sourceJob, run_attempt: 2, status: 'completed', conclusion: 'success',
      runner_id: 123, started_at: start, completed_at: end,
      steps: [{ number: 1, name: 'Record source', started_at: start, completed_at: end, status: 'completed', conclusion: 'success' }] }
    const jobs = [producer, ...(owner.sourceJob === owner.requiredJob ? [] : [
      { ...producer, id: id * 10 + 1, name: owner.requiredJob },
      { ...producer, id: id * 10 + 2, name: 'independent Windows coverage', conclusion: 'failure' },
    ])]
    const source = { schemaVersion: 1, workflow: owner.path, workflowSha256: owner.workflowSha256, runId: id, runAttempt: 1,
      event: 'pull_request', candidateSha: sha, checkoutSha: merge, treeSha: tree, parents: [base, sha], dirty: false }
    const artifact = { id: id * 100, name: `ci-source-${id}-1`, digest: `sha256:${'e'.repeat(64)}`, expired: false, size_in_bytes: 800,
      workflow_run: { id, head_sha: sha } }
    const listPath = `${prefix}/actions/workflows/${owner.path.split('/').at(-1)}/runs?head_sha=${sha}&event=pull_request`
    data.set(`${listPath}&per_page=100&page=1`, { total_count: 1, workflow_runs: [run] })
    data.set(`${prefix}/actions/runs/${id}`, run)
    const jobsPath = `${prefix}/actions/runs/${id}/jobs?filter=latest&per_page=100&page=1`
    data.set(jobsPath, { total_count: jobs.length, jobs })
    data.set(`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100&page=1`, { total_count: 1, jobs: [{ ...producer, id: id * 10 + 5, run_attempt: 1 }] })
    const artifactsPath = `${prefix}/actions/runs/${id}/artifacts?per_page=100&page=1`
    data.set(artifactsPath, { total_count: 1, artifacts: [artifact] })
    data.set(`${prefix}/actions/artifacts/${artifact.id}`, artifact)
    sources.set(artifact.name, source)
    return { owner, run, jobs, producer, artifact, source, listPath, jobsPath, artifactsPath }
  })
  const candidate = { sha, tree: { sha: tree }, parents: [{ sha: base }] }
  const actual = { sha: merge, tree: { sha: tree }, parents: [{ sha: base }, { sha }] }
  data.set(`${prefix}/git/commits/${sha}`, candidate)
  data.set(`${prefix}/git/commits/${merge}`, actual)
  for (const [path, content] of files) data.set(`${prefix}/contents/${path}?ref=${sha}`, { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') })
  const api: CiGithub = {
    async json(endpoint) {
      reads.set(endpoint, (reads.get(endpoint) ?? 0) + 1)
      if (!data.has(endpoint)) throw new Error(`unexpected fixture endpoint: ${endpoint}`)
      return structuredClone(data.get(endpoint))
    },
    async source(_repository, _runId, name) {
      return Buffer.from(JSON.stringify(sources.get(name)))
    },
  }
  return { api, data, reads, workflows, candidate, actual, first: workflows[0]! }
}

it('verifies real execution identity of copied jobs and keeps independent failures visible', async () => {
  const { api } = fixture()
  const result = await collectCandidateChecks(api, repository, sha)
  expect(result).toMatchObject({ status: 'PASS', candidateSha: sha, treeSha: tree, executionSha: merge })
  expect(result.collection[0]?.producer).toMatchObject({ executionAttempt: 1, originalJobId: 15,
    copies: [{ jobId: 10, reportedAttempt: 2 }, { jobId: 15, reportedAttempt: 1 }] })
  expect(result.workflows[0]?.observations).toContainEqual({ name: 'independent Windows coverage', status: 'completed', conclusion: 'failure' })
})

it('paginates runs, jobs, and artifacts before choosing the newest evidence', async () => {
  const { api, data, first, reads } = fixture()
  const runPage = `${first.listPath}&per_page=100&page=1`
  data.set(runPage, { total_count: 2, workflow_runs: [{ ...first.run, id: 99 }] })
  first.run.id = 100
  // Keep the selected run's existing endpoints; the newer run is deliberately on page two.
  for (const [key, value] of [...data]) {
    if (key.includes('/runs/1')) data.set(key.replace('/runs/1', '/runs/100'), value)
  }
  first.source.runId = 100
  first.artifact.workflow_run.id = 100
  first.artifact.name = 'ci-source-100-1'
  const source = api.source
  api.source = (repo, runId, name) => source(repo, runId, name === 'ci-source-100-1' ? 'ci-source-1-1' : name)
  data.set(`${first.listPath}&per_page=100&page=2`, { total_count: 2, workflow_runs: [first.run] })
  const jobsPath = first.jobsPath.replace('/runs/1', '/runs/100')
  data.set(jobsPath, { total_count: first.jobs.length, jobs: first.jobs.slice(0, 1) })
  data.set(jobsPath.replace(/page=1$/, 'page=2'), { total_count: first.jobs.length, jobs: first.jobs.slice(1) })
  const artifactsPath = first.artifactsPath.replace('/runs/1', '/runs/100')
  data.set(artifactsPath, { total_count: 2, artifacts: [{ id: 999, name: 'unrelated' }] })
  data.set(artifactsPath.replace(/page=1$/, 'page=2'), { total_count: 2, artifacts: [first.artifact] })
  expect((await collectCandidateChecks(api, repository, sha)).status).toBe('PASS')
  expect(reads.get(`${first.listPath}&per_page=100&page=2`)).toBe(2)
})

it.each(['new run', 'new attempt', 'changed job', 'changed artifact'])('refuses %s appearing during collection', async (kind) => {
  const { api, reads, first } = fixture(), json = api.json
  api.json = async (endpoint) => {
    const result = await json(endpoint)
    if (kind === 'new run' && endpoint === `${first.listPath}&per_page=100&page=1` && reads.get(endpoint) === 2) {
      return { total_count: 1, workflow_runs: [{ ...first.run, id: 99 }] }
    }
    if (kind === 'new attempt' && endpoint === `${prefix}/actions/runs/1`) return { ...first.run, run_attempt: 3 }
    if (kind === 'changed job' && endpoint === first.jobsPath && reads.get(endpoint) === 2) {
      return { total_count: first.jobs.length, jobs: first.jobs.map(job => ({ ...job, conclusion: 'failure' })) }
    }
    if (kind === 'changed artifact' && endpoint === `${prefix}/actions/artifacts/100`) return { ...first.artifact, digest: `sha256:${'f'.repeat(64)}` }
    return result
  }
  await expect(collectCandidateChecks(api, repository, sha)).rejects.toThrow(/changed/)
})

it.each(['empty page', 'changed total', 'duplicate', 'search cap'])('rejects %s instead of accepting a partial search', async (kind) => {
  const { api, data, first } = fixture()
  data.set(`${first.listPath}&per_page=100&page=1`, { total_count: kind === 'search cap' ? 1001 : 2, workflow_runs: [first.run] })
  data.set(`${first.listPath}&per_page=100&page=2`, { total_count: kind === 'changed total' ? 3 : 2, workflow_runs: kind === 'duplicate' ? [first.run] : [] })
  await expect(collectCandidateChecks(api, repository, sha)).rejects.toThrow(/pagination|duplicate|changed|limit/)
})

it.each(['failure', 'cancelled', 'skipped'])('fails a %s required verdict', async (conclusion) => {
  const { api, first } = fixture()
  first.jobs[1]!.conclusion = conclusion
  expect((await collectCandidateChecks(api, repository, sha)).status).toBe('FAIL')
})

it('leaves missing workflows and unfinished producers pending', async () => {
  const { api, first, data } = fixture()
  data.set(`${first.listPath}&per_page=100&page=1`, { total_count: 0, workflow_runs: [] })
  expect((await collectCandidateChecks(api, repository, sha)).status).toBe('PENDING')
  data.set(`${first.listPath}&per_page=100&page=1`, { total_count: 1, workflow_runs: [first.run] })
  first.producer.status = 'in_progress'
  expect((await collectCandidateChecks(api, repository, sha)).status).toBe('PENDING')
})

it.each(['tree', 'parents'])('independently rejects uploaded Git %s metadata', async (field) => {
  const { api, actual } = fixture()
  if (field === 'tree') actual.tree.sha = 'f'.repeat(40)
  else actual.parents = [{ sha: base }]
  await expect(collectCandidateChecks(api, repository, sha)).rejects.toThrow('Git commit API')
})

it.each(['dirty', 'digest', 'candidate', 'execution', 'future attempt'])('rejects a source with mismatched %s', async (field) => {
  const { api, first } = fixture()
  if (field === 'dirty') first.source.dirty = true
  if (field === 'digest') first.source.workflowSha256 = 'f'.repeat(64)
  if (field === 'candidate') first.source.candidateSha = base
  if (field === 'execution') first.source.runAttempt = 2
  if (field === 'future attempt') first.source.runAttempt = 3
  expect((await collectCandidateChecks(api, repository, sha)).status).toBe('FAIL')
})

it.each(['expired', 'missing', 'other run', 're-executed producer'])('rejects %s artifact evidence', async (kind) => {
  const { api, first, data } = fixture()
  if (kind === 'expired') first.artifact.expired = true
  if (kind === 'missing') data.set(first.artifactsPath, { total_count: 0, artifacts: [] })
  if (kind === 'other run') first.artifact.workflow_run.id = 999
  if (kind === 're-executed producer') first.producer.started_at = '2026-09-05T13:00:00Z'
  await expect(collectCandidateChecks(api, repository, sha)).rejects.toThrow(/artifact/)
})

it('rejects mutable candidate inputs before contacting GitHub', async () => {
  const { api, reads } = fixture()
  await expect(collectCandidateChecks(api, repository, 'dev')).rejects.toThrow('Git SHA')
  await expect(collectCandidateChecks(api, '../owner/repository', sha)).rejects.toThrow('owner/repository')
  expect(reads.size).toBe(0)
})

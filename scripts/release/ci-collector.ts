/** Read-only GitHub collection with source verification and a final freshness check. */
import { createHash } from 'node:crypto'
import {
  deriveRequiredChecks, evaluateCandidateChecks, parseCiJob, parseCiRun, parseCiSourceReceipt,
  type CiJob, type CiRun, type RequiredChecks,
} from './ci-evidence.ts'

/** GitHub transport; downloaded receipt bytes must come from the selected run artifact. */
export interface CiGithub {
  /**
   * Read a repository-scoped GitHub REST endpoint.
   * @param endpoint - Relative REST path, including query parameters.
   * @returns Parsed response JSON; transport failures reject.
   */
  json(this: void, endpoint: string): Promise<unknown>
  /**
   * Download the source receipt from the uniquely selected artifact.
   * @param repository - Validated owner/repository.
   * @param runId - Owning workflow run.
   * @param name - Exact immutable source artifact name.
   * @returns The sole source.json file's bytes; unexpected archive entries reject.
   */
  source(this: void, repository: string, runId: number, name: string): Promise<Uint8Array>
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function gitSha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('expected full Git SHA')
  return value
}

function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('expected positive integer')
  return value
}

async function pages(api: CiGithub, endpoint: string, key: string): Promise<unknown[]> {
  const rows: unknown[] = []
  let expected: number | undefined
  for (let page = 1; ; page++) {
    const response = object(await api.json(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`), key)
    const count = response.total_count
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error(`invalid ${key} total_count`)
    // GitHub caps filtered workflow-run searches at 1,000 results.
    if (key === 'workflow_runs' && count > 1000) throw new Error('workflow run search exceeds GitHub result limit')
    if (expected !== undefined && expected !== count) throw new Error(`${key} changed during pagination; collect again`)
    expected = count
    const batch = response[key]
    if (!Array.isArray(batch) || batch.length > 100) throw new Error(`invalid ${key} page`)
    rows.push(...batch as unknown[])
    if (rows.length > count || (rows.length < count && batch.length === 0)) throw new Error(`incomplete ${key} pagination`)
    if (rows.length === count) break
  }
  const ids = rows.map(row => positive(object(row, key).id))
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${key} entry`)
  return rows
}

async function commit(api: CiGithub, prefix: string, sha: string) {
  const row = object(await api.json(`${prefix}/git/commits/${sha}`), 'Git commit')
  if (gitSha(row.sha) !== sha || !Array.isArray(row.parents)) throw new Error('Git commit identity mismatch')
  return { sha, tree: gitSha(object(row.tree, 'Git tree').sha), parents: row.parents.map(parent => gitSha(object(parent, 'Git parent').sha)) }
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('completed producer requires execution timestamps')
  }
  return value
}

function execution(input: unknown): string {
  const row = object(input, 'producer execution'), job = parseCiJob(row)
  if (job.status !== 'completed' || job.conclusion !== 'success' || !Array.isArray(row.steps) || row.steps.length === 0) {
    throw new Error('source producer has no successful execution')
  }
  return JSON.stringify({ name: job.name, status: job.status, conclusion: job.conclusion,
    runnerId: positive(row.runner_id), startedAt: timestamp(row.started_at), completedAt: timestamp(row.completed_at),
    steps: row.steps.map((value) => {
      const step = object(value, 'producer step')
      if (typeof step.name !== 'string' || step.status !== 'completed' || typeof step.conclusion !== 'string') {
        throw new Error('invalid producer step')
      }
      return { number: positive(step.number), name: step.name, status: step.status, conclusion: step.conclusion,
        startedAt: timestamp(step.started_at), completedAt: timestamp(step.completed_at) }
    }) })
}

async function resolveProducer(api: CiGithub, prefix: string, run: CiRun, raw: unknown) {
  const current = parseCiJob(raw), signature = execution(raw)
  let original = current
  const copies: Array<{ jobId: number; reportedAttempt: number }> = [{ jobId: current.id, reportedAttempt: current.run_attempt }]
  for (let attempt = current.run_attempt - 1; attempt >= 1; attempt--) {
    const historical = await pages(api, `${prefix}/actions/runs/${run.id}/attempts/${attempt}/jobs`, 'jobs')
    const matches = historical.filter(row => parseCiJob(row).name === current.name)
    if (matches.length !== 1) throw new Error('cannot resolve historical source producer')
    const candidate = parseCiJob(matches[0])
    if (candidate.run_attempt !== attempt) throw new Error('historical producer attempt mismatch')
    if (candidate.status !== 'completed' || candidate.conclusion !== 'success' || execution(matches[0]) !== signature) break
    original = candidate
    copies.push({ jobId: candidate.id, reportedAttempt: candidate.run_attempt })
  }
  return { executionAttempt: original.run_attempt, originalJobId: original.id, copies,
    executionSha256: createHash('sha256').update(signature).digest('hex') }
}

function artifactMetadata(input: unknown) {
  const row = object(input, 'source artifact'), owner = object(row.workflow_run, 'artifact workflow run')
  if (typeof row.name !== 'string' || !/^ci-source-\d+-\d+$/.test(row.name)
    || typeof row.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(row.digest) || row.expired !== false) {
    throw new Error('source artifact is expired or has invalid identity/digest')
  }
  return { id: positive(row.id), name: row.name, digest: row.digest, size: positive(row.size_in_bytes),
    runId: positive(owner.id), headSha: gitSha(owner.head_sha) }
}

interface CollectedCiEvidence extends ReturnType<typeof evaluateCandidateChecks> {
  repository: string
  collectedAt: string
  policy: RequiredChecks
  collection: Array<{
    workflow: string
    producer: Awaited<ReturnType<typeof resolveProducer>> | undefined
    receipt: { artifact: ReturnType<typeof artifactMetadata>; sourceSha256: string } | undefined
  }>
}

/**
 * Collect mandatory PR verdicts with verified source metadata and separate observations.
 * @param api - Read-only GitHub API and artifact transport.
 * @param repository - GitHub owner/repository whose candidate is being verified.
 * @param candidateSha - Immutable candidate commit; branch names are rejected.
 * @returns Privacy-safe evidence; changing or unverifiable GitHub state rejects instead of yielding PASS.
 */
export async function collectCandidateChecks(api: CiGithub, repository: string, candidateSha: string): Promise<CollectedCiEvidence> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('expected GitHub owner/repository')
  gitSha(candidateSha)
  const prefix = `repos/${repository}`, candidate = await commit(api, prefix, candidateSha)
  const paths = ['.github/workflows/ci.yml', '.github/workflows/apple-swift.yml', '.github/workflows/android-kotlin.yml']
  const files = await Promise.all(paths.map(async (path) => {
    const row = object(await api.json(`${prefix}/contents/${path}?ref=${candidateSha}`), 'workflow source')
    if (row.type !== 'file' || row.encoding !== 'base64' || typeof row.content !== 'string') throw new Error('workflow source is not a file')
    return [path, Buffer.from(row.content, 'base64').toString('utf8')] as const
  }))
  const policy = deriveRequiredChecks(new Map(files))
  const newest = async (path: string): Promise<CiRun | undefined> => {
    const filename = path.split('/').at(-1)
    const rows = await pages(api, `${prefix}/actions/workflows/${filename}/runs?head_sha=${candidateSha}&event=pull_request`, 'workflow_runs')
    const runs = rows.map(parseCiRun)
    if (runs.some(run => run.path !== path || run.head_sha !== candidateSha || run.event !== 'pull_request')) throw new Error('workflow search returned another candidate or event')
    return runs.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0]
  }
  const sources = await Promise.all(policy.workflows.map(async (owner) => {
    const run = await newest(owner.path)
    if (run === undefined) return { owner, run, snapshot: undefined, receipt: undefined, producer: undefined, jobsIdentity: undefined }
    const endpoint = `${prefix}/actions/runs/${run.id}/jobs?filter=latest`
    const rawJobs = await pages(api, endpoint, 'jobs')
    const jobs = rawJobs.map(parseCiJob)
    if (jobs.some(job => job.execution_attempt !== undefined || job.run_attempt > run.run_attempt)) throw new Error('invalid GitHub job attempt')
    const jobsIdentity = JSON.stringify(jobs)
    const snapshot: { run: CiRun; jobs: CiJob[]; source?: ReturnType<typeof parseCiSourceReceipt> } = { run, jobs }
    const producers = rawJobs.filter(row => parseCiJob(row).name === owner.sourceJob)
    const selected = producers.length === 1 ? producers[0] : undefined
    if (selected === undefined || parseCiJob(selected).status !== 'completed' || parseCiJob(selected).conclusion !== 'success') {
      return { owner, run, snapshot, receipt: undefined, producer: undefined, jobsIdentity }
    }
    const producer = await resolveProducer(api, prefix, run, selected)
    const job = jobs.find(row => row.name === owner.sourceJob)
    if (job === undefined) throw new Error('source producer disappeared')
    job.execution_attempt = producer.executionAttempt
    const name = `ci-source-${run.id}-${producer.executionAttempt}`
    const artifacts = await pages(api, `${prefix}/actions/runs/${run.id}/artifacts`, 'artifacts')
    const matches = artifacts.filter(row => object(row, 'artifact').name === name)
    if (matches.length !== 1) throw new Error('source artifact missing or duplicated')
    const artifact = artifactMetadata(matches[0])
    if (artifact.runId !== run.id || artifact.headSha !== candidateSha) throw new Error('artifact belongs to another run or candidate')
    const bytes = await api.source(repository, run.id, name)
    if (bytes.length === 0 || bytes.length > 65536) throw new Error('source receipt exceeds metadata size limit')
    const source = parseCiSourceReceipt(JSON.parse(Buffer.from(bytes).toString('utf8')))
    const actual = await commit(api, prefix, source.checkoutSha)
    if (actual.tree !== source.treeSha || JSON.stringify(actual.parents) !== JSON.stringify(source.parents)) throw new Error('source receipt disagrees with Git commit API')
    snapshot.source = source
    return { owner, run, snapshot, producer, jobsIdentity,
      receipt: { artifact, sourceSha256: createHash('sha256').update(bytes).digest('hex') } }
  }))
  // No cached PASS survives a new run, a partial rerun, or an artifact replacement.
  await Promise.all(sources.map(async (row) => {
    if (JSON.stringify(await newest(row.owner.path)) !== JSON.stringify(row.run)) {
      throw new Error('latest workflow changed during collection; collect again')
    }
    if (row.run === undefined) return
    const current = parseCiRun(await api.json(`${prefix}/actions/runs/${row.run.id}`))
    const jobs = await pages(api, `${prefix}/actions/runs/${row.run.id}/jobs?filter=latest`, 'jobs')
    if (JSON.stringify(current) !== JSON.stringify(row.run) || JSON.stringify(jobs.map(parseCiJob)) !== row.jobsIdentity) {
      throw new Error('workflow jobs changed during collection; collect again')
    }
    if (row.receipt !== undefined) {
      const metadata = artifactMetadata(await api.json(`${prefix}/actions/artifacts/${row.receipt.artifact.id}`))
      if (JSON.stringify(metadata) !== JSON.stringify(row.receipt.artifact)) throw new Error('source artifact changed during collection')
    }
  }))
  const snapshots = sources.flatMap(row => row.snapshot === undefined ? [] : [row.snapshot])
  const evidence = evaluateCandidateChecks(policy, candidateSha, candidate.tree, snapshots)
  return { ...evidence, repository, collectedAt: new Date().toISOString(), policy,
    collection: sources.map(row => ({ workflow: row.owner.path, producer: row.producer, receipt: row.receipt })) }
}

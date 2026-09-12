/** Required workflow verdicts and checkout receipts for one immutable candidate. */
import { createHash } from 'node:crypto'
import { load } from 'js-yaml'

/** A required verdict and the job that records the workflow's actual checkout. */
interface RequiredWorkflow {
  path: string
  name: string
  requiredJob: string
  sourceJob: string
  workflowSha256: string
  aggregateNeeds: string[]
}

/** Source-derived check policy; the CI aggregate owns its dependent job verdicts. */
export interface RequiredChecks {
  schemaVersion: 1
  workflows: RequiredWorkflow[]
}

/** Actual Git checkout metadata recorded by the source-producing job. */
export interface CiSourceReceipt {
  schemaVersion: 1
  workflow: string
  workflowSha256: string
  runId: number
  runAttempt: number
  event: string
  candidateSha: string
  checkoutSha: string
  treeSha: string
  parents: string[]
  dirty: boolean
}

/** Required job identity and verdict, with optional collector-verified execution identity. */
export interface CiJob {
  id: number
  name: string
  run_attempt: number
  /** Original execution attempt, independently resolved for a copied GitHub job. */
  execution_attempt?: number
  status: string
  conclusion: string | null
}

/** Workflow run identity and lifecycle as returned by GitHub. */
export interface CiRun {
  id: number
  run_attempt: number
  head_sha: string
  path: string
  event: string
  status: string
  conclusion: string | null
}

/** A workflow verdict preserves independent observations without promoting them to required checks. */
interface WorkflowVerdict {
  path: string
  status: 'PASS' | 'FAIL' | 'PENDING'
  reasons: string[]
  runId?: number
  runAttempt?: number
  source?: CiSourceReceipt
  observations: Array<{ name: string; status: string; conclusion: string | null }>
}

/** Candidate acceptance requires all mandatory verdicts and one matching, clean source tree. */
interface CandidateCheckEvidence {
  schemaVersion: 1
  candidateSha: string
  treeSha: string
  executionSha?: string
  status: 'PASS' | 'FAIL' | 'PENDING'
  workflows: WorkflowVerdict[]
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function sha(value: unknown, label: string): string {
  const result = text(value, label)
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${label} must be a full Git SHA`)
  return result
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  return value
}

function conclusion(value: unknown): string | null {
  return value === null || value === '' ? null : text(value, 'conclusion')
}

/**
 * Derive stable required check names and CI dependencies from their source workflows.
 * @param files - YAML text keyed by the three canonical workflow paths.
 * @returns The deterministic required-check definition, including workflow digests.
 */
export function deriveRequiredChecks(files: ReadonlyMap<string, string>): RequiredChecks {
  const owners = [
    { path: '.github/workflows/ci.yml', required: 'all-checks-passed', source: 'node-24' },
    { path: '.github/workflows/apple-swift.yml', required: 'swift-test', source: 'swift-test' },
    { path: '.github/workflows/android-kotlin.yml', required: 'gradle-test', source: 'gradle-test' },
  ]
  return { schemaVersion: 1, workflows: owners.map(({ path, required, source }) => {
    const yaml = files.get(path)
    if (yaml === undefined) throw new Error(`required workflow missing: ${path}`)
    const workflow = object(load(yaml), path), jobs = object(workflow.jobs, `${path} jobs`)
    const requiredJob = object(jobs[required], `${path} ${required}`)
    const sourceJob = object(jobs[source], `${path} ${source}`)
    let aggregateNeeds: string[] = []
    if (required !== source) {
      if (typeof requiredJob.if !== 'string' || !requiredJob.if.includes('always()')) throw new Error('CI aggregate must run with always()')
      if (!Array.isArray(requiredJob.needs) || requiredJob.needs.length === 0) throw new Error('CI aggregate needs must be non-empty')
      aggregateNeeds = requiredJob.needs.map((id: unknown) => {
        const name = text(id, 'CI dependency')
        if (jobs[name] === undefined) throw new Error(`CI aggregate dependency missing: ${name}`)
        return name
      })
      if (new Set(aggregateNeeds).size !== aggregateNeeds.length || !aggregateNeeds.includes(source)) throw new Error('CI aggregate must include unique dependencies and its source producer')
    }
    return { path, name: text(workflow.name, 'workflow name'), requiredJob: text(requiredJob.name, 'required job name'),
      sourceJob: text(sourceJob.name, 'source job name'), workflowSha256: createHash('sha256').update(yaml).digest('hex'), aggregateNeeds }
  }) }
}

/**
 * Parse a source artifact without accepting missing source or attempt identity.
 * @param input - parsed JSON emitted by the source-producing job.
 * @returns The validated source receipt; malformed metadata throws.
 */
export function parseCiSourceReceipt(input: unknown): CiSourceReceipt {
  const row = object(input, 'source receipt')
  if (row.schemaVersion !== 1 || typeof row.dirty !== 'boolean' || !Array.isArray(row.parents)) throw new Error('unsupported source receipt schema')
  if (typeof row.workflowSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.workflowSha256)) throw new Error('source workflow digest must be SHA-256')
  return { schemaVersion: 1, workflow: text(row.workflow, 'source workflow'), workflowSha256: row.workflowSha256, runId: integer(row.runId, 'source run'),
    runAttempt: integer(row.runAttempt, 'source attempt'), event: text(row.event, 'source event'),
    candidateSha: sha(row.candidateSha, 'candidate SHA'), checkoutSha: sha(row.checkoutSha, 'checkout SHA'),
    treeSha: sha(row.treeSha, 'tree SHA'), parents: row.parents.map((parent: unknown) => sha(parent, 'parent SHA')), dirty: row.dirty }
}

/**
 * Validate the run fields used for immutable-candidate selection.
 * @param input - GitHub workflow run JSON.
 * @returns The run identity and lifecycle fields.
 */
export function parseCiRun(input: unknown): CiRun {
  const row = object(input, 'workflow run')
  return { id: integer(row.id, 'run id'), run_attempt: integer(row.run_attempt, 'run attempt'), head_sha: sha(row.head_sha, 'run head'),
    path: text(row.path, 'workflow path'), event: text(row.event, 'event'), status: text(row.status, 'run status'), conclusion: conclusion(row.conclusion) }
}

/**
 * Validate job identity and the collector's optional resolved execution attempt.
 * @param input - GitHub job JSON, optionally enriched after historical execution verification.
 * @returns The job verdict and attempt identities.
 */
export function parseCiJob(input: unknown): CiJob {
  const row = object(input, 'workflow job')
  const runAttempt = integer(row.run_attempt, 'job attempt')
  const executionAttempt = row.execution_attempt === undefined ? undefined : integer(row.execution_attempt, 'execution attempt')
  if (executionAttempt !== undefined && executionAttempt > runAttempt) throw new Error('execution attempt exceeds job attempt')
  return { id: integer(row.id, 'job id'), run_attempt: runAttempt, name: text(row.name, 'job name'),
    ...(executionAttempt === undefined ? {} : { execution_attempt: executionAttempt }),
    status: text(row.status, 'job status'), conclusion: conclusion(row.conclusion) }
}

/**
 * Evaluate the newest run for each required workflow against one candidate tree.
 * @param policy - definition derived from the candidate's own workflow source.
 * @param candidateSha - full candidate commit requested for acceptance.
 * @param treeSha - candidate tree verified from the repository's Git commit API.
 * @param input - run/job/source snapshots collected from GitHub; unknown or malformed fields fail parsing.
 * @returns Required verdicts and separate observations; an older successful run never replaces a newer one.
 */
export function evaluateCandidateChecks(
  policy: RequiredChecks, candidateSha: string, treeSha: string, input: unknown,
): CandidateCheckEvidence {
  sha(candidateSha, 'candidate SHA'); sha(treeSha, 'candidate tree')
  if (!Array.isArray(input)) throw new Error('candidate runs must be an array')
  const snapshots = input.map((value: unknown) => {
    const row = object(value, 'run snapshot')
    if (!Array.isArray(row.jobs)) throw new Error('run jobs must be an array')
    return { run: parseCiRun(row.run), jobs: row.jobs.map((job: unknown) => parseCiJob(job)), source: row.source }
  })
  const runKeys = snapshots.map(({ run }) => `${run.path}:${run.id}:${run.run_attempt}`)
  if (new Set(runKeys).size !== runKeys.length) throw new Error('duplicate workflow run attempt')
  const workflows = policy.workflows.map((required): WorkflowVerdict => {
    const selected = snapshots.filter(row => row.run.path === required.path)
      .sort((a, b) => b.run.id - a.run.id || b.run.run_attempt - a.run.run_attempt)[0]
    const result: WorkflowVerdict = { path: required.path, status: 'PENDING', reasons: [], observations: [] }
    if (selected === undefined) { result.reasons.push('required workflow has no run'); return result }
    const { run, jobs } = selected
    if (jobs.some(job => job.run_attempt > run.run_attempt)) throw new Error('job attempt exceeds workflow run attempt')
    result.runId = run.id; result.runAttempt = run.run_attempt
    result.observations = jobs.filter(job => job.name !== required.requiredJob && job.name !== required.sourceJob)
      .map(({ name, status, conclusion }) => ({ name, status, conclusion }))
    if (run.head_sha !== candidateSha || run.event !== 'pull_request') result.reasons.push('run source or event differs from candidate PR')
    for (const name of new Set([required.requiredJob, required.sourceJob])) {
      const matches = jobs.filter(job => job.name === name)
      if (matches.length > 1 || (matches.length === 0 && run.status === 'completed')) result.reasons.push(`required job missing or duplicated: ${name}`)
      const job = matches[0]
      if (job?.status === 'completed' && job.conclusion !== 'success') result.reasons.push(`required job did not succeed: ${name}`)
    }
    if (result.reasons.length !== 0) { result.status = 'FAIL'; return result }
    const requiredJob = jobs.find(job => job.name === required.requiredJob), producer = jobs.find(job => job.name === required.sourceJob)
    if (requiredJob?.status !== 'completed' || producer?.status !== 'completed') { result.reasons.push('required job is pending'); return result }
    const sourceReasons: string[] = []
    if (selected.source === undefined) sourceReasons.push('completed source producer has no source receipt')
    else {
      const source = parseCiSourceReceipt(selected.source)
      result.source = source
      if (source.workflow !== required.path || source.workflowSha256 !== required.workflowSha256
        || source.runId !== run.id || source.runAttempt !== (producer.execution_attempt ?? producer.run_attempt)
        || source.event !== run.event || source.candidateSha !== candidateSha) sourceReasons.push('source receipt does not match its producer')
      if (source.dirty || source.treeSha !== treeSha) sourceReasons.push('checkout is dirty or has another tree')
      if (source.checkoutSha !== candidateSha && (source.parents.length !== 2 || !source.parents.includes(candidateSha))) {
        sourceReasons.push('checkout is not the candidate or its PR merge')
      }
    }
    result.reasons = sourceReasons
    result.status = sourceReasons.length === 0 ? 'PASS' : 'FAIL'
    return result
  })
  const executionShas = new Set(workflows.flatMap(row => row.source === undefined ? [] : [row.source.checkoutSha]))
  if (executionShas.size > 1) {
    for (const workflow of workflows.filter(row => row.source !== undefined)) {
      workflow.status = 'FAIL'; workflow.reasons.push('required workflows executed different commits')
    }
  }
  const executionSha = executionShas.size === 1 ? [...executionShas][0] : undefined
  return { schemaVersion: 1, candidateSha, treeSha, ...(executionSha === undefined ? {} : { executionSha }),
    status: workflows.some(row => row.status === 'FAIL') ? 'FAIL' : workflows.some(row => row.status === 'PENDING') ? 'PENDING' : 'PASS', workflows }
}

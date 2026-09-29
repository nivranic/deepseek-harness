/** Inspect workflow action revisions and token permissions from parsed repository policy. */
import { load } from 'js-yaml'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Read repository-owned Action manifests without following filesystem links.
 * @param root - repository containing the optional .github/actions tree.
 * @returns Local uses references and their manifest text; missing trees yield an empty map.
 */
export function readLocalActions(root: string): ReadonlyMap<string, string> {
  const actions = new Map<string, string>()
  const github = join(root, '.github')
  if (!lstatSync(github).isDirectory()) throw new Error('local Action parent must be a real directory')
  const directory = join(root, '.github/actions')
  if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) return actions
  const visit = (path: string, reference: string): void => {
    if (!lstatSync(path).isDirectory()) throw new Error('local Action directories must be real directories')
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('local Action inputs must not contain links')
      const target = join(path, entry.name)
      if (entry.isDirectory()) visit(target, `${reference}/${entry.name}`)
      else if (entry.name === 'action.yml' || entry.name === 'action.yaml') {
        if (!entry.isFile() || actions.has(reference)) throw new Error('local Action requires one regular manifest')
        actions.set(reference, readFileSync(target, 'utf8'))
      }
    }
  }
  visit(directory, './.github/actions')
  return actions
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

interface WritableJob {
  permissions: string[]
  environment: string | null
}

function parsePins(input: unknown): Set<string> {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.pins) || input.pins.length === 0) {
    throw new Error('action pin registry must declare schemaVersion 1 and non-empty pins')
  }
  const pins = new Set<string>()
  for (const row of input.pins) {
    if (!record(row) || typeof row.action !== 'string' || typeof row.sha !== 'string'
      || !/^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*$/.test(row.action)
      || row.action.split('/').includes('..') || !/^[a-f0-9]{40}$/.test(row.sha)
      || row.repository !== row.action.split('/').slice(0, 2).join('/')
      || typeof row.requestedRef !== 'string' || row.requestedRef.length === 0) {
      throw new Error('action pin must name its upstream repository, requested ref and full commit SHA')
    }
    pins.add(`${row.action}@${row.sha}`)
  }
  return pins
}

function parsePolicy(input: unknown): { required: string[]; writableJobs: Map<string, WritableJob> } {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.requiredWorkflows)
    || input.requiredWorkflows.length === 0 || !record(input.writableJobs)) {
    throw new Error('workflow policy must declare schemaVersion 1, requiredWorkflows and writableJobs')
  }
  const required: string[] = []
  for (const name of input.requiredWorkflows) {
    if (typeof name !== 'string' || !/^[\w.-]+\.ya?ml$/.test(name) || required.includes(name)) {
      throw new Error('workflow policy requires unique workflow filenames')
    }
    required.push(name)
  }
  const writableJobs = new Map<string, WritableJob>()
  for (const [key, row] of Object.entries(input.writableJobs)) {
    if (!/^[\w.-]+\.ya?ml#[\w-]+$/.test(key) || !record(row) || !Array.isArray(row.permissions)
      || row.permissions.length === 0 || row.permissions.some(value => typeof value !== 'string' || value.length === 0)
      || new Set(row.permissions).size !== row.permissions.length
      || (row.environment !== null && (typeof row.environment !== 'string' || row.environment.length === 0))
      || typeof row.reason !== 'string' || row.reason.trim().length === 0) {
      throw new Error('workflow policy writable job must name exact permissions, environment and reason')
    }
    writableJobs.set(key, { permissions: row.permissions as string[], environment: row.environment })
  }
  return { required, writableJobs }
}

/**
 * Reject mutable action dependencies, implicit token permissions, and unrecorded writable jobs.
 * @param files - every workflow filename and its YAML text, including reusable workflow callees.
 * @param registry - parsed action-pins.json, resolved against the actions' owning repositories.
 * @param policyInput - parsed workflow-security.json with required files and justified writable jobs.
 * @param actions - local Action uses references and manifests from the same repository checkout.
 * @returns Every workflow violation; malformed policy throws before workflow acceptance begins.
 */
export function inspectWorkflowSecurity(files: ReadonlyMap<string, string>, registry: unknown, policyInput: unknown,
  actions: ReadonlyMap<string, string> = new Map()): string[] {
  const pins = parsePins(registry)
  const policy = parsePolicy(policyInput)
  const errors: string[] = []
  const usedWritableJobs = new Set<string>()
  const composites = new Map<string, unknown[]>()
  for (const [reference, text] of actions) {
    if (!/^\.\/\.github\/actions\/(?:[\w.-]+\/)*[\w.-]+$/.test(reference)
      || reference.slice(2).split('/').some(part => part === '.' || part === '..')) {
      errors.push(`${reference}: local Action must remain under .github/actions`)
      continue
    }
    let action: unknown
    try { action = load(text) } catch { errors.push(`${reference}: invalid Action YAML`); continue }
    if (!record(action) || !record(action.runs) || action.runs.using !== 'composite'
      || !Array.isArray(action.runs.steps) || action.runs.steps.length === 0) {
      errors.push(`${reference}: local Action must define non-empty composite steps`)
      continue
    }
    composites.set(reference, action.runs.steps)
  }
  for (const file of policy.required) {
    if (!files.has(file)) errors.push(`required workflow is missing: ${file}`)
  }
  const permissions = (value: unknown, owner: string): string[] => {
    if (!record(value)) { errors.push(`${owner}: permissions must be an explicit mapping`); return [] }
    const writes: string[] = []
    for (const [key, permission] of Object.entries(value)) {
      if (permission === 'write') writes.push(key)
      else if (permission !== 'read' && permission !== 'none') errors.push(`${owner}: invalid permissions entry ${key}`)
    }
    return writes.sort()
  }
  const uses = (value: unknown, owner: string, isJob: boolean): void => {
    if (typeof value !== 'string') { errors.push(`${owner}: action revision must be a string`); return }
    if (value.startsWith('./')) {
      if (isJob) {
        const local = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/.exec(value)
        if (local === null || !files.has(local[1] ?? '')) errors.push(`${owner}: local workflow is missing or outside .github/workflows`)
      } else if (!composites.has(value)) errors.push(`${owner}: local composite Action is missing or outside .github/actions`)
    } else if (!pins.has(value)) errors.push(`${owner}: action revision must match a recorded upstream commit SHA`)
  }
  const stepUses = (step: Record<string, unknown>, owner: string): void => {
    if (step.uses !== undefined) uses(step.uses, owner, false)
    if (typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')
      && (!record(step.with) || step.with['persist-credentials'] !== false)) {
      errors.push(`${owner}: checkout must set persist-credentials: false`)
    }
  }
  const completed = new Set<string>(), visiting = new Set<string>()
  const inspectComposite = (reference: string): void => {
    if (visiting.has(reference)) { errors.push(`${reference}: local composite Action cycle`); return }
    if (completed.has(reference)) return
    visiting.add(reference)
    for (const [index, step] of (composites.get(reference) ?? []).entries()) {
      const owner = `${reference} step ${index + 1}`
      if (!record(step)) { errors.push(`${owner}: step must be a mapping`); continue }
      if ((step.run === undefined) === (step.uses === undefined)
        || (step.run !== undefined && (typeof step.run !== 'string' || step.run.length === 0
          || typeof step.shell !== 'string' || step.shell.length === 0))) {
        errors.push(`${owner}: composite step requires uses or run with an explicit shell`)
      }
      stepUses(step, owner)
      if (typeof step.uses === 'string' && composites.has(step.uses)) inspectComposite(step.uses)
    }
    visiting.delete(reference)
    completed.add(reference)
  }
  for (const reference of composites.keys()) inspectComposite(reference)
  for (const [file, text] of files) {
    let workflow: unknown
    try { workflow = load(text) } catch { errors.push(`${file}: invalid YAML`); continue }
    if (!record(workflow)) { errors.push(`${file}: YAML must define a workflow mapping`); continue }
    if (permissions(workflow.permissions, file).length !== 0) errors.push(`${file}: default permissions must be read-only`)
    if (!record(workflow.jobs) || Object.keys(workflow.jobs).length === 0) { errors.push(`${file}: jobs must be non-empty`); continue }
    for (const [id, job] of Object.entries(workflow.jobs)) {
      const owner = `${file}#${id}`
      if (!record(job)) { errors.push(`${owner}: job must be a mapping`); continue }
      const writes = permissions(job.permissions === undefined ? workflow.permissions : job.permissions, owner)
      if (writes.length !== 0) {
        const allowed = policy.writableJobs.get(owner)
        if (allowed === undefined || writes.join(',') !== [...allowed.permissions].sort().join(',')) {
          errors.push(`${owner}: writable job permissions are not recorded exactly`)
        } else {
          usedWritableJobs.add(owner)
          const environment = record(job.environment) ? job.environment.name : job.environment
          if ((environment ?? null) !== allowed.environment) errors.push(`${owner}: protected environment differs from policy`)
        }
      }
      if (job.uses !== undefined) uses(job.uses, owner, true)
      else if (!Array.isArray(job.steps) || job.steps.length === 0) errors.push(`${owner}: steps must be non-empty`)
      if (Array.isArray(job.steps)) {
        for (const [index, step] of job.steps.entries()) {
          const stepOwner = `${owner} step ${index + 1}`
          if (!record(step)) { errors.push(`${stepOwner}: step must be a mapping`); continue }
          stepUses(step, stepOwner)
        }
      }
    }
  }
  for (const owner of policy.writableJobs.keys()) {
    if (!usedWritableJobs.has(owner)) errors.push(`${owner}: unused writable job exception`)
  }
  return errors
}

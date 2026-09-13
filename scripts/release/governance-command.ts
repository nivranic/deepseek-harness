/** Governance composes actual owners without accepting a second JSON verdict channel. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { verifyRcCandidate } from '../verify-rc-candidate.ts'
import { collectCandidateChecks, type CiGithub } from './ci-collector.ts'
import { readRequiredChecks } from './ci-files.ts'
import { evaluateReleaseChecklist, parseReleaseChecklist, type GovernanceObservation } from './governance.ts'

const RELEASE_CHECKLIST_FILE = 'release/checklist.json'

/** Source-bound engineering observation; unsigned integrity and live CI retain separate verdicts. */
export type ReleaseReadiness = ReturnType<typeof evaluateReleaseChecklist> & {
  sourceSha: string
  treeSha: string
  repository: string
  policySha256: string
  collectedAt: string
  artifactIntegrity: { status: 'PASS' | 'FAIL' | 'UNAVAILABLE'; authenticated: false }
  ci: Awaited<ReturnType<typeof collectCandidateChecks>> | null
}

function source(root: string, sha: string): string {
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (git(['rev-parse', 'HEAD']) !== sha || git(['status', '--porcelain=v1', '--untracked-files=normal']) !== '') {
    throw new Error('governance requires a clean checkout of the selected source')
  }
  return git(['rev-parse', 'HEAD^{tree}'])
}

/**
 * Evaluate one clean immutable candidate with live CI and optional complete artifact verification.
 * @param args - Required --repo and --source-sha; optional paired --root and --manifest.
 * @param repository - Trusted checkout containing the verifier, checklist and product identity.
 * @param api - Read-only GitHub transport; no verdict file or adapter override is accepted.
 * @returns A source-bound observation. Missing adapters, evidence, or collection failures prevent Go.
 */
export async function verifyReleaseReadiness(args: string[], repository: string, api: CiGithub): Promise<ReleaseReadiness> {
  const { values } = parseArgs({ args, options: {
    repo: { type: 'string' }, 'source-sha': { type: 'string' }, root: { type: 'string' }, manifest: { type: 'string' },
  } })
  const repo = values.repo, sha = values['source-sha']
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !sha || !/^[a-f0-9]{40}$/.test(sha)
    || Boolean(values.root) !== Boolean(values.manifest)) {
    throw new Error('require --repo owner/repo and --source-sha <full-sha>; --root and --manifest must be supplied together')
  }
  const treeSha = source(repository, sha)
  const bytes = readFileSync(join(repository, RELEASE_CHECKLIST_FILE))
  const checklist = parseReleaseChecklist(JSON.parse(bytes.toString('utf8')) as unknown)
  const policySha256 = createHash('sha256').update(bytes).digest('hex')
  const observations: GovernanceObservation[] = [{ id: 'G2-GOV', status: 'PASS', reason: 'complete release-foundation checklist validated' }]

  let integrity: { status: 'PASS' | 'FAIL' | 'UNAVAILABLE'; authenticated: false } = { status: 'UNAVAILABLE', authenticated: false }
  if (values.root && values.manifest) {
    try {
      await verifyRcCandidate(['--root', values.root, '--manifest', values.manifest, '--source-sha', sha,
        '--source-repository', `git+https://github.com/${repo}`], repository)
      integrity = { status: 'PASS', authenticated: false }
    } catch {
      // Artifact failures may contain local paths or producer payloads; retain only the fixed verdict.
      integrity = { status: 'FAIL', authenticated: false }
    }
  }
  observations.push({ id: 'G2-RC', status: integrity.status === 'FAIL' ? 'FAIL' : 'UNAVAILABLE',
    reason: integrity.status === 'PASS' ? 'artifact consistency passed; authenticated platform execution adapter is not implemented'
      : integrity.status === 'FAIL' ? 'candidate artifact verification failed' : 'complete candidate manifest was not supplied' })

  let ci: Awaited<ReturnType<typeof collectCandidateChecks>> | undefined
  try {
    ci = await collectCandidateChecks(api, repo, sha)
    if (ci.treeSha !== treeSha || !isDeepStrictEqual(ci.policy, readRequiredChecks(repository))) {
      throw new Error('live CI source or workflow policy differs from the selected checkout')
    }
    observations.push({ id: 'G2-CI', status: ci.status, reason: 'live candidate CI collector verdict' })
  } catch {
    // Transport errors can carry private payloads; do not persist them or retain a partial CI result.
    ci = undefined
    observations.push({ id: 'G2-CI', status: 'FAIL', reason: 'live candidate CI verification failed' })
  }
  if (source(repository, sha) !== treeSha || !readFileSync(join(repository, RELEASE_CHECKLIST_FILE)).equals(bytes)) {
    throw new Error('governance source changed during verification')
  }
  return { ...evaluateReleaseChecklist(checklist, observations), sourceSha: sha, treeSha, repository: repo, policySha256,
    collectedAt: new Date().toISOString(), artifactIntegrity: integrity, ci: ci ?? null }
}

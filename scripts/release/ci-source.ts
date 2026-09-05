/** Capture payload-free Git checkout metadata before a workflow starts its checks. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCiSourceReceipt, type CiSourceReceipt } from './ci-evidence.ts'

/**
 * Record the actual checkout and producer identity; a dirty tree remains explicitly marked.
 * @param root - checked-out repository root.
 * @param workflow - canonical repository-relative workflow filename.
 * @param environment - CI run, attempt, event, and explicitly supplied candidate SHA.
 * @returns Validated checkout metadata without paths, author identity, or business payloads.
 */
export function captureCiSource(root: string, workflow: string, environment: NodeJS.ProcessEnv): CiSourceReceipt {
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(workflow)) throw new Error('source workflow must be a canonical workflow path')
  const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const checkoutSha = git(['rev-parse', 'HEAD'])
  const header = git(['cat-file', 'commit', checkoutSha]).split('\n\n')[0] ?? ''
  return parseCiSourceReceipt({
    schemaVersion: 1, workflow,
    workflowSha256: createHash('sha256').update(readFileSync(join(root, workflow))).digest('hex'),
    runId: Number(environment.GITHUB_RUN_ID), runAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
    event: environment.GITHUB_EVENT_NAME, candidateSha: environment.DSH_CI_CANDIDATE_SHA,
    checkoutSha, treeSha: header.match(/^tree ([a-f0-9]{40})$/m)?.[1],
    parents: [...header.matchAll(/^parent ([a-f0-9]{40})$/gm)].map(match => match[1]),
    dirty: git(['status', '--porcelain=v1', '--untracked-files=normal']) !== '',
  })
}

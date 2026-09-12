/** Candidate evidence command owns output invalidation and non-success exit status. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { collectCandidateChecks, type CiGithub } from './ci-collector.ts'

/**
 * Collect one candidate without leaving a previous PASS file after a failed refresh.
 * @param args - Required --repo, --sha, and --output arguments.
 * @param api - Read-only GitHub transport.
 * @returns Zero only for PASS; FAIL, PENDING, and collection failures return one.
 */
export async function runCiCollection(args: string[], api: CiGithub): Promise<number> {
  const { values } = parseArgs({ args, options: { repo: { type: 'string' }, sha: { type: 'string' }, output: { type: 'string' } } })
  if (values.repo === undefined || values.sha === undefined || values.output === undefined) {
    throw new Error('usage: collect-ci-evidence --repo owner/repo --sha <full-sha> --output <evidence.json>')
  }
  const output = resolve(values.output)
  await mkdir(dirname(output), { recursive: true })
  const save = async (value: unknown) => writeFile(output, `${JSON.stringify(value, null, 2)}\n`)
  await save({ schemaVersion: 1, status: 'COLLECTING' })
  try {
    const evidence = await collectCandidateChecks(api, values.repo, values.sha)
    await save(evidence)
    return evidence.status === 'PASS' ? 0 : 1
  } catch {
    // Parser or transport errors can contain remote payloads; only this fixed diagnostic is persisted.
    await save({ schemaVersion: 1, status: 'FAIL', reason: 'CI collection failed; verify access and source evidence, then collect again' })
    return 1
  }
}

/** Read the required-check policy from workflow owners and reject stale projections. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deriveRequiredChecks, type RequiredChecks } from './ci-evidence.ts'

/** Committed projection of required workflow jobs and source digests. */
export const REQUIRED_CHECKS_FILE = 'release/required-checks.generated.json'

/**
 * Derive required verdicts from the current workflow files.
 * @param root - repository checkout to inspect.
 * @returns The required-check definition owned by that checkout.
 */
export function readRequiredChecks(root: string): RequiredChecks {
  const directory = join(root, '.github/workflows')
  return deriveRequiredChecks(new Map(readdirSync(directory).filter(name => /\.ya?ml$/.test(name))
    .map(name => [`.github/workflows/${name}`, readFileSync(join(directory, name), 'utf8')])))
}

/**
 * Serialize one required-check definition for the generator and freshness check.
 * @param policy - workflow-derived definition.
 * @returns Deterministic JSON with one trailing newline.
 */
export function renderRequiredChecks(policy: RequiredChecks): string {
  return `${JSON.stringify(policy, null, 2)}\n`
}

/**
 * Reject a missing or stale required-check projection without changing it.
 * @param root - repository checkout to validate.
 */
export function verifyRequiredChecks(root: string): void {
  if (readFileSync(join(root, REQUIRED_CHECKS_FILE), 'utf8') !== renderRequiredChecks(readRequiredChecks(root))) {
    throw new Error(`${REQUIRED_CHECKS_FILE} is stale; run pnpm run gen-required-checks`)
  }
}

/** Source revision stamped into packaged Desktop runtime resources. */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Complete lowercase Git commit accepted as a packaged source revision. */
const COMMIT_REVISION = /^[0-9a-f]{40}$/u

/** Short or complete Git commit recorded by the client build environment. */
const RECORDED_COMMIT = /^[0-9a-f]{7,40}$/iu

/** One-line revision stamp sealed into the packaged runtime inventory. */
export const DESKTOP_BUILD_REVISION_FILE = 'build-revision.json'

// Written by scripts/client-build-environment.ts after a complete client build;
// packaging cross-checks its recorded commit against the packaged revision.
const CLIENT_BUILD_RECORD_PATH = '.dsh-build/client-build-environment.json'

/** Read the complete commit of the packaging checkout; Git failures fail packaging loudly. */
function gitHeadRevision(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/** Read the client build record text, or undefined before the first complete client build. */
function readClientBuildRecordText(): string | undefined {
  const path = join(REPOSITORY_ROOT, CLIENT_BUILD_RECORD_PATH)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extract the lowercase commit recorded by one client build record. */
function clientRecordedCommit(recordText: string): string {
  let value: unknown
  try {
    value = JSON.parse(recordText)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`desktop build revision: ${CLIENT_BUILD_RECORD_PATH} is invalid JSON: ${detail}`)
  }
  const commit = isRecord(value) && isRecord(value.environment) ? value.environment.DSH_CLIENT_COMMIT_HASH : undefined
  if (typeof commit !== 'string' || !RECORDED_COMMIT.test(commit)) {
    throw new Error(`desktop build revision: ${CLIENT_BUILD_RECORD_PATH} has no valid DSH_CLIENT_COMMIT_HASH`)
  }
  return commit.toLowerCase()
}

/**
 * Resolve the source revision sealed into a Desktop release.
 *
 * An explicit 40-character `DSH_BUILD_REVISION` wins; otherwise the packaging
 * checkout's `git rev-parse HEAD` supplies the commit. When a client build
 * record exists, its recorded commit must prefix-match the resolved revision:
 * a fork between the built client artifacts and the packaged sources fails
 * packaging instead of silently selecting either side.
 *
 * @param environment - Packaging environment that may pin the revision.
 * @param revParse - Supplies `git rev-parse HEAD` output for the packaging checkout.
 * @param readClientBuildRecord - Supplies the client build record text, or undefined when absent.
 * @returns Complete lowercase Git commit of the packaged sources.
 */
export function resolveDesktopBuildRevision(
  environment: NodeJS.ProcessEnv = process.env,
  revParse: () => string = gitHeadRevision,
  readClientBuildRecord: () => string | undefined = readClientBuildRecordText,
): string {
  const explicit = environment.DSH_BUILD_REVISION
  let revision: string
  if (explicit === undefined) {
    const head = revParse().trim()
    if (!COMMIT_REVISION.test(head)) {
      throw new Error(`desktop build revision: git rev-parse HEAD returned ${JSON.stringify(head)}, not a 40-character lowercase commit hash`)
    }
    revision = head
  } else if (!COMMIT_REVISION.test(explicit)) {
    throw new Error(`desktop build revision: DSH_BUILD_REVISION must be a 40-character lowercase commit hash; got ${JSON.stringify(explicit)}`)
  } else {
    revision = explicit
  }
  const recordText = readClientBuildRecord()
  if (recordText !== undefined) {
    const recorded = clientRecordedCommit(recordText)
    if (!revision.startsWith(recorded)) {
      throw new Error(`desktop build revision: client build record commits ${recorded} but the packaged revision is ${revision}; rebuild the client from the packaged commit before packaging Desktop`)
    }
  }
  return revision
}

/**
 * Stamp the resolved revision into a runtime root before it is sealed.
 *
 * The stamp must land before `writeDesktopRuntime` inventories the root: the
 * sealed manifest rejects every file added after sealing, so a later stamp
 * would fail integrity verification in every packaged product.
 *
 * @param root - Runtime output directory about to be sealed by `writeDesktopRuntime`.
 * @param revision - Complete lowercase Git commit of the packaged sources.
 */
export function writeDesktopBuildRevisionStamp(root: string, revision: string): void {
  if (!COMMIT_REVISION.test(revision)) {
    throw new Error(`desktop build revision: stamp requires a 40-character lowercase commit hash; got ${JSON.stringify(revision)}`)
  }
  writeFileSync(join(root, DESKTOP_BUILD_REVISION_FILE), `${JSON.stringify({ revision })}\n`)
}

/**
 * Build revision stamping for packaged Desktop launches.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILD_REVISION_FILENAME = 'build-revision.json'
const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Read `build-revision.json` at the runtime root. A present stamp whose JSON
 * carries a 40-lowercase-hex-digit `revision` sets `DSH_BUILD_REVISION` unless
 * the process already inherited a value; explicit inheritance wins. A present
 * but corrupt stamp — unreadable for any reason except absence, invalid JSON,
 * or a malformed `revision` — throws, so a damaged package fails loud instead
 * of silently reporting `'source-tree'`. An absent stamp (a source-tree launch)
 * sets nothing.
 * @param runtimeDir - immutable dsh packages root supplied by the Electron application.
 */
export function applyBuildRevisionStamp(runtimeDir: string): void {
  const stampPath = join(runtimeDir, BUILD_REVISION_FILENAME)
  let raw: string
  try {
    raw = readFileSync(stampPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(`dsh desktop: build revision stamp ${stampPath} is unreadable: ${cause}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(`dsh desktop: build revision stamp ${stampPath} is not valid JSON: ${cause}`)
  }
  if (!isRecord(parsed) || typeof parsed.revision !== 'string' || !BUILD_REVISION_PATTERN.test(parsed.revision)) {
    throw new Error(`dsh desktop: build revision stamp ${stampPath} must carry { "revision": "<40 lowercase hex digits>" }`)
  }
  if (process.env.DSH_BUILD_REVISION === undefined) process.env.DSH_BUILD_REVISION = parsed.revision
}

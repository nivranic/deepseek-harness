/** Stable Host identity with serialized creation and atomic publication. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { HostId } from './types.ts'

const HOST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/u

async function readIdentity(path: string): Promise<HostId | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!HOST_ID_PATTERN.test(text)) throw new Error(`Host identity file is invalid: ${path}; restore the saved identity before starting the Host`)
  return text.trimEnd() as HostId
}

/**
 * Read or create a stable Host id. Concurrent first launches share the same id.
 * Malformed or inaccessible identities fail instead of being replaced or bypassed.
 * @param path - absolute path owned by this Harness installation.
 * @param lockWaitMs - maximum wait for another identity writer, in milliseconds.
 * @returns the persisted random UUID, never an in-memory fallback.
 */
export async function loadHostId(path: string, lockWaitMs: number): Promise<HostId> {
  if (!isAbsolute(path)) throw new TypeError('host-description identityFile must be an absolute path')
  const existing = await readIdentity(path)
  if (existing !== undefined) return existing
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const current = await readIdentity(path)
    if (current !== undefined) return current
    const created = randomUUID() as HostId
    await writeFileAtomic(path, `${created}\n`, { mode: 0o600, dirMode: 0o700 })
    return created
  }, { waitMs: lockWaitMs })
}

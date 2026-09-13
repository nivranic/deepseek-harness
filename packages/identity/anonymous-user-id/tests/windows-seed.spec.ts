/** Windows identity persistence on hosts whose filesystem exposes no O_NOFOLLOW flag. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ANONYMOUS_USER_ID_FILE_NAME, getOrCreateAnonymousIdentity } from '../src/index.ts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const { O_NOFOLLOW: _unsupported, ...constants } = actual.constants
  return { ...actual, constants }
})

it('persists a private random seed and derives a stable Windows identity', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-windows-seed-'))
  try {
    const options = { env: { DSH_HOME: home }, platform: 'win32' as const, randomBytes: () => Buffer.alloc(32, 1) }
    const identity = getOrCreateAnonymousIdentity(options)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`v1:${'01'.repeat(32)}\n`)
    expect(getOrCreateAnonymousIdentity(options).userId).toBe(identity.userId)
    expect(identity.pseudonymizeSessionId('session-a')).not.toBe(identity.pseudonymizeSessionId('session-b'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

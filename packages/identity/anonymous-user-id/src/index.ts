/**
 * Per-harness-home anonymous identity shared by telemetry, feedback, and
 * provider requests.
 *
 * One private random root seed lives in `.anonymous-user-id` under the harness
 * home resolved by {@link resolveDshHome} (`$DSH_HOME` > `~/.dsh`). Public user
 * identity and Session-telemetry pseudonyms use separate HMAC domains, so an
 * exported `user.id` cannot reveal the key used for Session correlation. The
 * root seed is never returned.
 *
 * Reads and writes are synchronous so boot-time consumers can resolve the
 * identity before registering hot-path listeners. The opaque derived object is
 * memoized per resolved file path; its pseudonym function performs no I/O.
 *
 * @module @deepseek-ai/dsh-anonymous-user-id
 */

import { createHmac, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** A harness-home-scoped anonymous user id derived from private random material. */
export type AnonymousUserId = Branded<'AnonymousUserId'>

/** A stable opaque Session correlation value that contains no raw Session id. */
export type AnonymousSessionPseudonym = Branded<'AnonymousSessionPseudonym'>

/** File inside the harness home storing private anonymous-identity seed material. */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

const IDENTITY_FORMAT_VERSION = 1
const SEED_BYTES = 32
const MAX_SEED_RECORD_BYTES = 256n
const SEED_PATTERN = /^v1:([0-9a-f]{64})$/
const LEGACY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_FOLLOW = (constants as Partial<typeof constants>).O_NOFOLLOW ?? 0
const ROTATION_CLAIM_SUFFIX = '.rotate'

/** Opaque derived identity; its private root seed is not represented here. */
export interface AnonymousIdentity {
  /** Stable UUID-shaped value safe to send as anonymous installation identity. */
  readonly userId: AnonymousUserId
  /**
   * Pseudonymize one raw Session id with the private Session-only key.
   * This function is deterministic, synchronous, and performs no I/O.
   * @param sessionId - raw Session id that must remain local.
   * @returns stable lowercase SHA-256 HMAC digest.
   */
  pseudonymizeSessionId(sessionId: string): AnonymousSessionPseudonym
}

/** Ambient hooks for locating, generating, and securing identity material. */
export interface AnonymousUserIdOptions {
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Cryptographic byte generator; defaults to `crypto.randomBytes`. */
  readonly randomBytes?: (size: number) => Buffer
  /** Permission semantics; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
}

interface FileIdentity {
  readonly dev: bigint
  readonly ino: bigint
}

interface PrivateFile extends FileIdentity {
  readonly path: string
}

type PersistedSeed =
  | { readonly kind: 'missing' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'rotate'; readonly file: PrivateFile }
  | { readonly kind: 'valid'; readonly file: PrivateFile; readonly seed: string }

const memo = new Map<string, AnonymousIdentity>()

/** Return whether two metadata snapshots identify the same regular file. */
function isSameRegularFile(left: BigIntStats, right: BigIntStats | FileIdentity): boolean {
  return left.isFile() && left.dev === right.dev && left.ino === right.ino
}

/** POSIX seed files must be current-user-owned and inaccessible to group/other. */
function isPrivateFile(stat: BigIntStats, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return true
  if ((stat.mode & 0o077n) !== 0n) return false
  if (typeof process.getuid !== 'function') return false
  return stat.uid === BigInt(process.getuid())
}

/** Inspect a final path without following it and before reading any content. */
function inspectPersistedSeed(file: string, platform: NodeJS.Platform): PersistedSeed {
  let before: BigIntStats
  try {
    before = lstatSync(file, { bigint: true })
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'blocked' }
  }
  if (!before.isFile()) return { kind: 'blocked' }

  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY | NO_FOLLOW)
  } catch {
    return { kind: 'blocked' }
  }
  const result = ((): PersistedSeed => {
    try {
      const opened = fstatSync(fd, { bigint: true })
      const after = lstatSync(file, { bigint: true })
      if (!isSameRegularFile(opened, before) || !isSameRegularFile(after, opened)) {
        return { kind: 'blocked' }
      }
      const privateFile = { path: file, dev: opened.dev, ino: opened.ino }
      // Exposed and oversized roots rotate without reading their contents.
      if (!isPrivateFile(opened, platform) || opened.size > MAX_SEED_RECORD_BYTES) {
        return { kind: 'rotate', file: privateFile }
      }

      const value = readFileSync(fd, 'utf8').trim()
      const match = SEED_PATTERN.exec(value)
      const persistedSeed = match?.[1]
      if (persistedSeed !== undefined) return { kind: 'valid', file: privateFile, seed: persistedSeed }
      // A bare UUID was exported by the legacy format and is never reused as key material.
      if (LEGACY_UUID_PATTERN.test(value)) return { kind: 'rotate', file: privateFile }
      return { kind: 'rotate', file: privateFile }
    } catch {
      return { kind: 'blocked' }
    }
  })()
  try {
    closeSync(fd)
  } catch {
    return { kind: 'blocked' }
  }
  return result
}

/** Remove only the exact private temp inode created by this process. */
function unlinkOwnedFile(file: PrivateFile): void {
  const current = lstatSync(file.path, { bigint: true })
  if (isSameRegularFile(current, file)) unlinkSync(file.path)
}

/** Best-effort cleanup that never deletes a path after its inode changes. */
function tryUnlinkOwnedFile(file: PrivateFile): void {
  try {
    unlinkOwnedFile(file)
  } catch {
    // A missing/replaced path or unlink failure leaves no safe cleanup action.
  }
}

/** Write a complete owner-only seed into a random sibling, leaving it unpublished. */
function writePrivateSeedTemp(file: string, seed: string, platform: NodeJS.Platform): PrivateFile {
  const temp = `${file}.${randomBytes(12).toString('hex')}.tmp`
  const fd = openSync(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
    0o600,
  )
  let privateFile: PrivateFile | undefined
  let failure: Error | undefined
  try {
    let opened: BigIntStats
    try {
      opened = fstatSync(fd, { bigint: true })
    } catch (error) {
      try {
        const cleanupIdentity = fstatSync(fd, { bigint: true })
        privateFile = { path: temp, dev: cleanupIdentity.dev, ino: cleanupIdentity.ino }
      } catch {
        // A persistent descriptor inspection failure leaves no safe cleanup identity.
      }
      throw error
    }
    privateFile = { path: temp, dev: opened.dev, ino: opened.ino }
    const named = lstatSync(temp, { bigint: true })
    if (!isSameRegularFile(named, privateFile)) {
      throw new Error(`anonymous identity temporary path changed after open: ${temp}`)
    }
    if (platform !== 'win32') fchmodSync(fd, 0o600)
    const stat = fstatSync(fd, { bigint: true })
    if (!isSameRegularFile(stat, privateFile) || !isPrivateFile(stat, platform)) {
      throw new Error(`anonymous identity temporary path is not a private regular file: ${temp}`)
    }
    writeFileSync(fd, `v${String(IDENTITY_FORMAT_VERSION)}:${seed}\n`, 'utf8')
    fsyncSync(fd)
  } catch (error) {
    failure = error as Error
  }
  try {
    closeSync(fd)
  } catch (error) {
    failure ??= error as Error
  }
  if (failure !== undefined) {
    if (privateFile !== undefined) tryUnlinkOwnedFile(privateFile)
    throw failure
  }
  return privateFile as PrivateFile
}

/** `link` publishes one complete inode only when no first-launch winner exists. */
function publishMissingSeed(file: string, seed: string, platform: NodeJS.Platform): string | undefined {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = writePrivateSeedTemp(file, seed, platform)
  try {
    try {
      linkSync(temp.path, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } finally {
    tryUnlinkOwnedFile(temp)
  }

  const winner = inspectPersistedSeed(file, platform)
  if (winner.kind === 'valid') return winner.seed
  if (winner.kind === 'rotate') return rotateSeed(file, seed, platform, winner.file)
  return undefined
}

/** Publish or adopt the one complete seed that every concurrent rotation uses. */
function claimRotationSeed(
  file: string,
  seed: string,
  platform: NodeJS.Platform,
): Extract<PersistedSeed, { kind: 'valid' }> | undefined {
  const claimPath = `${file}${ROTATION_CLAIM_SUFFIX}`
  const temp = writePrivateSeedTemp(file, seed, platform)
  let ownedClaim: PrivateFile | undefined
  try {
    try {
      linkSync(temp.path, claimPath)
      ownedClaim = { path: claimPath, dev: temp.dev, ino: temp.ino }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } finally {
    tryUnlinkOwnedFile(temp)
  }

  const claim = inspectPersistedSeed(claimPath, platform)
  if (claim.kind === 'valid') return claim
  if (ownedClaim !== undefined) tryUnlinkOwnedFile(ownedClaim)
  return undefined
}

/** Resolve one legacy, corrupt, or exposed file through a shared rotation claim. */
function rotateSeed(
  file: string,
  seed: string,
  platform: NodeJS.Platform,
  expected: PrivateFile,
): string | undefined {
  const claim = claimRotationSeed(file, seed, platform)
  if (claim === undefined) {
    const winner = inspectPersistedSeed(file, platform)
    return winner.kind === 'valid' ? winner.seed : undefined
  }

  let beforeRename: BigIntStats
  try {
    beforeRename = lstatSync(file, { bigint: true })
  } catch {
    return claim.seed
  }
  if (!isSameRegularFile(beforeRename, expected)) {
    const winner = inspectPersistedSeed(file, platform)
    if (winner.kind !== 'valid') return claim.seed
    tryUnlinkOwnedFile(claim.file)
    return winner.seed
  }

  try {
    renameSync(claim.file.path, file)
  } catch {
    const winner = inspectPersistedSeed(file, platform)
    if (winner.kind !== 'valid') return claim.seed
    tryUnlinkOwnedFile(claim.file)
    return winner.seed
  }

  const winner = inspectPersistedSeed(file, platform)
  return winner.kind === 'valid' ? winner.seed : claim.seed
}

/** Generate one cryptographic root or reject a broken randomness provider. */
function generateSeed(generate: (size: number) => Buffer): string {
  const bytes = generate(SEED_BYTES)
  if (bytes.length !== SEED_BYTES) {
    throw new Error(`anonymous identity randomBytes must return ${String(SEED_BYTES)} bytes`)
  }
  return bytes.toString('hex')
}

/** Create the immutable public identity and its pure Session pseudonymizer. */
function deriveIdentity(seed: string): AnonymousIdentity {
  const root = Buffer.from(seed, 'hex')
  const userBytes = createHmac('sha256', root)
    .update('dsh/anonymous-user-id/v1')
    .digest()
    .subarray(0, 16)
  userBytes[6] = (userBytes.readUInt8(6) & 0x0f) | 0x40
  userBytes[8] = (userBytes.readUInt8(8) & 0x3f) | 0x80
  const userHex = userBytes.toString('hex')
  const userId = [
    userHex.slice(0, 8),
    userHex.slice(8, 12),
    userHex.slice(12, 16),
    userHex.slice(16, 20),
    userHex.slice(20),
  ].join('-') as AnonymousUserId
  const sessionKey = createHmac('sha256', root)
    .update('dsh/session-telemetry/session-id/key/v1')
    .digest()
  return Object.freeze({
    userId,
    pseudonymizeSessionId: (sessionId: string) => createHmac('sha256', sessionKey)
      .update(sessionId)
      .digest('hex') as AnonymousSessionPseudonym,
  })
}

/**
 * Return the harness home's opaque anonymous identity, creating private seed
 * material on first use. POSIX accepts a persisted root only from the same
 * regular file descriptor when the current user owns it and group/other have
 * no permissions; exposed roots rotate without being read. Node cannot verify
 * Windows DACLs, so Windows rejects link-shaped and non-regular final paths
 * while fresh files inherit the harness home's DACL. First creation uses a
 * no-replace publish. Rotation publishes or adopts one complete private claim
 * before requesting atomic path replacement, so cooperating processes use one seed;
 * a claim left by an interrupted process remains recoverable on a later launch.
 * Persistence remains best-effort: an unsafe or unwritable path gets one
 * process-stable in-memory identity without modifying that path, but a later
 * process cannot correlate it.
 * @param options - home-location, randomness, and platform seams.
 * @returns memoized identity with a public user id and pure Session pseudonymizer.
 */
export function getOrCreateAnonymousIdentity(options: AnonymousUserIdOptions = {}): AnonymousIdentity {
  const file = join(resolveDshHome(undefined, options.env ?? process.env), ANONYMOUS_USER_ID_FILE_NAME)
  const cached = memo.get(file)
  if (cached !== undefined) return cached

  const platform = options.platform ?? process.platform
  const persisted = inspectPersistedSeed(file, platform)
  let seed: string
  if (persisted.kind === 'valid') {
    seed = persisted.seed
  } else {
    seed = generateSeed(options.randomBytes ?? randomBytes)
    try {
      if (persisted.kind === 'missing') {
        seed = publishMissingSeed(file, seed, platform) ?? seed
      } else if (persisted.kind === 'rotate') {
        seed = rotateSeed(file, seed, platform, persisted.file) ?? seed
      }
    } catch {
      // Persistence failures retain this process's private random root.
    }
  }

  const identity = deriveIdentity(seed)
  memo.set(file, identity)
  return identity
}

/**
 * Return the public anonymous user id for feedback and provider metadata.
 * @param options - home-location, randomness, and platform seams.
 * @returns the derived stable per-harness-home anonymous user id.
 */
export function getOrCreateAnonymousUserId(options: AnonymousUserIdOptions = {}): AnonymousUserId {
  return getOrCreateAnonymousIdentity(options).userId
}

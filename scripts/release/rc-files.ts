/** Read candidate files without following artifact links; callers own an exclusive, quiescent root. */
import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseRcPath, type RcFile } from './rc-manifest.ts'

/** Windows lacks POSIX no-follow flags; descriptor identity checks also apply on that platform. */
export const RC_READ_FLAGS = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK)

/**
 * Decode evidence without copying malformed input into parse diagnostics.
 * @param bytes - complete, size-bounded JSON bytes.
 * @returns parsed JSON; invalid UTF-8 or JSON raises a payload-free error.
 */
export function parseRcJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('RC input must be valid UTF-8 JSON')
  }
}

function fingerprint(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join('/')
}

/**
 * Integrity reader for a completed artifact directory, not a sandbox for hostile concurrent writers.
 * Rejects links and notices file or ancestor replacement during verification. The caller must prevent
 * other processes from writing or renaming this root, its ancestors, or referenced files until use ends.
 */
export class RcFileReader {
  private readonly observed = new Map<string, string>()

  private constructor(private readonly root: string, private readonly maxJsonBytes: number) {}

  /**
   * Pin a directory selected independently of candidate JSON.
   * @param root - caller-owned artifact root; its final component must not be a symlink.
   * @param maxJsonBytes - positive maximum bytes for each JSON evidence file.
   * @returns a reader that streams binary files and bounds JSON allocations.
   */
  static async create(root: string, maxJsonBytes: number): Promise<RcFileReader> {
    if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes <= 0) throw new Error('RC JSON limit must be a positive integer')
    const requested = resolve(root)
    if (!(await lstat(requested)).isDirectory()) throw new Error('RC root must be a real directory')
    const reader = new RcFileReader(await realpath(requested), maxJsonBytes)
    await reader.observe(reader.root, true)
    return reader
  }

  private async observe(path: string, directory: boolean): Promise<BigIntStats> {
    const stat = await lstat(path, { bigint: true })
    if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n) {
      throw new Error('RC paths require real directories and regular files without hard links')
    }
    const signature = fingerprint(stat)
    const previous = this.observed.get(path)
    if (previous !== undefined && signature !== previous) throw new Error('RC file or directory changed during verification')
    this.observed.set(path, signature)
    return stat
  }

  /**
   * Hash the complete file and optionally parse those exact bytes as JSON.
   * @param file - validated receipt reference; a missing file or mismatched bytes fails.
   * @param json - whether to retain bounded bytes and return parsed JSON.
   * @returns parsed JSON when requested; otherwise undefined.
   */
  async read(file: RcFile, json = false): Promise<unknown> {
    const parts = parseRcPath(file.path).split('/')
    await this.observe(this.root, true)
    let path = this.root
    for (const part of parts.slice(0, -1)) {
      path = join(path, part)
      await this.observe(path, true)
    }
    path = join(this.root, ...parts)
    const before = await this.observe(path, false)
    if (before.size !== BigInt(file.bytes)) throw new Error(`RC size mismatch: ${file.path}`)
    if (json && file.bytes > this.maxJsonBytes) throw new Error('RC JSON exceeds the configured byte limit')
    const handle = await open(path, RC_READ_FLAGS)
    try {
      if (fingerprint(await handle.stat({ bigint: true })) !== fingerprint(before)) throw new Error('RC file changed while opening')
      const hash = createHash('sha256')
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const value of handle.createReadStream({ autoClose: false })) {
        const chunk: unknown = value
        if (!Buffer.isBuffer(chunk)) throw new Error('RC file stream must yield bytes')
        bytes += chunk.length
        if (bytes > file.bytes || (json && bytes > this.maxJsonBytes)) throw new Error('RC file grew during verification')
        hash.update(chunk)
        if (json) chunks.push(chunk)
      }
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error(`RC checksum mismatch: ${file.path}`)
      if (fingerprint(await handle.stat({ bigint: true })) !== fingerprint(before)) throw new Error('RC file changed while reading')
      await this.observe(path, false)
      return json ? parseRcJson(Buffer.concat(chunks)) : undefined
    } finally {
      await handle.close()
    }
  }

  /** Recheck all observed files and ancestors before accepting the complete candidate. */
  async assertUnchanged(): Promise<void> {
    for (const [path, signature] of this.observed) {
      if (fingerprint(await lstat(path, { bigint: true })) !== signature) throw new Error('RC file or directory changed during verification')
    }
  }
}

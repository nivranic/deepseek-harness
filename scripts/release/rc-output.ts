/** Describe newly produced candidate files without retaining installer bytes in memory. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRcPath, type RcFile } from './rc-manifest.ts'

/**
 * Hash a regular file from a producer-owned immutable output directory.
 * @param path - absolute completed output filename.
 * @returns complete byte count and SHA-256; links or observed size changes fail.
 */
export async function hashRcOutput(path: string): Promise<{ bytes: number; sha256: string }> {
  const before = await lstat(path)
  if (!before.isFile() || before.nlink !== 1) throw new Error('RC output must be a regular file without links')
  const hash = createHash('sha256')
  let bytes = 0
  for await (const value of createReadStream(path)) {
    const chunk: unknown = value
    if (!Buffer.isBuffer(chunk)) throw new Error('RC output stream must yield bytes')
    bytes += chunk.length
    hash.update(chunk)
  }
  const after = await lstat(path)
  if (bytes !== before.size || before.ino !== after.ino || before.dev !== after.dev
    || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('RC output changed while hashing')
  return { bytes, sha256: hash.digest('hex') }
}

/**
 * Describe a file under the output root for inclusion in a platform receipt.
 * @param root - producer-owned artifact directory.
 * @param path - portable relative artifact reference.
 * @returns the file reference after streaming its complete bytes.
 */
export async function describeRcOutput(root: string, path: string): Promise<RcFile> {
  return { path: parseRcPath(path), ...await hashRcOutput(join(root, path)) }
}

/**
 * Write new producer evidence without replacing a previous result.
 * @param root - producer-owned artifact directory containing the platform directory.
 * @param path - portable relative JSON reference.
 * @param value - evidence fields to serialize.
 * @returns a reference to the exact written JSON bytes.
 */
export async function writeRcOutput(root: string, path: string, value: unknown): Promise<RcFile> {
  await writeFile(join(root, parseRcPath(path)), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  return await describeRcOutput(root, path)
}

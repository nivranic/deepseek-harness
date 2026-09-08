/** Verify the scanner receipt and resource bytes before the Mac producer signs the executable. */
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hashRcOutput } from './rc-output.ts'

/** Immutable acquisition facts plus the digest of the executable admitted by the application. */
export interface MacSupportScannerIdentity {
  readonly schemaVersion: 1
  readonly version: string
  readonly archiveSha256: string
  readonly originalBinarySha256: string
  readonly binarySha256: string
  readonly licenseSha256: string
}

/**
 * Read only the fixed receipt fields produced by the pinned Python installer.
 * @param value - JSON output from the successful native staging command.
 * @returns The scanner identity; unknown fields and malformed digests fail.
 */
export function parseMacSupportScannerIdentity(value: unknown): MacSupportScannerIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid support scanner identity')
  const fields = value as Record<string, unknown>
  const digestKeys = ['archiveSha256', 'originalBinarySha256', 'binarySha256', 'licenseSha256'] as const
  const keys = new Set(['schemaVersion', 'version', ...digestKeys])
  if (fields.schemaVersion !== 1 || Object.keys(fields).length !== keys.size || Object.keys(fields).some(key => !keys.has(key))
    || typeof fields.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(fields.version)
    || digestKeys.some(key => typeof fields[key] !== 'string' || !/^[a-f0-9]{64}$/.test(fields[key]))) {
    throw new Error('invalid support scanner identity')
  }
  return { schemaVersion: 1, version: fields.version, archiveSha256: String(fields.archiveSha256),
    originalBinarySha256: String(fields.originalBinarySha256), binarySha256: String(fields.binarySha256),
    licenseSha256: String(fields.licenseSha256) }
}

/**
 * Check staged files against the receipt captured from the installer before any signing changes.
 * @param directory - new SupportScanner resource directory owned by the Mac producer.
 * @param identity - validated stdout receipt from the completed acquisition command.
 */
export async function verifyMacSupportScannerFiles(directory: string, identity: MacSupportScannerIdentity): Promise<void> {
  for (const name of ['gitleaks', 'LICENSE', 'scanner.json']) {
    const info = await lstat(join(directory, name))
    if (!info.isFile() || info.size === 0 || (name === 'gitleaks' && (info.mode & 0o111) === 0)) {
      throw new Error('support scanner resource must be a nonempty regular file with its required permissions')
    }
  }
  const binary = await hashRcOutput(join(directory, 'gitleaks'))
  const license = await hashRcOutput(join(directory, 'LICENSE'))
  const stored = parseMacSupportScannerIdentity(JSON.parse(await readFile(join(directory, 'scanner.json'), 'utf8')) as unknown)
  if (binary.sha256 !== identity.originalBinarySha256 || identity.binarySha256 !== binary.sha256
    || license.sha256 !== identity.licenseSha256 || JSON.stringify(stored) !== JSON.stringify(identity)) {
    throw new Error('support scanner resources changed after acquisition')
  }
}

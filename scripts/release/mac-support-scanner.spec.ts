/** Reject changed scanner resources and malformed acquisition receipts before signing a candidate. */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMacSupportScannerIdentity, verifyMacSupportScannerFiles } from './mac-support-scanner.ts'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const identity = { schemaVersion: 1, version: '8.30.1', archiveSha256: 'a'.repeat(64),
  originalBinarySha256: digest('native scanner'), binarySha256: digest('native scanner'), licenseSha256: digest('MIT fixture') } as const

describe('Mac SupportScanner acquisition', () => {
  it.each([null, [], {}, { ...identity, extra: 'private' }, { ...identity, schemaVersion: 2 },
    { ...identity, version: '8.30.1\n' }, { ...identity, binarySha256: 'x'.repeat(64) },
    { ...identity, licenseSha256: '' }, { ...identity, originalBinarySha256: 1 },
  ])('rejects malformed receipts %j', (value) => {
    expect(() => parseMacSupportScannerIdentity(value)).toThrow('invalid support scanner identity')
  })

  it.skipIf(process.platform === 'win32')('accepts verified resources and rejects changed files, links and permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-support-scanner-'))
    const expected = parseMacSupportScannerIdentity(identity)
    const write = async (): Promise<void> => {
      await writeFile(join(root, 'gitleaks'), 'native scanner', { mode: 0o755 })
      await writeFile(join(root, 'LICENSE'), 'MIT fixture')
      await writeFile(join(root, 'scanner.json'), JSON.stringify(identity))
    }
    try {
      await write()
      await verifyMacSupportScannerFiles(root, expected)
      for (const name of ['gitleaks', 'LICENSE', 'scanner.json']) {
        await writeFile(join(root, name), name === 'scanner.json' ? JSON.stringify({ ...identity, archiveSha256: 'b'.repeat(64) }) : 'changed')
        await expect(verifyMacSupportScannerFiles(root, expected)).rejects.toThrow('changed after acquisition')
        await write()
      }
      await chmod(join(root, 'gitleaks'), 0o644)
      await expect(verifyMacSupportScannerFiles(root, expected)).rejects.toThrow('required permissions')
      await chmod(join(root, 'gitleaks'), 0o755)
      await rm(join(root, 'LICENSE'))
      await symlink(join(root, 'gitleaks'), join(root, 'LICENSE'))
      await expect(verifyMacSupportScannerFiles(root, expected)).rejects.toThrow('regular file')
      await rm(join(root, 'LICENSE'))
      await mkdir(join(root, 'LICENSE'))
      await expect(verifyMacSupportScannerFiles(root, expected)).rejects.toThrow('regular file')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

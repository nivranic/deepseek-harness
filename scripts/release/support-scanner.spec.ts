/** Reject changed desktop scanner resources and malformed acquisition receipts before packaging. */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSupportScannerIdentity, verifySupportScannerFiles } from './support-scanner.ts'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const identity = { schemaVersion: 1, version: '8.30.1', archiveSha256: 'a'.repeat(64),
  originalBinarySha256: digest('native scanner'), binarySha256: digest('native scanner'), licenseSha256: digest('MIT fixture') } as const

describe('desktop SupportScanner acquisition', () => {
  it.each([null, [], {}, { ...identity, extra: 'private' }, { ...identity, schemaVersion: 2 },
    { ...identity, version: '8.30.1\n' }, { ...identity, binarySha256: 'x'.repeat(64) },
    { ...identity, licenseSha256: '' }, { ...identity, originalBinarySha256: 1 },
  ])('rejects malformed receipts %j', (value) => {
    expect(() => parseSupportScannerIdentity(value)).toThrow('invalid support scanner identity')
  })

  for (const platform of ['darwin', 'win32'] as const) {
    const binaryName = platform === 'win32' ? 'gitleaks.exe' : 'gitleaks'
    it.skipIf(platform === 'darwin' && process.platform === 'win32')(`verifies ${platform} resources and rejects changed or non-regular files`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-support-scanner-'))
      const expected = parseSupportScannerIdentity(identity)
      const write = async (): Promise<void> => {
        await writeFile(join(root, binaryName), 'native scanner', { mode: 0o755 })
        await writeFile(join(root, 'LICENSE'), 'MIT fixture')
        await writeFile(join(root, 'scanner.json'), JSON.stringify(identity))
      }
      const verify = (): Promise<void> => verifySupportScannerFiles(root, expected, platform)
      try {
        await write()
        await verify()
        for (const name of [binaryName, 'LICENSE', 'scanner.json']) {
          await writeFile(join(root, name), name === 'scanner.json' ? JSON.stringify({ ...identity, archiveSha256: 'b'.repeat(64) }) : 'changed')
          await expect(verify()).rejects.toThrow('changed after acquisition')
          await write()
        }
        await writeFile(join(root, binaryName), '')
        await expect(verify()).rejects.toThrow('regular file')
        await write()
        await writeFile(join(root, 'unrecorded'), 'extra')
        await expect(verify()).rejects.toThrow('contain only')
        await rm(join(root, 'unrecorded'))
        await rm(join(root, 'LICENSE'))
        await expect(verify()).rejects.toThrow('contain only')
        await mkdir(join(root, 'LICENSE'))
        await expect(verify()).rejects.toThrow('regular file')
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  }

  it.skipIf(process.platform === 'win32')('rejects linked resources and missing Darwin execute permission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-support-scanner-'))
    try {
      await writeFile(join(root, 'gitleaks'), 'native scanner', { mode: 0o755 })
      await writeFile(join(root, 'LICENSE'), 'MIT fixture')
      await writeFile(join(root, 'scanner.json'), JSON.stringify(identity))
      await chmod(join(root, 'gitleaks'), 0o644)
      await expect(verifySupportScannerFiles(root, identity, 'darwin')).rejects.toThrow('required permissions')
      await chmod(join(root, 'gitleaks'), 0o755)
      await rm(join(root, 'LICENSE'))
      await symlink(join(root, 'gitleaks'), join(root, 'LICENSE'))
      await expect(verifySupportScannerFiles(root, identity, 'darwin')).rejects.toThrow('regular file')
      await rm(join(root, 'LICENSE'))
      await writeFile(join(root, 'LICENSE'), 'MIT fixture')
      await rm(join(root, 'gitleaks'))
      await symlink(join(root, 'LICENSE'), join(root, 'gitleaks.exe'))
      await expect(verifySupportScannerFiles(root, identity, 'win32')).rejects.toThrow('regular file')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects a linked resource directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-support-scanner-directory-'))
    try {
      const resources = join(root, 'resources'), link = join(root, 'link')
      await mkdir(resources)
      await symlink(resources, link, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(verifySupportScannerFiles(link, identity, 'win32')).rejects.toThrow('regular directory')
      await unlink(link)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

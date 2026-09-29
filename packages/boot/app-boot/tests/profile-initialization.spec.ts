import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initProfile, PROFILE_PATCH_FILENAME } from '../src/profile.ts'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) }
})

const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
const roots: string[] = []
const filenames = ['package.json', PROFILE_PATCH_FILENAME, 'pnpm-workspace.yaml']
const marker = 'created by another writer\n'

function directory(): string {
  const root = actual.mkdtempSync(join(tmpdir(), 'dsh-profile-init-'))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.mocked(writeFileSync).mockReset().mockImplementation(actual.writeFileSync)
  for (const root of roots.splice(0)) actual.rmSync(root, { recursive: true, force: true })
})

describe('profile initialization preserves concurrent files', () => {
  it.each(filenames)('keeps %s created just before its write', (filename) => {
    const dir = directory()
    const target = join(dir, filename)
    for (const sibling of filenames) {
      if (sibling !== filename) actual.writeFileSync(join(dir, sibling), marker)
    }
    let created = false
    // A competing creator runs after any existence check but before the actual filesystem write.
    vi.mocked(writeFileSync).mockImplementation((path, data, options) => {
      if (path === target && !created) {
        actual.writeFileSync(target, marker, { flag: 'wx' })
        created = true
      }
      actual.writeFileSync(path, data, options)
    })

    initProfile(dir, ['candidate-bundle'])

    expect(created).toBe(true)
    for (const sibling of filenames) expect(actual.readFileSync(join(dir, sibling), 'utf8')).toBe(marker)
  })

  it.skipIf(process.platform === 'win32').each(filenames)('preserves the dangling symlink at %s', (filename) => {
    const dir = directory()
    const target = join(directory(), 'uncreated')
    const link = join(dir, filename)
    actual.symlinkSync(target, link)

    initProfile(dir, ['candidate-bundle'])

    expect(actual.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(actual.readlinkSync(link)).toBe(target)
    expect(actual.existsSync(target)).toBe(false)
  })

  it.each(['EACCES', 'EIO'])('reports %s instead of treating it as an existing file', (code) => {
    const error = Object.assign(new Error('write failed'), { code })
    vi.mocked(writeFileSync).mockImplementationOnce(() => { throw error })
    expect(() => { initProfile(directory(), ['candidate-bundle']) }).toThrow(error)
  })
})

/** Deterministic filesystem races against opened handles and atomic destination commit. */
import type { FileHandle } from 'node:fs/promises'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ApprovedSupportDocument } from '../src/support-export.ts'
import { POLICY, supportFixture } from './support-fixture.ts'

const faults = vi.hoisted(() => ({
  onOpen: undefined as ((path: string, handle: FileHandle) => Promise<void>) | undefined,
  rename: false,
  unlink: false,
  noFollow: true,
  identity: undefined as { path: string; field: 'ino' | 'dev'; before: bigint; after: bigint } | undefined,
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    constants: {
      ...actual.constants,
      get O_NOFOLLOW() { return faults.noFollow ? actual.constants.O_NOFOLLOW : undefined },
    },
  }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const stat = await actual.lstat(...args)
      const identity = faults.identity
      if (identity?.path === String(args[0])) {
        Object.assign(stat, { [identity.field]: typeof stat.ino === 'bigint' ? identity.before : Number(identity.before) })
      }
      return stat
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const identity = faults.identity
      if (identity?.path === String(args[0])) {
        const stat = handle.stat.bind(handle)
        vi.spyOn(handle, 'stat').mockImplementationOnce(async (options) => {
          const result = await stat(options)
          return Object.assign(result, { [identity.field]: typeof result.ino === 'bigint' ? identity.after : Number(identity.after) })
        })
      }
      await faults.onOpen?.(String(args[0]), handle)
      return handle
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (faults.rename) throw new Error('fixture disk failure')
      await actual.rename(...args)
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (faults.unlink) throw new Error('fixture cleanup failure')
      await actual.unlink(...args)
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  faults.onOpen = undefined
  faults.rename = false
  faults.unlink = false
  faults.noFollow = true
  faults.identity = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const f = await supportFixture()
  roots.push(f.root)
  return f
}
const signal = () => new AbortController().signal

it.each(['ino', 'dev'] as const)('checks full %s precision when O_NOFOLLOW is unavailable', async (field) => {
  faults.noFollow = false
  const f = await fixture()
  await ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())
  const before = 2n ** 54n
  faults.identity = { path: f.executable, field, before, after: before }
  await ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())
  faults.identity.after += 1n
  expect(Number(before)).toBe(Number(faults.identity.after))
  await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'invalid-scanner' })
  expect(f.calls).toHaveLength(6)
})

it.each(['before-stat', 'after-stat'] as const)('refuses resource truncation %s without launching a scanner', async (when) => {
  const f = await fixture()
  faults.onOpen = async (path, handle) => {
    if (path !== f.executable) return
    if (when === 'before-stat') await writeFile(path, '')
    else {
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementationOnce(async (options) => {
        const result = await stat(options)
        await writeFile(path, '')
        return result
      })
    }
  }
  await expect(ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())).rejects.toMatchObject({ reason: 'invalid-scanner' })
  expect(f.calls).toHaveLength(0)
})

it('removes a prepared file when cancellation arrives before writing and preserves the destination', async () => {
  const f = await fixture()
  const document = await ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())
  const target = join(f.root, 'saved.json')
  await writeFile(target, 'previous')
  const controller = new AbortController()
  faults.onOpen = async (path) => { if (path.endsWith('.tmp')) controller.abort() }
  await expect(document.save(target, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(await readFile(target, 'utf8')).toBe('previous')
  expect((await readdir(f.root)).sort()).toEqual(['SupportScanner', 'saved.json'])
})

it('reports failed temporary-file removal instead of claiming a completed export', async () => {
  const f = await fixture()
  const document = await ApprovedSupportDocument.prepare(f.runtime, f.directory, {}, POLICY, signal())
  faults.rename = true
  faults.unlink = true
  await expect(document.save(join(f.root, 'saved.json'), signal())).rejects.toMatchObject({ reason: 'cleanup-failed' })
  expect(await readdir(f.root)).not.toContain('saved.json')
})

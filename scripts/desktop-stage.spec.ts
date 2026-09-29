import { lstat, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withDesktopStage } from './desktop-stage.ts'

const state = vi.hoisted(() => ({ parent: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, tmpdir: () => state.parent || actual.tmpdir() }
})

beforeEach(async () => {
  state.parent = await mkdtemp(join(tmpdir(), 'dsh-stage-test-'))
})

afterEach(async () => {
  await rm(state.parent, { recursive: true, force: true })
  state.parent = ''
})

describe('desktop packaging stage', () => {
  it('keeps overlapping builds separate and preserves an existing fixed stage', async () => {
    const legacy = join(state.parent, 'dsh-desktop-stage')
    await mkdir(legacy)
    await writeFile(join(legacy, 'owned-by-another-run'), 'preserve')
    const entered = Promise.withResolvers<string>()
    const release = Promise.withResolvers<undefined>()
    const first = withDesktopStage(async (directory) => {
      await writeFile(join(directory, 'manifest'), 'first')
      entered.resolve(directory)
      await release.promise
      return readFile(join(directory, 'manifest'), 'utf8')
    })
    const firstDirectory = await entered.promise
    try {
      const secondDirectory = await withDesktopStage(async (directory) => {
        expect(directory).not.toBe(firstDirectory)
        expect(await readdir(directory)).toEqual([])
        if (process.platform !== 'win32') expect((await lstat(directory)).mode & 0o777).toBe(0o700)
        await writeFile(join(directory, 'manifest'), 'second')
        return directory
      })
      await expect(lstat(secondDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(firstDirectory, 'manifest'), 'utf8')).toBe('first')
    } finally {
      release.resolve(undefined)
      await expect(first).resolves.toBe('first')
    }
    await expect(lstat(firstDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(legacy, 'owned-by-another-run'), 'utf8')).toBe('preserve')
  })

  it('removes a partially written closure before propagating packaging failure', async () => {
    const failure = new Error('packager rejected the closure')
    let attemptedDirectory = ''
    await expect(withDesktopStage(async (directory) => {
      attemptedDirectory = directory
      await mkdir(join(directory, 'node_modules'))
      await writeFile(join(directory, 'node_modules', 'partial'), 'unfinished')
      throw failure
    })).rejects.toBe(failure)
    await expect(lstat(attemptedDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(state.parent)).toEqual([])
  })
})

/** The local artifact backend: atomic put, read-back, removal, and the opt-in retention sweep below the configured home. */

import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ArtifactId } from '@deepseek-ai/dsh-artifact'
import LocalArtifactStore from '../src/index.ts'

const DAY_MS = 24 * 60 * 60 * 1000

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir), stat: vi.fn(actual.stat) }
})

/** Backdate one stored artifact's bytes so a sweep window can see it as aged. */
async function ageArtifact(home: string, id: string, days: number): Promise<void> {
  const file = join(home, 'artifacts', `${id}.artifact`)
  const aged = new Date(Date.now() - days * DAY_MS)
  await utimes(file, aged, aged)
}

const cleanup: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function storeInFreshHome(): Promise<{ store: LocalArtifactStore; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-artifact-local-'))
  cleanup.push(home)
  return { store: new LocalArtifactStore(new Context(), { dshHome: home }), home }
}

describe('dsh-artifact-local', () => {
  it('round-trips content bytes under artifacts/<id>.artifact', async () => {
    const { store, home } = await storeInFreshHome()
    const id = ArtifactId('art-1')
    await store.put(id, new TextEncoder().encode('# 报告\n正文'))
    expect(new TextDecoder().decode((await store.get(id))!)).toBe('# 报告\n正文')
    const raw = await readFile(join(home, 'artifacts', 'art-1.artifact'), 'utf8')
    expect(raw).toBe('# 报告\n正文')
  })

  it('reads an absent id as null and removal makes it absent', async () => {
    const { store } = await storeInFreshHome()
    expect(await store.get(ArtifactId('art-none'))).toBeNull()
    const id = ArtifactId('art-2')
    await store.put(id, new Uint8Array([1, 2, 3]))
    await store.remove(id)
    expect(await store.get(id)).toBeNull()
  })

  it('replaces the content of a re-put id wholesale', async () => {
    const { store } = await storeInFreshHome()
    const id = ArtifactId('art-3')
    await store.put(id, new TextEncoder().encode('first'))
    await store.put(id, new TextEncoder().encode('second'))
    expect(new TextDecoder().decode((await store.get(id))!)).toBe('second')
  })

  it.each([
    '../outside',
    '..\\outside',
    'art-../outside',
    'art-..\\outside',
    'art-safe:stream',
    'art-safe\0tail',
    'art-safe<copy>',
  ])('rejects non-portable id %j before get, put, or remove reaches the filesystem', async (rawId) => {
    const { store, home } = await storeInFreshHome()
    const outside = join(home, 'outside.artifact')
    await writeFile(outside, 'sentinel')
    const id = ArtifactId(rawId)
    await expect(store.get(id)).rejects.toThrow(/artifact id must be/)
    await expect(store.put(id, new TextEncoder().encode('overwrite'))).rejects.toThrow(/artifact id must be/)
    await expect(store.remove(id)).rejects.toThrow(/artifact id must be/)
    expect(await readFile(outside, 'utf8')).toBe('sentinel')
  })
})

describe('dsh-artifact-local retention', () => {
  it('repeats the configured sweep and disposes its timer with the owning context', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sweep = vi.spyOn(LocalArtifactStore.prototype, 'sweep').mockResolvedValue([])
    const ctx = new Context()
    new LocalArtifactStore(ctx, { dshHome: tmpdir(), retentionDays: 7 })
    expect(sweep).toHaveBeenCalledExactlyOnceWith(7)
    await vi.advanceTimersByTimeAsync(DAY_MS)
    expect(sweep).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
    await vi.advanceTimersByTimeAsync(DAY_MS)
    expect(sweep).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates directory failures and skips a failed file without blocking the sweep', async () => {
    const { store, home } = await storeInFreshHome()
    const denied = Object.assign(new Error('directory denied'), { code: 'EACCES' })
    vi.mocked(fs.readdir).mockRejectedValueOnce(denied)
    await expect(store.sweep(1)).rejects.toBe(denied)
    for (const id of ['art-a', 'art-b']) {
      await store.put(ArtifactId(id), new Uint8Array([1]))
      await ageArtifact(home, id, 3)
    }
    const warning = vi.spyOn(store.ctx.logger, 'warn')
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error('file disappeared'))
    expect(await store.sweep(1)).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('file disappeared'))
    expect(await store.sweep(1)).toHaveLength(1)
  })
  it('sweeps only artifacts older than the window and reports their ids', async () => {
    const { store, home } = await storeInFreshHome()
    await store.put(ArtifactId('art-old'), new TextEncoder().encode('aged'))
    await store.put(ArtifactId('art-fresh'), new TextEncoder().encode('new'))
    await ageArtifact(home, 'art-old', 40)
    expect(await store.sweep(30)).toEqual(['art-old'])
    expect(await store.get(ArtifactId('art-old'))).toBeNull()
    expect(new TextDecoder().decode((await store.get(ArtifactId('art-fresh')))!)).toBe('new')
  })

  it('treats a never-materialized artifacts directory as nothing to prune', async () => {
    const { store } = await storeInFreshHome()
    expect(await store.sweep(1)).toEqual([])
  })

  it('ignores foreign files and subdirectories inside artifacts/', async () => {
    const { store, home } = await storeInFreshHome()
    const artifacts = join(home, 'artifacts')
    await mkdir(artifacts, { recursive: true })
    await writeFile(join(artifacts, 'notes.txt'), 'not an artifact')
    await writeFile(join(artifacts, 'notes.artifact'), 'foreign suffix match')
    await mkdir(join(artifacts, 'art-dir.artifact'))
    await store.put(ArtifactId('art-keep'), new TextEncoder().encode('x'))
    await ageArtifact(home, 'notes', 40)
    await ageArtifact(home, 'art-keep', 40)
    expect(await store.sweep(30)).toEqual(['art-keep'])
    expect(await readFile(join(artifacts, 'notes.txt'), 'utf8')).toBe('not an artifact')
    expect(await readFile(join(artifacts, 'notes.artifact'), 'utf8')).toBe('foreign suffix match')
  })

  it('sweeps once at boot when retentionDays is configured', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-artifact-local-boot-'))
    cleanup.push(home)
    const seeding = new LocalArtifactStore(new Context(), { dshHome: home })
    await seeding.put(ArtifactId('art-aged'), new TextEncoder().encode('aged'))
    await seeding.put(ArtifactId('art-live'), new TextEncoder().encode('live'))
    await ageArtifact(home, 'art-aged', 3)
    const ctx = new Context()
    const sweeping = new LocalArtifactStore(ctx, { dshHome: home, retentionDays: 1 })
    for (let round = 0; round < 100; round++) {
      if (await sweeping.get(ArtifactId('art-aged')) === null) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(await sweeping.get(ArtifactId('art-aged'))).toBeNull()
    expect(new TextDecoder().decode((await sweeping.get(ArtifactId('art-live')))!)).toBe('live')
    await ctx.fiber.dispose()
  })

  it('rejects a non-positive or fractional retentionDays at load', () => {
    for (const retentionDays of [0, -1, 1.5]) {
      expect(() => LocalArtifactStore.Config({ dshHome: '/tmp', retentionDays })).toThrow()
    }
  })
})

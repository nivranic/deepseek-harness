/** The local artifact backend: atomic put, read-back, removal, and the opt-in retention sweep below the configured home. */

import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ArtifactId } from '@deepseek-ai/dsh-artifact'
import LocalArtifactStore from '../src/index.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/** Backdate one stored artifact's bytes so a sweep window can see it as aged. */
async function ageArtifact(home: string, id: string, days: number): Promise<void> {
  const file = join(home, 'artifacts', `${id}.artifact`)
  const aged = new Date(Date.now() - days * DAY_MS)
  await utimes(file, aged, aged)
}

const cleanup: string[] = []

afterEach(async () => {
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
})

describe('dsh-artifact-local retention', () => {
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
    await mkdir(join(artifacts, 'art-dir.artifact'))
    await store.put(ArtifactId('art-keep'), new TextEncoder().encode('x'))
    await ageArtifact(home, 'art-keep', 40)
    expect(await store.sweep(30)).toEqual(['art-keep'])
    expect(await readFile(join(artifacts, 'notes.txt'), 'utf8')).toBe('not an artifact')
  })

  it('sweeps once at boot when retentionDays is configured', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-artifact-local-boot-'))
    cleanup.push(home)
    const seeding = new LocalArtifactStore(new Context(), { dshHome: home })
    await seeding.put(ArtifactId('art-aged'), new TextEncoder().encode('aged'))
    await seeding.put(ArtifactId('art-live'), new TextEncoder().encode('live'))
    await ageArtifact(home, 'art-aged', 3)
    const sweeping = new LocalArtifactStore(new Context(), { dshHome: home, retentionDays: 1 })
    for (let round = 0; round < 100; round++) {
      if (await sweeping.get(ArtifactId('art-aged')) === null) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(await sweeping.get(ArtifactId('art-aged'))).toBeNull()
    expect(new TextDecoder().decode((await sweeping.get(ArtifactId('art-live')))!)).toBe('live')
  })

  it('rejects a non-positive or fractional retentionDays at load', () => {
    for (const retentionDays of [0, -1, 1.5]) {
      expect(() => LocalArtifactStore.Config({ dshHome: '/tmp', retentionDays })).toThrow()
    }
  })
})

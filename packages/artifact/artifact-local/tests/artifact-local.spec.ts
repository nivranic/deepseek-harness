/** The local artifact backend: atomic put, read-back, and removal below the configured home. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ArtifactId } from '@deepseek-ai/dsh-artifact'
import LocalArtifactStore from '../src/index.ts'

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

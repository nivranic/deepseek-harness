/** Failed collection invalidates stale evidence without exposing remote response bodies. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'
import { runCiCollection } from './ci-command.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSafely(root) })

it('replaces a previous PASS when transport or parsing fails and redacts the failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ci-command-'))
  roots.push(root)
  const output = join(root, 'evidence.json')
  await writeFile(output, '{"status":"PASS"}')
  const status = await runCiCollection(['--repo', 'owner/repo', '--sha', 'a'.repeat(40), '--output', output], {
    async json() {
      expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ status: 'COLLECTING' })
      throw new Error('private remote response fixture')
    },
    async source() { throw new Error('unexpected source read') },
  })
  expect(status).toBe(1)
  const saved = await readFile(output, 'utf8')
  expect(JSON.parse(saved)).toMatchObject({ status: 'FAIL' })
  expect(saved).not.toContain('private remote response fixture')
})

it('rejects incomplete CLI arguments without starting collection', async () => {
  await expect(runCiCollection([], {
    async json() { throw new Error('unexpected API read') },
    async source() { throw new Error('unexpected source read') },
  })).rejects.toThrow('usage:')
})

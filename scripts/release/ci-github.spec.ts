/** Artifact transport admits only a bounded regular source.json and removes temporary data. */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { githubCiTransport } from './ci-github.ts'

it('uses explicit GitHub API and exact run/artifact arguments', async () => {
  const calls: string[][] = []
  let directory = ''
  const api = githubCiTransport(async (args) => {
    calls.push(args)
    if (args[0] === 'api') return '{"id":42}'
    directory = args.at(-1)!
    await writeFile(join(directory, 'source.json'), '{"schemaVersion":1}')
    return ''
  })
  expect(await api.json('repos/owner/repo/actions/runs/42')).toEqual({ id: 42 })
  expect(Buffer.from(await api.source('owner/repo', 42, 'ci-source-42-1')).toString()).toBe('{"schemaVersion":1}')
  expect(calls[0]).toEqual(['api', '--hostname', 'github.com', 'repos/owner/repo/actions/runs/42'])
  expect(calls[1]).toEqual(['run', 'download', '42', '--repo', 'github.com/owner/repo', '--name', 'ci-source-42-1', '--dir', directory])
  await expect(access(directory)).rejects.toThrow()
})

it.each(['extra entry', 'directory', 'oversize', 'download failure'])('refuses %s and removes temporary files', async (kind) => {
  let directory = ''
  const api = githubCiTransport(async (args) => {
    directory = args.at(-1)!
    if (kind === 'download failure') throw new Error('download failed')
    if (kind === 'directory') await mkdir(join(directory, 'source.json'))
    else await writeFile(join(directory, 'source.json'), kind === 'oversize' ? 'x'.repeat(65537) : '{}')
    if (kind === 'extra entry') await writeFile(join(directory, 'extra.txt'), 'unexpected')
    return ''
  })
  await expect(api.source('owner/repo', 42, 'ci-source-42-1')).rejects.toThrow()
  await expect(access(directory)).rejects.toThrow()
})

/** GitHub CLI transport; authentication remains owned by the caller's gh session. */
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CiGithub } from './ci-collector.ts'

/**
 * Adapt a shell-free GitHub CLI invocation to the read-only collector.
 * @param run - Execute gh argv and return stdout; failures reject without logging credentials.
 * @returns REST and artifact readers using only github.com.
 */
export function githubCiTransport(run: (args: string[]) => Promise<string>): CiGithub {
  return {
    async json(endpoint) {
      return JSON.parse(await run(['api', '--hostname', 'github.com', endpoint])) as unknown
    },
    async source(repository, runId, name) {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-ci-receipt-'))
      try {
        await run(['run', 'download', String(runId), '--repo', `github.com/${repository}`, '--name', name, '--dir', directory])
        const entries = await readdir(directory)
        if (entries.length !== 1 || entries[0] !== 'source.json') throw new Error('source artifact must contain only source.json')
        const filename = join(directory, 'source.json'), entry = await lstat(filename)
        if (!entry.isFile() || entry.size === 0 || entry.size > 65536) throw new Error('source.json must be a bounded regular file')
        return await readFile(filename)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

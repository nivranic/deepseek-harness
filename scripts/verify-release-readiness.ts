/** Print engineering readiness without writing acceptance files or authorizing external actions. */
import { execa } from 'execa'
import { resolve } from 'node:path'
import { githubCiTransport } from './release/ci-github.ts'
import { verifyReleaseReadiness } from './release/governance-command.ts'

try {
  const api = githubCiTransport(async (args) => {
    const { stdout } = await execa('gh', args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  })
  const result = await verifyReleaseReadiness(process.argv.slice(2), resolve(import.meta.dirname, '..'), api)
  console.log(JSON.stringify(result))
  process.exitCode = result.decision === 'GO' ? 0 : 1
} catch {
  // Source, parser and transport exceptions may expose input data; only a fixed rejection reaches stdout.
  console.log(JSON.stringify({ schemaVersion: 1, decision: 'NO_GO', publicationAuthorized: false, reason: 'release readiness verification failed' }))
  process.exitCode = 1
}

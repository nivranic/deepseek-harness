/** Read-only candidate CI evidence CLI; requires an authenticated GitHub CLI on PATH. */
import { execa } from 'execa'
import { runCiCollection } from './release/ci-command.ts'
import { githubCiTransport } from './release/ci-github.ts'

const api = githubCiTransport(async (args) => {
  try {
    const { stdout } = await execa('gh', args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  } catch {
    // gh owns credential diagnostics, which must not enter candidate evidence or CLI output.
    throw new Error('GitHub CLI read failed')
  }
})
process.exitCode = await runCiCollection(process.argv.slice(2), api)

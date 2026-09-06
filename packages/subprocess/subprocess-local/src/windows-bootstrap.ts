/** Wait for parent Job assignment before starting the requested program with inherited standard streams. */
/* v8 ignore file -- self-executing child entry; windows-bootstrap.spec.ts forks it over real IPC, outside parent V8 coverage. */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

if (process.send === undefined) throw new Error('Windows subprocess bootstrap requires its parent IPC channel')
process.once('message', (message: unknown) => {
  if (message === null || typeof message !== 'object') throw new Error('Invalid Windows subprocess launch message')
  const value = message as Record<string, unknown>
  if (value.type !== 'run-in-owned-job' || value.environment === null || typeof value.environment !== 'object'
    || Array.isArray(value.environment) || Object.values(value.environment).some(item => typeof item !== 'string')) {
    throw new Error('Invalid Windows subprocess launch environment')
  }
  const { program, args } = value
  if (typeof program !== 'string' || program.length === 0
    || !Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    throw new Error('Invalid Windows subprocess launch argv')
  }
  // Skip libuv's additional kill-on-parent-exit Job; the target inherits the parent's explicit non-breakaway Job.
  let child: ChildProcess
  try {
    child = spawn(program, args, { stdio: 'inherit', detached: true, windowsHide: true, env: value.environment as Record<string, string> })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    reportSpawnFailure(error)
    return
  }
  child.once('error', reportSpawnFailure)
  child.once('exit', (exitCode, signal) => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- IPC was required at module entry; this process never replaces send.
    process.send!({ type: 'outcome', exitCode, signal }, () => { process.exit(0) })
  })
})
process.once('disconnect', () => { process.exit(1) })

/** Preserve both synchronous native argument errors and asynchronous executable lookup failures. */
function reportSpawnFailure(error: NodeJS.ErrnoException): void {
  // oxlint-disable-next-line typescript/no-non-null-assertion -- IPC was required at module entry; this process never replaces send.
  process.send!({ type: 'spawn-error', message: error.message, code: error.code }, () => { process.exit(1) })
}

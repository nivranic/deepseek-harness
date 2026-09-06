/** Gate ordinary Windows launches on Job membership while preserving target exit facts and standard streams. */
import { fork } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isSea } from 'node:sea'
import { createProcessJob } from '@deepseek-ai/dsh-win32-process'
import type { ProcessJob } from '@deepseek-ai/dsh-win32-process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { nodeSpawnCommand } from '@deepseek-ai/dsh-node-spawn'

/** Native Job and Node bootstrap lifetime behind one ordinary subprocess handle. */
export interface WindowsSpawn {
  /** Bootstrap whose stdio belongs directly to the caller's requested program. */
  child: ChildProcess
  /** Query all Job members; operational failures remain errors, never successful exit observations. */
  alive(): boolean
  /** Request Job termination and retain operational errors for the exit observer. */
  terminate(): void
  /** Close the non-inheritable Job handle; used only after empty observation or at final host exit. */
  close(): void
  /**
   * Project the requested program's exit message, or a terminated bootstrap's actual outcome.
   * @param exitCode - observed bootstrap exit code.
   * @param signal - observed bootstrap termination signal.
   * @returns target outcome without replacing its exit code with the bootstrap's code.
   */
  outcome(exitCode: number | null, signal: NodeJS.Signals | null): SubprocessOutcome
}

/**
 * Spawn a bootstrap that cannot start target code until assigned to a kill-on-close Job.
 * @param program - already resolved target executable.
 * @param args - target argv excluding its executable.
 * @param options - caller's directory, environment and three standard-stream dispositions.
 * @param createJob - injectable Job factory; production uses the shared Win32 primitives.
 * @returns bootstrap and kernel ownership operations; target spawn errors use the child's error event.
 */
export function spawnWindowsSubprocess(
  program: string,
  args: readonly string[],
  options: SpawnOptions,
  createJob: () => ProcessJob = createProcessJob,
): WindowsSpawn {
  const source = import.meta.url.endsWith('.ts')
  /* v8 ignore next -- Vitest runs source; the built Node, Electron and SEA smokes resolve the .js helper. */
  const bootstrap = fileURLToPath(new URL(source ? './windows-bootstrap.ts' : './windows-bootstrap.js', import.meta.url))
  /* v8 ignore next -- built executable smokes verify the loader-free branch under plain Node. */
  const loader = source ? ['--import', import.meta.resolve('tsx/esm')] : []
  if (!Array.isArray(options.stdio) || options.stdio.length !== 3) throw new Error('Windows spawn requires three explicit streams')
  const node = nodeSpawnCommand()
  const environment = Object.fromEntries(Object.entries(scrubbedParentEnv())
    .filter(([key]) => !/^(?:NODE_|ELECTRON_|TSX_)/i.test(key)))
  const child = fork(bootstrap, [], {
    ...options, execPath: node.command, execArgv: loader,
    // Enhanced SEA always runs dsh's fixed entry; its private IPC dispatch selects this bootstrap.
    env: { ...environment, ...node.env, ...isSea() ? { DSH_SUBPROCESS_BOOTSTRAP: '1' } : {} },
    stdio: [...options.stdio, 'ipc'],
  })
  let job: ProcessJob | undefined
  let assigned = false
  let stopped = false
  let closed = false
  let emptyObserved = false
  let failure: { error: unknown } | undefined
  let targetOutcome: SubprocessOutcome | undefined

  const failLaunch = (error: unknown): void => {
    if (stopped) return
    stopped = true
    try { if (!closed) job?.terminate() } catch (cleanup) { failure = { error: cleanup } }
    child.kill('SIGKILL')
    child.emit('error', error)
  }
  child.once('spawn', () => {
    if (stopped) return
    try {
      job = createJob()
      // oxlint-disable-next-line typescript/no-non-null-assertion -- Node publishes pid before emitting spawn.
      job.assign(child.pid!)
      assigned = true
      child.send({ type: 'run-in-owned-job', program, args, environment: options.env }, (error) => { if (error !== null) failLaunch(error) })
    } catch (error) {
      failLaunch(error)
    }
  })
  child.on('message', (input: unknown) => {
    if (input === null || typeof input !== 'object') {
      failLaunch(new Error('Invalid Windows subprocess bootstrap message'))
      return
    }
    const value = input as Record<string, unknown>
    if (value.type === 'spawn-error' && typeof value.message === 'string'
      && (value.code === undefined || typeof value.code === 'string')) {
      failLaunch(Object.assign(new Error(value.message), { code: value.code }))
    } else if (value.type === 'outcome' && targetOutcome === undefined
      && (value.exitCode === null || typeof value.exitCode === 'number' && Number.isSafeInteger(value.exitCode))
      && (value.signal === null || typeof value.signal === 'string' && /^SIG[A-Z0-9]+$/.test(value.signal))) {
      targetOutcome = { exitCode: value.exitCode, signal: value.signal as NodeJS.Signals | null }
    } else {
      failLaunch(new Error('Invalid Windows subprocess bootstrap outcome'))
    }
  })
  child.once('exit', () => {
    if (targetOutcome === undefined) failLaunch(new Error('Windows subprocess bootstrap exited without a target outcome'))
  })
  return {
    child,
    alive() {
      if (failure !== undefined) throw failure.error
      if (closed) {
        if (!emptyObserved) throw new Error('Process Job closed without an empty membership observation')
        return false
      }
      const active = job === undefined || !assigned
        ? child.exitCode === null && child.signalCode === null
        : !job.isEmpty()
      if (!active) emptyObserved = true
      return active
    },
    terminate() {
      if (closed) return
      stopped = true
      try {
        if (job === undefined) child.kill('SIGKILL')
        else job.terminate()
      } catch (error) {
        failure = { error }
      }
    },
    close() {
      if (closed) return
      if (!emptyObserved) stopped = true
      if (!assigned) child.kill('SIGKILL')
      job?.close()
      closed = true
    },
    outcome(exitCode, signal) {
      if (targetOutcome !== undefined) return targetOutcome
      if (stopped) return { exitCode, signal }
      throw new Error('Windows subprocess bootstrap exited without a target outcome')
    },
  }
}

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createProcessJob } from '@deepseek-ai/dsh-win32-process'
import { describe, expect, it, vi } from 'vitest'
import { spawnSubprocess } from '../src/spawn.ts'
import LocalSubprocessRuntime from '../src/index.ts'
import { createProcessInspector } from '../src/process-inspector.ts'
import type { ProcessIdentity } from '../src/process-inspector.ts'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

function spec(script: string, extra: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: [process.execPath, '-e', script], cwd: process.cwd(), graceMs: 100,
    stdio: { stdin: 'pipe', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, ...extra,
  }
}

describe.skipIf(process.platform !== 'win32')('Windows subprocess Job ownership', () => {
  it.each(['NODE_OPTIONS', 'node_options'])('applies target %s preloads only to the requested program', async (name) => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-target-node-options-'))
    const preload = join(directory, 'preload.cjs')
    await writeFile(preload, 'process.stdout.write("target-preload\\n")\n')
    const handle = spawnSubprocess(spec('process.stdout.write("target-program\\n")', {
      env: { [name]: `--import=${pathToFileURL(preload).href}` },
    }))
    try {
      expect(await handle.done).toEqual({ exitCode: 0, signal: null })
      expect(await handle.waitForExit()).toBe(true)
      expect(handle.collected.stdout!.readFrom(0).text).toBe('target-preload\ntarget-program\n')
    } finally {
      handle.terminateForHostExit()
      await rm(directory, { recursive: true })
    }
  })

  it('keeps argv, batch stdin, explicit environment and target exit status', async () => {
    const handle = spawnSubprocess(spec(`
      let input = '';
      process.stdin.on('data', chunk => { input += chunk; });
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ input, argv: process.argv.slice(1), value: process.env.DSH_EXPLICIT, bootstrap: process.env.DSH_SUBPROCESS_BOOTSTRAP ?? null }));
        process.stderr.write('target-stderr');
        process.exitCode = 42;
      });
    `, {
      env: { DSH_EXPLICIT: 'verbatim' },
      stdio: { stdin: { data: '输入\n' }, stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
    }))
    try {
      expect(await handle.done).toEqual({ exitCode: 42, signal: null })
      expect(JSON.parse(handle.collected.stdout!.readFrom(0).text)).toEqual({ input: '输入\n', argv: [], value: 'verbatim', bootstrap: null })
      expect(handle.collected.stderr!.readFrom(0).text).toBe('target-stderr')
      expect(await handle.waitForExit()).toBe(true)
    } finally { handle.terminateForHostExit() }
  })

  it('retains and terminates a descendant after the requested program exits', async () => {
    const inspector = createProcessInspector()
    let descendant: ProcessIdentity | undefined
    const handle = spawnSubprocess(spec(`
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      process.stdout.write(JSON.stringify({ root: process.pid, descendant: child.pid }));
      process.stdin.once('data', () => process.exit(7));
    `))
    try {
      const ids = await vi.waitFor(
        () => JSON.parse(handle.collected.stdout!.readFrom(0).text) as { root: number; descendant: number },
        { timeout: 10_000 },
      )
      descendant = inspector.snapshot().tree(handle.pid).find(item => item.pid === ids.descendant)
      expect(descendant).toBeDefined()
      handle.stdin!.end('exit the requested program')
      expect(await handle.done).toEqual({ exitCode: 7, signal: null })
      expect(inspector.isAlive(descendant!)).toBe(true)
      expect(await handle.waitForExit(AbortSignal.timeout(100))).toBe(false)
      expect(inspector.isAlive(descendant!)).toBe(true)
      handle.terminate()
      expect(await handle.waitForExit(AbortSignal.timeout(10_000))).toBe(true)
      // Job membership reaches zero before all terminating process handles become signaled.
      await vi.waitFor(() =>{  expect(inspector.isAlive(descendant!)).toBe(false) }, { interval: 1, timeout: 1000 })
      expect(inspector.isAlive(descendant!)).toBe(false)
    } finally {
      handle.terminateForHostExit()
      if (descendant !== undefined) {
        inspector.signalProcess(descendant, 'SIGKILL')
        await vi.waitFor(() =>{  expect(inspector.isAlive(descendant!)).toBe(false) })
      }
    }
  }, 15_000)

  it('cancels before Job assignment without starting the target', async () => {
    const createJob = vi.fn(createProcessJob)
    const handle = spawnSubprocess(spec('setInterval(() => {}, 1000)'), { createWindowsJob: createJob })
    handle.terminate()
    try {
      await handle.done
      expect(await handle.waitForExit()).toBe(true)
      expect(createJob).not.toHaveBeenCalled()
    } finally { handle.terminateForHostExit() }
  })

  it('rejects an unexpected bootstrap exit and terminates its still-running target', async () => {
    const inspector = createProcessInspector()
    const handle = spawnSubprocess(spec('process.stdout.write("ready"); setInterval(() => {}, 1000)'))
    const outcome = handle.done.catch((error: unknown) => error)
    try {
      await vi.waitFor(() =>{  expect(handle.collected.stdout!.readFrom(0).text).toBe('ready') }, { timeout: 10_000 })
      const identities = inspector.snapshot().tree(handle.pid)
      expect(identities.length).toBeGreaterThanOrEqual(2)
      process.kill(handle.pid, 'SIGKILL')
      const result = await outcome
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain('without a target outcome')
      expect(await handle.waitForExit(AbortSignal.timeout(10_000))).toBe(true)
      await vi.waitFor(() =>{  expect(identities.some(identity => inspector.isAlive(identity))).toBe(false) })
    } finally { handle.terminateForHostExit() }
  }, 15_000)

  it('rejects Job setup before any target code can run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-job-launch-failure-'))
    const marker = join(directory, 'target-started')
    const handle = spawnSubprocess(spec(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`), {
      createWindowsJob: () => { throw new Error('controlled Job setup failure') },
    })
    try {
      await expect(handle.done).rejects.toThrow('controlled Job setup failure')
      expect(await handle.waitForExit()).toBe(true)
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      handle.terminateForHostExit()
      await rm(directory, { recursive: true })
    }
  })

  it('reports a target launch error and still observes an empty Job', async () => {
    const handle = spawnSubprocess(spec('', { argv: ['Z:\\dsh-nonexistent-owned-process.exe'] }))
    try {
      await expect(handle.done).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await handle.waitForExit()).toBe(true)
    } finally { handle.terminateForHostExit() }
  })

  it('closes the Job when failed membership observation reaches service disposal', async () => {
    const ctx = new Context()
    const disposalErrors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { disposalErrors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const job = createProcessJob()
    const runtime = ctx.subprocess as LocalSubprocessRuntime
    runtime.internals.createWindowsJob = () => ({
      ...job, isEmpty: () => { throw new Error('controlled membership query failure') },
    })
    const handle = ctx.subprocess.spawn(spec('process.stdout.write("ready"); setInterval(() => {}, 1000)'))
    const inspector = createProcessInspector()
    try {
      await vi.waitFor(() =>{  expect(handle.collected.stdout!.readFrom(0).text).toBe('ready') }, { timeout: 10_000 })
      const identities = inspector.snapshot().tree(handle.pid)
      expect(identities.length).toBeGreaterThanOrEqual(2)
      await expect(handle.waitForExit()).rejects.toThrow('controlled membership query failure')
      await fiber.dispose()
      expect(disposalErrors).toEqual([expect.objectContaining({ message: 'controlled membership query failure' })])
      await handle.done
      await vi.waitFor(() =>{  expect(identities.some(identity => inspector.isAlive(identity))).toBe(false) })
    } finally { job.close() }
  }, 15_000)
})

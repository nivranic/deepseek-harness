import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { fstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OutputCollector, spawnSubprocess } from '../src/spawn.ts'
import LocalSubprocessRuntime from '../src/index.ts'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

const mocks = vi.hoisted(() => ({ launch: vi.fn(), descriptors: [] as number[] }))
vi.mock('../src/windows-spawn.ts', () => ({ spawnWindowsSubprocess: mocks.launch }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, openSync: (...args: Parameters<typeof fs.openSync>) => {
    const fd = fs.openSync(...args)
    mocks.descriptors.push(fd)
    return fd
  } }
})

afterEach(() => { vi.restoreAllMocks(); mocks.descriptors.length = 0 })

function controlledWindows() {
  const child = Object.assign(new EventEmitter(), { pid: 123, stdin: null, stdout: new PassThrough(), stderr: new PassThrough() })
  const alive = vi.fn(() => true)
  const adapter = {
    child, alive, close: vi.fn(),
    terminate: vi.fn(() => { alive.mockReturnValue(false) }),
    outcome: vi.fn(() => ({ exitCode: 42, signal: null })),
  }
  mocks.launch.mockReturnValue(adapter)
  const spec: SubprocessSpawnSpec = {
    argv: ['/target'], cwd: process.cwd(), graceMs: 100,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  }
  const cleanup = () => { child.stdout.destroy(); child.stderr.destroy(); alive.mockReturnValue(false) }
  return { child, adapter, spec, cleanup }
}

it('preserves target completion while cancellation joins the remaining Windows Job', async () => {
  const f = controlledWindows()
  const abort = new AbortController()
  const handle = spawnSubprocess({ ...f.spec, signal: abort.signal }, { platform: 'win32' })
  try {
    f.child.emit('close', 0, null)
    expect(await handle.done).toEqual({ exitCode: 42, signal: null })
    expect(handle.stdout!.destroyed).toBe(false)
    // Completion removes the request abort listener; explicit handle termination still owns descendants.
    abort.abort()
    expect(f.adapter.terminate).not.toHaveBeenCalled()
    handle.terminate()
    expect(f.adapter.terminate).toHaveBeenCalledOnce()
    expect(await handle.waitForExit()).toBe(true)
    expect(f.adapter.close).toHaveBeenCalledOnce()
    f.child.emit('error', new Error('late channel failure'))
    f.child.emit('exit', 1, null)
    f.child.emit('close', 1, null)
    expect(await handle.done).toEqual({ exitCode: 42, signal: null })
  } finally { f.cleanup() }
})

it('rejects invalid bootstrap settlement instead of publishing its exit code', async () => {
  const f = controlledWindows()
  const failure = new Error('missing target outcome')
  f.adapter.alive.mockReturnValue(false)
  f.adapter.outcome.mockImplementation(() => { throw failure })
  const handle = spawnSubprocess(f.spec, { platform: 'win32' })
  try {
    const rejected = expect(handle.done).rejects.toBe(failure)
    f.child.emit('close', 0, null)
    await rejected
    expect(await handle.waitForExit()).toBe(true)
  } finally { f.cleanup() }
})

it('retains an observation failure after an already-aborted wait relinquishes its result', async () => {
  const f = controlledWindows()
  const handle = spawnSubprocess(f.spec, { platform: 'win32' })
  const failure = new Error('membership query failed')
  try {
    expect(await handle.waitForExit(AbortSignal.abort())).toBe(false)
    f.adapter.alive.mockImplementation(() => { throw failure })
    await expect(handle.waitForExit()).rejects.toBe(failure)
    handle.terminate()
    await expect(handle.waitForExit()).rejects.toBe(failure)
    handle.terminateForHostExit()
    expect(f.adapter.close).toHaveBeenCalledOnce()
    f.child.emit('error', failure)
    await expect(handle.done).rejects.toBe(failure)
    f.child.emit('exit', 1, null)
  } finally { f.cleanup() }
})

it('keeps a completed Windows handle owned until failed automatic observation reaches disposal', async () => {
  const f = controlledWindows()
  const ctx = new Context()
  const errors: unknown[] = []
  ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
  const fiber = await ctx.plugin(LocalSubprocessRuntime)
  const runtime = ctx.subprocess as LocalSubprocessRuntime
  runtime.internals.platform = 'win32'
  const failure = new Error('automatic membership query failed')
  f.adapter.alive.mockImplementation(() => { throw failure })
  const handle = ctx.subprocess.spawn(f.spec)
  try {
    f.child.emit('close', 0, null)
    expect(await handle.done).toEqual({ exitCode: 42, signal: null })
    await new Promise(resolve => setImmediate(resolve))
    expect(f.adapter.close).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(f.adapter.terminate).toHaveBeenCalledOnce()
    expect(f.adapter.close).toHaveBeenCalledOnce()
    expect(errors).toEqual([failure])
  } finally { await fiber.dispose(); f.cleanup() }
})

it('closes collected output and its spill descriptors when IPC fails after target output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-windows-settlement-'))
  const child = Object.assign(new EventEmitter(), { pid: 123, stdin: null, stdout: new PassThrough(), stderr: new PassThrough() })
  const alive = vi.fn(() => false)
  const close = vi.fn()
  mocks.launch.mockReturnValue({ child, alive, close })
  const handle = spawnSubprocess({
    argv: ['/target'], cwd: directory, graceMs: 100,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 2, spill: { maxBytes: 100 } }, stderr: { maxBytes: 2, spill: { maxBytes: 100 } } },
  }, { platform: 'win32', spillDir: directory })
  try {
    child.stdout.write('stdout before failure')
    child.stderr.write('stderr before failure')
    expect(mocks.descriptors).toHaveLength(2)
    expect(mocks.descriptors.every(fd => fstatSync(fd).isFile())).toBe(true)
    const error = new Error('bootstrap IPC failed')
    const failed = expect(handle.done).rejects.toBe(error)
    child.emit('error', error)
    await failed
    expect(child.stdout.destroyed).toBe(true)
    expect(child.stderr.destroyed).toBe(true)
    for (const fd of mocks.descriptors) expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }))
    expect(readFileSync(handle.collected.stdout!.readFrom(0).spillPath!, 'utf8')).toBe('stdout before failure')
    expect(readFileSync(handle.collected.stderr!.readFrom(0).spillPath!, 'utf8')).toBe('stderr before failure')
    expect(close).not.toHaveBeenCalled()
    expect(await handle.waitForExit()).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  } finally {
    child.stdout.destroy()
    child.stderr.destroy()
    for (const collector of Object.values(handle.collected)) if (collector instanceof OutputCollector) collector.seal()
    rmSync(directory, { recursive: true })
  }
})

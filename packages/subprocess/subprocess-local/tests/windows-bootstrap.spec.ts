import { fork, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const bootstrap = fileURLToPath(new URL('../src/windows-bootstrap.ts', import.meta.url))
const loader = ['--import', import.meta.resolve('tsx/esm')]

async function runBootstrap(message: unknown): Promise<{ code: number | null; messages: unknown[]; stderr: string }> {
  const child = fork(bootstrap, [], { execArgv: loader, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const messages: unknown[] = []
  let stderr = ''
  child.on('message', value => messages.push(value))
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  child.stdout!.resume()
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
  try {
    child.send(message as Parameters<typeof child.send>[0])
    return { code: await done, messages, stderr }
  } finally {
    clearTimeout(timer)
    child.kill('SIGKILL')
  }
}

const valid = {
  type: 'run-in-owned-job', program: process.execPath,
  args: ['-e', 'process.exit(42)'], environment: { SystemRoot: process.env.SystemRoot ?? '' },
}

describe('Windows bootstrap process IPC', () => {
  it('refuses direct execution without its parent IPC channel', async () => {
    const result = await promisify(execFile)(process.execPath, [...loader, bootstrap], { windowsHide: true })
      .catch((error: unknown) => error)
    expect(result).toHaveProperty('code', 1)
    expect(result).toHaveProperty('stderr', expect.stringContaining('requires its parent IPC channel'))
  })

  it('reports the requested program outcome before closing its IPC channel', async () => {
    const result = await runBootstrap(valid)
    expect(result).toEqual({ code: 0, messages: [{ type: 'outcome', exitCode: 42, signal: null }], stderr: '' })
  })

  it.each([
    { label: 'scalar message', value: 7 },
    { label: 'unknown operation', value: { ...valid, type: 'unknown' } },
    { label: 'missing environment', value: { ...valid, environment: null } },
    { label: 'environment array', value: { ...valid, environment: [] } },
    { label: 'non-string environment value', value: { ...valid, environment: { BAD: 2 } } },
    { label: 'empty executable', value: { ...valid, program: '' } },
    { label: 'non-string executable', value: { ...valid, program: 2 } },
    { label: 'non-array argv', value: { ...valid, args: 'ignored' } },
    { label: 'non-string argument', value: { ...valid, args: ['-e', 2] } },
  ])('refuses $label before starting any program', async ({ value }) => {
    const result = await runBootstrap(value)
    expect(result.code).toBe(1)
    expect(result.messages).toEqual([])
    expect(result.stderr).toContain('Invalid Windows subprocess launch')
  })

  it('reports asynchronous executable lookup failure', async () => {
    const result = await runBootstrap({ ...valid, program: fileURLToPath(new URL('./missing-bootstrap-executable', import.meta.url)) })
    expect(result.code).toBe(1)
    expect(result.messages).toEqual([expect.objectContaining({ type: 'spawn-error', code: 'ENOENT' })])
  })

  it('reports synchronous native argv rejection as a launch failure', async () => {
    const result = await runBootstrap({ ...valid, args: ['contains\u0000nul'] })
    expect(result.code).toBe(1)
    expect(result.messages).toEqual([expect.objectContaining({ type: 'spawn-error', code: 'ERR_INVALID_ARG_VALUE' })])
  })
})

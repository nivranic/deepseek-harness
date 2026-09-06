import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnOptions } from 'node:child_process'
import type { ProcessJob } from '@deepseek-ai/dsh-win32-process'
import { spawnWindowsSubprocess } from '../src/windows-spawn.ts'

const mocks = vi.hoisted(() => ({ fork: vi.fn(), createJob: vi.fn(), isSea: vi.fn(), node: vi.fn(), environment: vi.fn() }))
vi.mock('node:child_process', () => ({ fork: mocks.fork }))
vi.mock('node:sea', () => ({ isSea: mocks.isSea }))
vi.mock('@deepseek-ai/dsh-win32-process', () => ({ createProcessJob: mocks.createJob }))
vi.mock('@deepseek-ai/dsh-node-spawn', () => ({ nodeSpawnCommand: mocks.node }))
vi.mock('@deepseek-ai/dsh-subprocess', () => ({ scrubbedParentEnv: mocks.environment }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.isSea.mockReturnValue(false)
  mocks.node.mockReturnValue({ command: '/node', env: {} })
  mocks.environment.mockReturnValue({ BOOTSTRAP_BASE: 'parent', NODE_OPTIONS: '--require=parent-hook', node_path: '/injected', ELECTRON_ENABLE_LOGGING: '1', TSX_TSCONFIG_PATH: '/target-config' })
})

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 123, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(null); return true }),
  })
  const errors: unknown[] = []
  child.on('error', error => errors.push(error))
  const job = {
    assign: vi.fn<ProcessJob['assign']>(), isEmpty: vi.fn(() => false),
    terminate: vi.fn<ProcessJob['terminate']>(), close: vi.fn<ProcessJob['close']>(),
  }
  mocks.fork.mockReturnValue(child)
  mocks.createJob.mockReturnValue(job)
  const options: SpawnOptions = { cwd: '/workspace', env: { EXPLICIT: 'value' }, stdio: ['pipe', 'pipe', 'pipe'] }
  const launch = () => spawnWindowsSubprocess('/target', ['two words', '中文'], options)
  return { child, errors, job, options, launch }
}

describe('Windows bootstrap launch protocol', () => {
  it('assigns the bootstrap before sending executable, arguments or target environment', () => {
    const f = fixture()
    const handle = f.launch()
    expect(handle.child).toBe(f.child)
    expect(f.job.assign).not.toHaveBeenCalled()
    expect(f.child.send).not.toHaveBeenCalled()
    expect(handle.alive()).toBe(true)
    f.child.emit('spawn')
    expect(f.job.assign).toHaveBeenCalledWith(123)
    expect(f.job.assign.mock.invocationCallOrder[0]).toBeLessThan(f.child.send.mock.invocationCallOrder[0]!)
    expect(f.child.send.mock.calls[0]![0]).toEqual({
      type: 'run-in-owned-job', program: '/target', args: ['two words', '中文'], environment: { EXPLICIT: 'value' },
    })
    expect(handle.alive()).toBe(true)
    f.child.exitCode = 0
    expect(handle.alive()).toBe(true)
    f.job.isEmpty.mockReturnValue(true)
    expect(handle.alive()).toBe(false)
    handle.close()
    handle.close()
    handle.terminate()
    expect(f.job.close).toHaveBeenCalledOnce()
    expect(f.job.terminate).not.toHaveBeenCalled()
    expect(handle.alive()).toBe(false)
  })

  it.each([
    { mode: 'Electron', sea: false, command: '/electron', env: { ELECTRON_RUN_AS_NODE: '1' }, expected: { BOOTSTRAP_BASE: 'parent', ELECTRON_RUN_AS_NODE: '1' } },
    { mode: 'SEA', sea: true, command: '/sea', env: {}, expected: { BOOTSTRAP_BASE: 'parent', DSH_SUBPROCESS_BOOTSTRAP: '1' } },
  ])('keeps $mode launch additions and target startup flags separate', ({ sea, command, env, expected }) => {
    const f = fixture()
    mocks.isSea.mockReturnValue(sea)
    mocks.node.mockReturnValue({ command, env })
    f.launch()
    const forkOptions = mocks.fork.mock.calls[0]![2] as SpawnOptions
    expect(forkOptions.env).toEqual(expected)
    expect(forkOptions.stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
    f.child.emit('spawn')
    expect(f.child.send.mock.calls[0]![0]).toMatchObject({ environment: { EXPLICIT: 'value' } })
  })

  it.each(['pipe', ['pipe', 'pipe']] as const)('requires three explicit standard streams: %j', (stdio) => {
    const f = fixture()
    expect(() => spawnWindowsSubprocess('/target', [], { ...f.options, stdio: typeof stdio === 'string' ? stdio : [...stdio] })).toThrow('three explicit streams')
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('cancels a not-yet-assigned bootstrap without creating a Job or sending target code', () => {
    const f = fixture()
    const handle = f.launch()
    handle.terminate()
    f.child.emit('spawn')
    expect(mocks.createJob).not.toHaveBeenCalled()
    expect(f.child.send).not.toHaveBeenCalled()
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL')
    f.child.signalCode = 'SIGKILL'
    expect(handle.alive()).toBe(false)
    handle.close()
    expect(handle.alive()).toBe(false)
  })

  it('does not publish empty membership when the owner closes an unobserved Job', () => {
    const f = fixture()
    const handle = f.launch()
    handle.close()
    expect(() => handle.alive()).toThrow('without an empty membership observation')
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('stops the bootstrap when Job creation fails', () => {
    const f = fixture()
    const error = new Error('create failed')
    mocks.createJob.mockImplementation(() => { throw error })
    const handle = f.launch()
    f.child.emit('spawn')
    expect(f.errors).toEqual([error])
    expect(f.child.send).not.toHaveBeenCalled()
    f.child.exitCode = 1
    expect(handle.alive()).toBe(false)
    handle.close()
  })

  it('retains a cleanup failure after failed assignment while closing the owned Job', () => {
    const f = fixture()
    const assignment = new Error('assign failed'), cleanup = new Error('cleanup failed')
    f.job.assign.mockImplementation(() => { throw assignment })
    f.job.terminate.mockImplementation(() => { throw cleanup })
    const handle = f.launch()
    f.child.emit('spawn')
    expect(f.errors).toEqual([assignment])
    expect(f.child.send).not.toHaveBeenCalled()
    expect(() => handle.alive()).toThrow(cleanup)
    handle.close()
    expect(f.job.close).toHaveBeenCalledOnce()
  })

  it('keeps direct bootstrap liveness when assignment failed', () => {
    const f = fixture()
    f.job.assign.mockImplementation(() => { throw new Error('assign failed') })
    const handle = f.launch()
    f.child.emit('spawn')
    expect(handle.alive()).toBe(true)
    f.child.exitCode = 1
    expect(handle.alive()).toBe(false)
    handle.close()
    expect(f.job.close).toHaveBeenCalledOnce()
  })

  it('reports an IPC send failure and terminates the owned Job', () => {
    const f = fixture()
    const error = new Error('send failed')
    f.child.send.mockImplementation((_message, callback) => { callback(error); return false })
    f.launch()
    f.child.emit('spawn')
    expect(f.errors).toEqual([error])
    expect(f.job.terminate).toHaveBeenCalledOnce()
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('ignores an IPC send failure delivered after cancellation already owns the launch', () => {
    const f = fixture()
    let finishSend: ((error: Error | null) => void) | undefined
    f.child.send.mockImplementation((_message, callback) => { finishSend = callback; return true })
    const handle = f.launch()
    f.child.emit('spawn')
    handle.terminate()
    finishSend!(new Error('cancelled IPC channel'))
    expect(f.errors).toEqual([])
    expect(f.job.terminate).toHaveBeenCalledOnce()
  })

  it.each([null, 1, { type: 'unknown' }, { type: 'spawn-error', message: 'failed', code: 1 },
    { type: 'outcome', exitCode: 0.5, signal: null }, { type: 'outcome', exitCode: '0', signal: null },
    { type: 'outcome', exitCode: 0, signal: 'invalid' }])('rejects malformed bootstrap messages: %j', (message) => {
    const f = fixture()
    f.launch()
    f.child.emit('spawn')
    f.child.emit('message', message)
    expect(f.errors).toHaveLength(1)
    expect(f.errors[0]).toBeInstanceOf(Error)
    expect(f.job.terminate).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'ENOENT'])('preserves a target spawn failure with code %s', (code) => {
    const f = fixture()
    f.launch()
    f.child.emit('spawn')
    f.child.emit('message', { type: 'spawn-error', message: 'target failed', code })
    expect(f.errors).toEqual([expect.objectContaining({ message: 'target failed', code })])
    expect(f.job.terminate).toHaveBeenCalledOnce()
  })

  it.each([{ exitCode: 42, signal: null }, { exitCode: null, signal: 'SIGTERM' }])('projects the target outcome %j', (outcome) => {
    const f = fixture()
    const handle = f.launch()
    f.child.emit('spawn')
    f.child.emit('message', { type: 'outcome', ...outcome })
    f.child.emit('exit', 0, null)
    expect(f.errors).toEqual([])
    expect(handle.outcome(0, null)).toEqual(outcome)
    f.child.emit('message', { type: 'outcome', ...outcome })
    expect(f.errors).toHaveLength(1)
  })

  it.each([{ exitCode: 0, signal: null }, { exitCode: 1, signal: null }, { exitCode: null, signal: 'SIGKILL' }])('rejects an uncancelled bootstrap exit without a target outcome: %j', ({ exitCode, signal }) => {
    const f = fixture()
    const handle = f.launch()
    f.child.emit('spawn')
    expect(() => handle.outcome(exitCode, signal as NodeJS.Signals | null)).toThrow('without a target outcome')
    f.child.emit('exit', exitCode, signal)
    expect(f.errors).toEqual([expect.objectContaining({ message: 'Windows subprocess bootstrap exited without a target outcome' })])
    expect(f.job.terminate).toHaveBeenCalledOnce()
  })

  it('does not turn a missing target outcome into cancellation when the Job becomes empty first', () => {
    const f = fixture()
    const handle = f.launch()
    f.child.emit('spawn')
    f.job.isEmpty.mockReturnValue(true)
    expect(handle.alive()).toBe(false)
    handle.close()
    f.child.emit('exit', 1, null)
    expect(f.errors).toEqual([expect.objectContaining({ message: 'Windows subprocess bootstrap exited without a target outcome' })])
    expect(f.job.terminate).not.toHaveBeenCalled()
    expect(handle.alive()).toBe(false)
  })

  it('keeps the observed bootstrap outcome when cancellation prevented a target outcome', () => {
    const f = fixture()
    const handle = f.launch()
    handle.terminate()
    f.child.emit('exit', null, 'SIGKILL')
    expect(f.errors).toEqual([])
    expect(handle.outcome(null, 'SIGKILL')).toEqual({ exitCode: null, signal: 'SIGKILL' })
  })

  it('retains termination failure for the exit observer and permits final closure retry', () => {
    const f = fixture()
    const error = new Error('terminate failed')
    f.job.terminate.mockImplementation(() => { throw error })
    const handle = f.launch()
    f.child.emit('spawn')
    handle.terminate()
    expect(() => handle.alive()).toThrow(error)
    f.job.close.mockImplementationOnce(() => { throw new Error('close failed') })
    expect(() =>{  handle.close() }).toThrow('close failed')
    handle.close()
    expect(f.job.close).toHaveBeenCalledTimes(2)
  })
})

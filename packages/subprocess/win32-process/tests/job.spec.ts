import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { createProcessJob } from '../src/job.ts'
import type { ProcessJobBindings } from '../src/job.ts'
import type { NativePtr } from '../src/ffi.ts'

const jobHandle = 50n as NativePtr
const processHandle = 60n as NativePtr

function fixture(overrides: Partial<ProcessJobBindings> = {}) {
  const api = {
    createJobObjectW: vi.fn<ProcessJobBindings['createJobObjectW']>(overrides.createJobObjectW ?? (() => jobHandle)),
    setInformationJobObject: vi.fn<ProcessJobBindings['setInformationJobObject']>(overrides.setInformationJobObject ?? (() => 1)),
    assignProcessToJobObject: vi.fn<ProcessJobBindings['assignProcessToJobObject']>(overrides.assignProcessToJobObject ?? (() => 1)),
    openProcess: vi.fn<ProcessJobBindings['openProcess']>(overrides.openProcess ?? (() => processHandle)),
    closeHandle: vi.fn<ProcessJobBindings['closeHandle']>(overrides.closeHandle ?? (() => 1)),
    getLastError: vi.fn<ProcessJobBindings['getLastError']>(overrides.getLastError ?? (() => 5)),
    formatMessageW: vi.fn<ProcessJobBindings['formatMessageW']>(overrides.formatMessageW ?? (() => 0)),
    queryInformationJobObject: vi.fn<ProcessJobBindings['queryInformationJobObject']>(overrides.queryInformationJobObject ?? ((_job, _cls, buffer) => { buffer.writeUInt32LE(2, 40); return 1 })),
    terminateJobObject: vi.fn<ProcessJobBindings['terminateJobObject']>(overrides.terminateJobObject ?? (() => 1)),
  }
  // This native-call fixture implements exactly the calls consumed by the Job owner.
  return { api, create: () => createProcessJob(api as unknown as ProcessJobBindings) }
}

describe('owned Win32 Jobs', () => {
  it('assigns the gated child with minimum rights and reads kernel membership', () => {
    const { api, create } = fixture()
    const job = create()
    expect(api.createJobObjectW).toHaveBeenCalledWith(null, null)
    const limits = vi.mocked(api.setInformationJobObject).mock.calls[0]!
    expect(limits[1]).toBe(9)
    expect(limits[2].length).toBe(144)
    expect(limits[2].readUInt32LE(16)).toBe(0x2000)
    job.assign(123)
    expect(api.openProcess).toHaveBeenCalledWith(0x101, 0, 123)
    expect(api.assignProcessToJobObject).toHaveBeenCalledWith(jobHandle, processHandle)
    expect(api.closeHandle).toHaveBeenCalledWith(processHandle)
    expect(job.isEmpty()).toBe(false)
    expect(api.queryInformationJobObject).toHaveBeenCalledWith(jobHandle, 1, expect.any(Buffer), 48, null)
    api.queryInformationJobObject.mockImplementationOnce((_job, _cls, buffer) => { buffer.writeUInt32LE(0, 40); return 1 })
    expect(job.isEmpty()).toBe(true)
    job.terminate()
    expect(api.terminateJobObject).toHaveBeenCalledWith(jobHandle, 1)
    job.close()
    job.close()
    expect(api.closeHandle).toHaveBeenCalledTimes(2)
    for (const operation of [() =>{  job.assign(123) }, () => job.isEmpty(), () =>{  job.terminate() }]) {
      expect(operation).toThrow('closed process Job')
    }
    expect(api.openProcess).toHaveBeenCalledTimes(1)
  })

  it('rejects a failed Job allocation without closing an invalid handle', () => {
    const { api, create } = fixture({ createJobObjectW: () => 0n as NativePtr })
    expect(create).toThrow('CreateJobObjectW')
    expect(api.closeHandle).not.toHaveBeenCalled()
  })

  it('closes a Job whose limits could not be configured and retains dual failures', () => {
    const first = fixture({ setInformationJobObject: () => 0 })
    expect(first.create).toThrow('SetInformationJobObject')
    expect(first.api.closeHandle).toHaveBeenCalledWith(jobHandle)
    const second = fixture({ setInformationJobObject: () => 0, closeHandle: () => 0 })
    expect(second.create).toThrow(AggregateError)
  })

  it('rejects unassignable processes and always closes the temporary process handle', () => {
    const unopened = fixture({ openProcess: () => 0n as NativePtr })
    const first = unopened.create()
    expect(() =>{  first.assign(123) }).toThrow('OpenProcess')
    expect(unopened.api.closeHandle).not.toHaveBeenCalled()
    first.close()
    const unassigned = fixture({ assignProcessToJobObject: () => 0 })
    const second = unassigned.create()
    expect(() =>{  second.assign(123) }).toThrow('AssignProcessToJobObject')
    expect(unassigned.api.closeHandle).toHaveBeenCalledWith(processHandle)
    second.close()
  })

  it('retains process-handle closure failure, including a failed assignment', () => {
    for (const assignmentResult of [0, 1]) {
      const { create } = fixture({ assignProcessToJobObject: () => assignmentResult,
        closeHandle: handle => handle === processHandle ? 0 : 1 })
      const job = create()
      expect(() =>{  job.assign(123) }).toThrow(assignmentResult === 0 ? AggregateError : 'CloseHandle')
      job.close()
    }
  })

  it('does not turn failed membership, termination or closure calls into successful observations', () => {
    const { api, create } = fixture({ queryInformationJobObject: () => 0, terminateJobObject: () => 0 })
    const job = create()
    expect(() => job.isEmpty()).toThrow('QueryInformationJobObject')
    expect(() =>{  job.terminate() }).toThrow('TerminateJobObject')
    api.closeHandle.mockReturnValueOnce(0)
    expect(() =>{  job.close() }).toThrow('CloseHandle')
    job.close()
    expect(api.closeHandle).toHaveBeenCalledTimes(2)
  })
})

it.skipIf(process.platform !== 'win32')('retains a real descendant after its assigned parent exits and terminates the complete Job', async () => {
  const job = createProcessJob()
  const child = spawn(process.execPath, ['-e', `
    process.stdin.once('data', () => {
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      child.unref();
      process.stdout.write('descendant-created\\n');
      process.exit(0);
    });
  `], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  try {
    job.assign(child.pid!)
    child.stdin.end('launch after Job assignment')
    expect(await exited).toBe(0)
    expect(job.isEmpty()).toBe(false)
    job.terminate()
    const deadline = performance.now() + 10_000
    while (!job.isEmpty() && performance.now() < deadline) await sleep(10)
    expect(job.isEmpty()).toBe(true)
  } finally {
    child.kill('SIGKILL')
    job.close()
    await exited
  }
}, 15_000)

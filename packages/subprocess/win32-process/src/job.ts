/** Kill-on-close Job ownership for ordinary subprocess trees, including descendants of an exited leader. */
import koffi from 'koffi'
import { JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET, JOBOBJECT_EXTENDED_LIMIT_SIZE, JobObjectExtendedLimitInformation, JobObjectBasicAccountingInformation, JOBOBJECT_BASIC_ACCOUNTING_SIZE, JOBOBJECT_ACTIVE_PROCESSES_OFFSET } from './abi.ts'
import { extendWin32ProcessBindings, isNullPtr, throwLastError } from './ffi.ts'
import type { NativePtr, Win32ProcessBindings } from './ffi.ts'
import { Win32Error } from './errors.ts'

/** Injectable Win32 operations used by an owned Job. */
export interface ProcessJobBindings extends Win32ProcessBindings {
  /** Open one process for Job assignment; the returned handle remains caller-owned. */
  openProcess(access: number, inherit: number, pid: number): NativePtr
  /** Read a Job's kernel accounting record into the supplied buffer. */
  queryInformationJobObject(job: NativePtr, cls: number, information: Buffer, bytes: number, returned: null): number
  /** Request termination of every process assigned to the Job. */
  terminateJobObject(job: NativePtr, exitCode: number): number
}

/** One non-inheritable Job handle; callers establish membership before allowing target code to run. */
export interface ProcessJob {
  /**
   * Assign a live, caller-owned process whose target launch is still gated.
   * @param pid - owned bootstrap PID; its process handle must prevent PID reuse during assignment.
   */
  assign(pid: number): void
  /**
   * Observe kernel membership independently of the direct child's exit.
   * @returns true only when the Job contains no active process; a closed Job cannot be queried.
   */
  isEmpty(): boolean
  /** Request forceful termination; callers must still observe isEmpty before claiming quiescence. */
  terminate(): void
  /** Close the owner handle once, causing Windows to terminate remaining members without claiming they have exited. */
  close(): void
}

let cached: ProcessJobBindings | undefined

/* v8 ignore start -- thin native bindings; real Windows Job regressions exercise their ABI. */
function bindings(): ProcessJobBindings {
  cached ??= extendWin32ProcessBindings(({ kernel32, bind }) => {
    const pointer = koffi.pointer('void')
    return {
      openProcess: bind(kernel32, 'OpenProcess', pointer, ['uint32', 'int', 'uint32']),
      queryInformationJobObject: bind(kernel32, 'QueryInformationJobObject', 'int', [pointer, 'int', pointer, 'uint32', pointer]),
      terminateJobObject: bind(kernel32, 'TerminateJobObject', 'int', [pointer, 'uint32']),
    } as Pick<ProcessJobBindings, 'openProcess' | 'queryInformationJobObject' | 'terminateJobObject'>
  })
  return cached
}
/* v8 ignore stop */

/**
 * Create a Job that owns all assigned processes and their non-breakaway descendants until closed.
 * @param api - injectable native calls; production resolves the shared binding table lazily.
 * @returns a single Job owner, with explicit membership, termination and closure operations.
 */
export function createProcessJob(api: ProcessJobBindings = bindings()): ProcessJob {
  let job: NativePtr | undefined = api.createJobObjectW(null, null)
  if (isNullPtr(job)) throwLastError(api, 'CreateJobObjectW')
  const handle = (): NativePtr => {
    if (job === undefined) throw new Error('Cannot use a closed process Job')
    return job
  }
  const close = (): void => {
    if (job === undefined) return
    if (api.closeHandle(job) === 0) throwLastError(api, 'CloseHandle', 'process Job')
    job = undefined
  }
  const limits = Buffer.alloc(JOBOBJECT_EXTENDED_LIMIT_SIZE)
  limits.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET)
  try {
    if (api.setInformationJobObject(handle(), JobObjectExtendedLimitInformation, limits, limits.length) === 0) {
      throwLastError(api, 'SetInformationJobObject')
    }
  } catch (error) {
    try { close() } catch (cleanup) { throw new AggregateError([error, cleanup], 'Process Job configuration and cleanup failed') }
    throw error
  }
  return {
    assign(pid) {
      const ownedJob = handle()
      // PROCESS_SET_QUOTA | PROCESS_TERMINATE are required by AssignProcessToJobObject.
      const process = api.openProcess(0x0100 | 0x0001, 0, pid)
      if (isNullPtr(process)) throwLastError(api, 'OpenProcess', 'process Job assignment')
      let failure: { error: unknown } | undefined
      try {
        if (api.assignProcessToJobObject(ownedJob, process) === 0) throwLastError(api, 'AssignProcessToJobObject')
      } catch (error) {
        failure = { error }
        throw error
      } finally {
        if (api.closeHandle(process) === 0) {
          const cleanup = new Win32Error('CloseHandle', api.getLastError(), 'Job assignment process')
          if (failure !== undefined) throw new AggregateError([failure.error, cleanup], 'Process Job assignment and cleanup failed')
          throw cleanup
        }
      }
    },
    isEmpty() {
      const accounting = Buffer.alloc(JOBOBJECT_BASIC_ACCOUNTING_SIZE)
      if (api.queryInformationJobObject(handle(), JobObjectBasicAccountingInformation, accounting, accounting.length, null) === 0) {
        throwLastError(api, 'QueryInformationJobObject')
      }
      return accounting.readUInt32LE(JOBOBJECT_ACTIVE_PROCESSES_OFFSET) === 0
    },
    terminate() {
      if (api.terminateJobObject(handle(), 1) === 0) throwLastError(api, 'TerminateJobObject')
    },
    close,
  }
}

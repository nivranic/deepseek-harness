import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'
import {
  createWindowsProcessInspector,
  isInvalidHandle,
  windowsProcessTree,
  WindowsProcessInspector,
} from '@deepseek-ai/dsh-subprocess-local/src/windows-inspector.ts'
import type {
  NativePtr,
  ProcessEntry,
  WindowsProcessInspectorInternals,
  WindowsProcessState,
} from '@deepseek-ai/dsh-subprocess-local/src/windows-inspector.ts'

function fakeInternals() {
  const entries: ProcessEntry[] = []
  const states = new Map<number, WindowsProcessState>()
  const kills: Array<[number, boolean]> = []
  const counts = { enumerations: 0, stateReads: 0 }
  return {
    counts,
    internals: {
      snapshot: () => { counts.enumerations += 1; return [...entries] },
      processState: (pid) => { counts.stateReads += 1; return states.get(pid) },
      taskkill: (pid: number, force: boolean) => { kills.push([pid, force]) },
    } satisfies WindowsProcessInspectorInternals,
    add(entry: ProcessEntry, started?: string, active = true): void {
      entries.push(entry)
      if (started !== undefined) states.set(entry.pid, { started, active })
    },
    kills,
  }
}

describe('WindowsProcessInspector table enumeration', () => {
  it('enumerates the process table only for questions that need it', () => {
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, '0:10')
    fake.add({ pid: 11, parentPid: 10 }, '0:11')
    const inspector = new WindowsProcessInspector(fake.internals)

    // Liveness is a per-handle question on Windows, so a snapshot asked only
    // for liveness must not pay a Toolhelp32 walk. The terminal's Windows
    // teardown polls exactly this way, every 25 ms.
    const observed = inspector.snapshot()
    expect(observed.alive({ pid: 11, started: '0:11' })).toBe(true)
    expect(fake.counts.enumerations).toBe(0)

    expect(observed.tree(10)).toHaveLength(2)
    expect(fake.counts.enumerations).toBe(1)

    // A second tree question reuses the same observation.
    observed.tree(10)
    expect(fake.counts.enumerations).toBe(1)
  })
})

describe('windowsProcessTree', () => {
  it('walks a table children-first with readable identities only', () => {
    const started = (pid: number): string | undefined => pid === 12 ? undefined : `0:${pid}`
    expect(windowsProcessTree([
      { pid: 10, parentPid: 0 },
      { pid: 11, parentPid: 10 },
      { pid: 12, parentPid: 11 },
      { pid: 13, parentPid: 11 },
      { pid: 14, parentPid: 10 },
    ], 10, started)).toEqual([
      { pid: 13, started: '0:13' },
      { pid: 11, started: '0:11' },
      { pid: 14, started: '0:14' },
      { pid: 10, started: '0:10' },
    ])
  })

  it('returns an empty walk for an absent root', () => {
    expect(windowsProcessTree([{ pid: 10, parentPid: 0 }], 99, () => '0:1')).toEqual([])
  })

  it('does not adopt surviving children of an earlier process with the same parent PID', () => {
    const identities = new Map([[10, '1:30'], [11, '1:10'], [12, '1:40'], [13, '1:50']])
    expect(windowsProcessTree([
      { pid: 10, parentPid: 0 },
      { pid: 11, parentPid: 10 },
      { pid: 12, parentPid: 11 },
      { pid: 13, parentPid: 10 },
    ], 10, pid => identities.get(pid))).toEqual([
      { pid: 13, started: '1:50' },
      { pid: 10, started: '1:30' },
    ])
  })

  it('does not descend through a parent whose creation identity is unreadable', () => {
    const entries = [{ pid: 10, parentPid: 0 }, { pid: 11, parentPid: 10 }, { pid: 12, parentPid: 11 }]
    expect(windowsProcessTree(entries, 10, pid => pid === 10 ? undefined : `0:${pid}`)).toEqual([])
    expect(windowsProcessTree(entries, 10, pid => pid === 11 ? undefined : `0:${pid}`))
      .toEqual([{ pid: 10, started: '0:10' }])
  })

  it('compares all FILETIME bits and retains children created in the same clock tick', () => {
    const identities = new Map([[10, '4000000000:4294967295'], [11, '4000000001:0'], [12, '4000000000:4294967295'], [13, '4000000000:4294967294']])
    expect(windowsProcessTree([
      { pid: 10, parentPid: 0 }, { pid: 11, parentPid: 10 }, { pid: 12, parentPid: 10 }, { pid: 13, parentPid: 10 },
    ], 10, pid => identities.get(pid))).toEqual([
      { pid: 11, started: '4000000001:0' },
      { pid: 12, started: '4000000000:4294967295' },
      { pid: 10, started: '4000000000:4294967295' },
    ])
  })

  it('terminates on a parent cycle instead of recursing forever', () => {
    const entries = [
      { pid: 10, parentPid: 11 },
      { pid: 11, parentPid: 10 },
    ]
    expect(windowsProcessTree(entries, 10, () => '0:1')).toHaveLength(2)
  })
})

describe('WindowsProcessInspector (injected internals)', () => {
  it('exposes the shell pid as the pseudo foreground group and never proves stdin waits', () => {
    const fake = fakeInternals()
    const inspector = new WindowsProcessInspector(fake.internals)
    expect(inspector.foregroundPgid(77)).toBe(77)
    expect(inspector.isStdinWaiting(77, 10)).toBe(false)
    expect(inspector.snapshot().session(77)).toEqual([])
  })

  it('delegates tree walks and identity checks to the internals', () => {
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, '0:10')
    fake.add({ pid: 11, parentPid: 10 }, '0:11')
    const inspector = new WindowsProcessInspector(fake.internals)
    expect(inspector.snapshot().tree(10)).toEqual([
      { pid: 11, started: '0:11' },
      { pid: 10, started: '0:10' },
    ])
    expect(inspector.isAlive({ pid: 11, started: '0:11' })).toBe(true)
    expect(inspector.isAlive({ pid: 11, started: 'stale' })).toBe(false)
    expect(inspector.isAlive({ pid: 99, started: '0:99' })).toBe(false)

    fake.add({ pid: 12, parentPid: 10 }, '0:12', false)
    expect(inspector.isAlive({ pid: 12, started: '0:12' })).toBe(false)
  })

  it('maps SIGKILL to a forced taskkill and other signals to the grace form', () => {
    const fake = fakeInternals()
    const inspector = new WindowsProcessInspector(fake.internals)
    inspector.signalGroup(77, 'SIGKILL')
    inspector.signalGroup(77, 'SIGTERM')
    inspector.signalGroup(0, 'SIGKILL')
    expect(fake.kills).toEqual([[77, true], [77, false], [0, true]])
  })

  it('signals a process only while its start identity matches', () => {
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, '0:10')
    fake.add({ pid: 11, parentPid: 10 }, '0:11', false)
    const inspector = new WindowsProcessInspector(fake.internals)
    inspector.signalProcess({ pid: 10, started: '0:10' }, 'SIGKILL')
    inspector.signalProcess({ pid: 11, started: '0:11' }, 'SIGKILL')
    inspector.signalProcess({ pid: 10, started: 'stale' }, 'SIGTERM')
    expect(fake.kills).toEqual([[10, true]])
  })

  it('accepts an injected internals factory through the creator', () => {
    const fake = fakeInternals()
    expect(createWindowsProcessInspector(fake.internals)).toBeInstanceOf(WindowsProcessInspector)
    expect(createWindowsProcessInspector()).toBeInstanceOf(WindowsProcessInspector)
  })
})

describe('isInvalidHandle', () => {
  it('rejects null, zero, and the all-ones INVALID_HANDLE_VALUE forms', () => {
    const ptr = (value: bigint): NativePtr => value as NativePtr
    expect(isInvalidHandle(null)).toBe(true)
    expect(isInvalidHandle(undefined)).toBe(true)
    expect(isInvalidHandle(ptr(0n))).toBe(true)
    expect(isInvalidHandle(ptr(0xFFFFFFFFFFFFFFFFn))).toBe(true)
    expect(isInvalidHandle(ptr(-1n))).toBe(true)
    expect(isInvalidHandle(ptr(1234n))).toBe(false)
  })
})

const win32 = process.platform === 'win32' ? describe : describe.skip

win32('WindowsProcessInspector over the real koffi bindings', () => {
  it('leaves no manually allocated native output storage after inspection', () => {
    const pending = new Set<unknown>()
    const allocate = koffi.alloc, release = koffi.free
    const allocation = vi.spyOn(koffi, 'alloc').mockImplementation((type, count) => {
      const pointer: unknown = allocate(type, count)
      pending.add(pointer)
      return pointer
    })
    const freeing = vi.spyOn(koffi, 'free').mockImplementation((pointer: unknown) => {
      expect(pending.delete(pointer)).toBe(true)
      release(pointer)
    })
    try {
      const inspector = createWindowsProcessInspector()
      const self = inspector.snapshot().tree(process.pid).find(identity => identity.pid === process.pid)
      expect(self).toBeDefined()
      expect(inspector.isAlive(self!)).toBe(true)
      expect(pending.size).toBe(0)
    } finally {
      allocation.mockRestore()
      freeing.mockRestore()
      for (const pointer of pending) release(pointer)
    }
  })

  it('keeps native inspection usable across independent module generations', async () => {
    const original = createWindowsProcessInspector().snapshot().tree(process.pid)
      .find(identity => identity.pid === process.pid)
    expect(original).toBeDefined()
    vi.resetModules()
    const reloaded = await import('../src/windows-inspector.ts')
    const inspector = reloaded.createWindowsProcessInspector()
    expect(inspector.snapshot().tree(process.pid)).toContainEqual(original)
    expect(inspector.isAlive(original!)).toBe(true)
  })

  it('walks the live process table from the test runner itself', () => {
    const inspector = createWindowsProcessInspector()
    const tree = inspector.snapshot().tree(process.pid)
    const self = tree.find(member => member.pid === process.pid)
    expect(self).toBeDefined()
    expect(inspector.snapshot().alive(self!)).toBe(true)
    expect(inspector.foregroundPgid(process.pid)).toBe(process.pid)
  })

  it('reports unreadable identities for absent processes and no-ops tree signalling', () => {
    const inspector = createWindowsProcessInspector()
    expect(inspector.isAlive({ pid: 0x7FFFFFFF, started: 'absent' })).toBe(false)
    expect(() => { inspector.signalGroup(0x7FFFFFFF, 'SIGKILL') }).not.toThrow()
    expect(() => { inspector.signalGroup(0x7FFFFFFF, 'SIGTERM') }).not.toThrow()
    expect(() => { inspector.signalGroup(0, 'SIGKILL') }).not.toThrow()
    expect(() => { inspector.signalProcess({ pid: 0x7FFFFFFF, started: 'absent' }, 'SIGKILL') }).not.toThrow()
  })
})

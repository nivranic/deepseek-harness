/**
 * The interrupted-transfer recovery matrix through the real face and store: a
 * complete read walks fixed windows and announces progress; a failure after
 * received bytes keeps the prefix and `resumeAll` continues from the first
 * missing byte without re-reading; a failure before any byte keeps nothing; a
 * version change under the attempt restarts from zero; a broken window
 * contract fails loudly; and a retired generation writes nothing.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { textFace } from '../src/client/face.ts'
import type { ReadDocumentByteWindow } from '../src/client/rpc.ts'
import { createTextStore } from '../src/client/store.ts'
import { ABSOLUTE_PATH, FILE } from './fixtures.client.ts'

const TAB_1 = 'tab-1' as TabId

/** One window of the test file's bytes, base64-encoded as the wire carries it. */
function wireWindow(offset: number, data: Uint8Array, eof: boolean, version = 'v1', bytes?: number): WorkspaceFileBytes {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return {
    absolutePath: ABSOLUTE_PATH, version, offset, data: btoa(binary), eof,
    ...(bytes !== undefined ? { bytes } : {}),
  }
}

/** One failed window read. */
function windowFailure(code: string): RemoteResult<WorkspaceFileBytes> {
  return { ok: false, error: { code, message: 'boom', details: {} } as never }
}

/**
 * The window bench: readWindow awaits the spec's settlement keyed by the
 * offset the face asked for, so a resume continuing from the received prefix
 * is visible as the next request's key.
 */
function bench() {
  const instance = createTextStore().create()
  const pending = new Map<number, PromiseWithResolvers<RemoteResult<WorkspaceFileBytes>>>()
  const offsets: number[] = []
  const readWindow = vi.fn<ReadDocumentByteWindow>((_file, offset) => {
    offsets.push(offset)
    const deferred = Promise.withResolvers<RemoteResult<WorkspaceFileBytes>>()
    pending.set(offset, deferred)
    return deferred.promise
  })
  const readAll = vi.fn()
  const controller = new AbortController()
  onTestFinished(() => {
    controller.abort()
    for (const deferred of pending.values()) deferred.resolve(windowFailure('workspace-file/not-found'))
  })
  const face = textFace(vi.fn(), readAll, undefined, readWindow)('s-1' as never, instance.actions)
  /** Settle the outstanding request for one offset, or the oldest one. */
  const settleWindow = async (result: RemoteResult<WorkspaceFileBytes>, offset?: number): Promise<void> => {
    const key = offset ?? [...pending.keys()][0]
    if (key === undefined) throw new Error('no outstanding window')
    const deferred = pending.get(key)
    if (deferred === undefined) throw new Error(`no outstanding window at ${key}`)
    pending.delete(key)
    deferred.resolve(result)
    await deferred.promise
  }
  return {
    instance, face, readWindow, readAll, offsets, settleWindow, controller,
    tab: () => instance.getSnapshot().byTab[TAB_1],
  }
}

const FIRST = Uint8Array.of(1, 2, 3)
const SECOND = Uint8Array.of(4, 5)

describe('textFace windowed complete-byte transfer', () => {
  it('completes across windows, announcing progress and assembling the file', async () => {
    const { face, offsets, settleWindow, tab } = bench()
    face.loadAll(TAB_1, FILE, new AbortController().signal)
    await settleWindow({ ok: true, value: wireWindow(0, FIRST, false, 'v1', 5) })
    expect(tab()).toMatchObject({ loading: true, transfer: { received: 3, size: 5 } })
    await settleWindow({ ok: true, value: wireWindow(3, SECOND, true, 'v1', 5) })
    expect(offsets).toEqual([0, 3])
    const complete = tab()?.complete
    expect(Array.from(complete?.data ?? [])).toEqual([1, 2, 3, 4, 5])
    expect(complete).toMatchObject({ version: 'v1', offset: 0, eof: true, bytes: 5 })
    expect(tab()?.transfer).toBeUndefined()
    expect(tab()?.loading).toBe(false)
  })

  it('completes a zero-byte file through one empty eof window', async () => {
    const { face, settleWindow, tab } = bench()
    face.loadAll(TAB_1, FILE, new AbortController().signal)
    await settleWindow({ ok: true, value: wireWindow(0, new Uint8Array(), true, 'v1', 0) })
    expect(tab()?.complete?.data.byteLength).toBe(0)
    expect(tab()?.complete?.eof).toBe(true)
  })

  it('keeps the received prefix on a mid-transfer failure and resumes from the first missing byte', async () => {
    const { face, readWindow, offsets, settleWindow, tab } = bench()
    const controller = new AbortController()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleWindow({ ok: true, value: wireWindow(0, FIRST, false, 'v1', 5) })
    await settleWindow(windowFailure('workspace-file/not-found'))
    expect(tab()?.failure?.code).toBe('workspace-file/not-found')
    expect(tab()).toMatchObject({ transfer: { received: 3, size: 5 } })

    face.resumeAll(TAB_1, FILE, controller.signal)
    // The resume continues at the received prefix, not from zero, and the
    // progress the interruption left is still visible while the window flies.
    expect(readWindow).toHaveBeenCalledTimes(3)
    expect(tab()?.transfer).toMatchObject({ received: 3, size: 5 })
    await settleWindow({ ok: true, value: wireWindow(3, SECOND, true, 'v1', 5) }, 3)
    expect(offsets).toEqual([0, 3, 3])
    expect(Array.from(tab()?.complete?.data ?? [])).toEqual([1, 2, 3, 4, 5])
    expect(tab()?.failure).toBeUndefined()
  })

  it('keeps nothing when the first window fails, and a retry reads from zero', async () => {
    const { face, readWindow, settleWindow, tab } = bench()
    const controller = new AbortController()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleWindow(windowFailure('workspace-file/not-found'))
    expect(tab()?.failure?.code).toBe('workspace-file/not-found')
    expect(tab()?.transfer).toBeUndefined()

    // A resume with no held prefix asks for no window.
    face.resumeAll(TAB_1, FILE, controller.signal)
    expect(readWindow).toHaveBeenCalledTimes(1)
    face.reloadAll(TAB_1, FILE, controller.signal)
    await settleWindow({ ok: true, value: wireWindow(0, FIRST, true, 'v1', 3) }, 0)
    expect(Array.from(tab()?.complete?.data ?? [])).toEqual([1, 2, 3])
  })

  it('restarts from zero when the file version changes under the attempt', async () => {
    const { face, offsets, settleWindow, tab } = bench()
    const controller = new AbortController()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleWindow({ ok: true, value: wireWindow(0, FIRST, false, 'v1', 5) })
    // The resumed window reports the newer version: the prefix is discarded.
    await settleWindow({ ok: true, value: wireWindow(3, SECOND, true, 'v2', 7) }, 3)
    expect(tab()?.complete).toBeUndefined()
    expect(tab()?.transfer).toBeUndefined()
    // The restart reads from zero and completes on the new version alone.
    await settleWindow({ ok: true, value: wireWindow(0, Uint8Array.of(9), true, 'v2', 7) }, 0)
    expect(offsets).toEqual([0, 3, 0])
    expect(Array.from(tab()?.complete?.data ?? [])).toEqual([9])
    expect(tab()?.complete?.version).toBe('v2')
  })

  it('fails loudly when a window breaks the offset contract', async () => {
    const { face, settleWindow, tab } = bench()
    face.loadAll(TAB_1, FILE, new AbortController().signal)
    await settleWindow({ ok: true, value: wireWindow(8, FIRST, false, 'v1', 5) })
    expect(tab()?.failure).toMatchObject({ code: 'gateway/internal' })
    expect(tab()?.transfer).toBeUndefined()
  })

  it('fails loudly when a non-eof window arrives empty', async () => {
    const { face, settleWindow, tab } = bench()
    face.loadAll(TAB_1, FILE, new AbortController().signal)
    await settleWindow({ ok: true, value: wireWindow(0, new Uint8Array(), false, 'v1', 5) })
    expect(tab()?.failure).toMatchObject({ code: 'gateway/internal' })
  })

  it('writes nothing when the tab retires mid-transfer', async () => {
    const { face, controller, settleWindow, tab } = bench()
    face.loadAll(TAB_1, FILE, controller.signal)
    await settleWindow({ ok: true, value: wireWindow(0, FIRST, false, 'v1', 5) })
    controller.abort()
    expect(tab()).toBeUndefined()
    // A late settlement for the aborted attempt must not resurrect the bucket.
    await settleWindow({ ok: true, value: wireWindow(3, SECOND, true, 'v1', 5) }, 3)
    expect(tab()).toBeUndefined()
  })
})

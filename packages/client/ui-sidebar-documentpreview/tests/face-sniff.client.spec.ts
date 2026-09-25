/** Header inspection shares the tab lifetime and read generation. */
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { textFace } from '../src/client/face.ts'
import { createTextStore } from '../src/client/store.ts'
import { FILE, SESSION, page } from './fixtures.client.ts'

const TAB = 'sniff-tab' as TabId
const png = { absolutePath: '/a', version: 'v1', offset: 0, data: 'iVBORw0KGgo=', eof: true }

function bench() {
  const instance = createTextStore().create()
  const pending = Promise.withResolvers<RemoteResult<WorkspaceFileBytes>>()
  const readHead = vi.fn(() => pending.promise)
  const lifetime = new AbortController()
  const tab = new AbortController()
  const read = vi.fn(async () => page(1, ['text'], true))
  const readAll = vi.fn(async () => ({ ok: true as const, value: png }))
  const face = textFace(read, readAll, lifetime.signal, undefined, readHead)(SESSION, instance.actions)
  return { instance, pending, readHead, lifetime, tab, face }
}

describe('header inspection', () => {
  it('settles an image signature without loading text', async () => {
    const h = bench()
    h.face.sniff!(TAB, FILE, h.tab.signal)
    expect(h.instance.getSnapshot().byTab[TAB]?.sniff).toEqual({ status: 'pending' })
    h.pending.resolve({ ok: true, value: png })
    await h.pending.promise
    expect(h.instance.getSnapshot().byTab[TAB]?.sniff).toEqual({ status: 'done', match: { kind: 'image', mediaType: 'image/png' } })
    h.tab.abort()
    expect(h.instance.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it.each([
    { ok: true as const, value: { ...png, data: '!!!' } },
    { ok: true as const, value: { ...png, offset: 8 } },
    { ok: true as const, value: { ...png, data: '' } },
    { ok: false as const, error: { name: 'RemoteError', isDSHRemoteError: true as const, code: 'gateway/internal' as const, message: 'failed', details: {} } },
  ])('settles unusable header replies once', async (result) => {
    const h = bench()
    h.face.sniff!(TAB, FILE, h.tab.signal)
    h.pending.resolve(result)
    await h.pending.promise
    expect(h.instance.getSnapshot().byTab[TAB]?.sniff).toEqual({ status: 'done', match: undefined })
    expect(h.readHead).toHaveBeenCalledTimes(1)
    h.tab.abort()
  })

  it.each(['tab', 'lifetime'] as const)('discards a late header after %s disposal', async (owner) => {
    const h = bench()
    h.face.sniff!(TAB, FILE, h.tab.signal)
    h[owner].abort()
    h.pending.resolve({ ok: true, value: png })
    await h.pending.promise
    expect(h.instance.getSnapshot().byTab[TAB]).toBeUndefined()
    h.face.sniff!(TAB, FILE, h.tab.signal)
    expect(h.readHead).toHaveBeenCalledTimes(1)
  })

  it('ignores a header retired by reload', async () => {
    const h = bench()
    h.face.sniff!(TAB, FILE, h.tab.signal)
    h.face.reloadPages(TAB, FILE, h.tab.signal)
    h.pending.resolve({ ok: true, value: png })
    await h.pending.promise
    expect(h.instance.getSnapshot().byTab[TAB]?.sniff).toBeUndefined()
    expect(h.instance.getSnapshot().byTab[TAB]?.pages[1]?.text).toBe('text')
    h.tab.abort()
  })
})


it('clears pending inspection when a renderer changes loading mode', async () => {
  const h = bench()
  h.face.sniff!(TAB, FILE, h.tab.signal)
  h.face.loadAll(TAB, FILE, h.tab.signal)
  expect(h.instance.getSnapshot().byTab[TAB]?.sniff).toBeUndefined()
  h.pending.resolve({ ok: true, value: png })
  await h.pending.promise
  expect(h.instance.getSnapshot().byTab[TAB]?.sniff).toBeUndefined()
  h.tab.abort()
})

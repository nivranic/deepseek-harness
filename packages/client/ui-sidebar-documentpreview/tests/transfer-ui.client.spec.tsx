/**
 * What the reader sees of a windowed complete-byte transfer: each settled
 * window's progress line while the read flies, and on an interruption after
 * received bytes, the kept-prefix notice with a resume that continues from the
 * first missing byte and a retry that starts over.
 */
// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import { TextPreview } from '../src/client/TextPreview.tsx'
import type { TextPreviewProps } from '../src/client/TextPreview.tsx'
import { textFace } from '../src/client/face.ts'
import type { ReadDocumentByteWindow } from '../src/client/rpc.ts'
import { createTextStore } from '../src/client/store.ts'
import type { DocumentPreviewDefinition } from '../src/client/document/registry.ts'
import { SESSION, TAB_ID, t } from './fixtures.client.ts'

/** A `.bin` address so the bytes-complete definition matches the tab's path. */
const BIN_ADDRESS = 'dsh-resource://file/session/s-1/work/asset.bin'

const DEFINITION: DocumentPreviewDefinition = {
  id: 'bytes', extensions: ['bin'], title: () => 'Bytes', loading: 'bytes-complete', wrap: false,
}

function wireWindow(offset: number, data: Uint8Array, eof: boolean, bytes: number): WorkspaceFileBytes {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return { absolutePath: '/host/work/asset.bin', version: 'v1', offset, data: btoa(binary), eof, bytes }
}

/** The UI bench: the real store and face over one deferred window read. */
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
  const controller = new AbortController()
  onTestFinished(() => {
    controller.abort()
    for (const deferred of pending.values()) deferred.resolve({ ok: false, error: { code: 'workspace-file/not-found', message: 'boom', details: {} } as never })
  })
  const face = textFace(vi.fn(), vi.fn(), undefined, readWindow)(SESSION, instance.actions)
  const snapshot: ResourceSnapshot<WorkspaceFileStat> = {
    status: 'live', value: { absolutePath: '/host/work/asset.bin', version: 'v1', bytes: 5 }, failure: undefined,
  }
  const useResource = vi.fn(() => snapshot)
  const props = (): TextPreviewProps => ({
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB_ID, kind: 'text', contentId: BIN_ADDRESS, title: 'asset.bin', visible: true,
        navigation: { address: BIN_ADDRESS, params: undefined, revision: 1 },
        signal: controller.signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn(), replace: vi.fn() },
      },
    }),
    sessionId: SESSION,
    useResource,
    useStore: (selector: (state: { byTab: Record<TabId, unknown> }) => unknown) =>
      selector(useSyncExternalStore(
        (notify: () => void) => instance.subscribe(notify),
        () => instance.getSnapshot(),
      )),
    actions: instance.actions,
    loadPage: face.loadPage,
    reloadPages: face.reloadPages,
    loadAll: face.loadAll,
    reloadAll: face.reloadAll,
    resumeAll: face.resumeAll,
    useDocumentPreviews: (select: (value: readonly DocumentPreviewDefinition[]) => unknown) => select([DEFINITION]),
    renderSlot: () => null,
    t,
  }) as unknown as TextPreviewProps
  const settle = async (result: RemoteResult<WorkspaceFileBytes>, offset?: number): Promise<void> => {
    const key = offset ?? [...pending.keys()][0]
    if (key === undefined) throw new Error('no outstanding window')
    const deferred = pending.get(key)
    if (deferred === undefined) throw new Error(`no outstanding window at ${key}`)
    pending.delete(key)
    deferred.resolve(result)
    await deferred.promise
  }
  return { instance, face, readWindow, offsets, props, settle, controller }
}

describe('TextPreview — windowed transfer', () => {
  it('announces each settled window while the read flies', async () => {
    const { props, settle } = bench()
    const view = render(<TextPreview {...props()} />)
    await settle({ ok: true, value: wireWindow(0, Uint8Array.of(1, 2, 3), false, 5) })
    const progress = view.container.querySelector('[data-textpreview-transfer]')
    expect(progress?.getAttribute('data-textpreview-transfer')).toBe('3')
    expect(progress?.textContent).toContain('3')
    cleanup()
  })

  it('shows the kept-prefix notice on an interruption and resumes from the first missing byte', async () => {
    const { props, readWindow, offsets, settle, instance } = bench()
    const view = render(<TextPreview {...props()} />)
    await settle({ ok: true, value: wireWindow(0, Uint8Array.of(1, 2, 3), false, 5) })
    await settle({ ok: false, error: { code: 'workspace-file/not-found', message: 'boom', details: {} } as never })
    const interrupted = view.container.querySelector('[data-textpreview-interrupted]')
    expect(interrupted?.getAttribute('data-textpreview-interrupted')).toBe('3')
    expect(view.container.querySelector('[data-textpreview-resume]')).not.toBeNull()
    expect(view.container.querySelector('[data-textpreview-retry]')).not.toBeNull()

    fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-textpreview-resume]')!)
    expect(offsets).toEqual([0, 3, 3])
    await settle({ ok: true, value: wireWindow(3, Uint8Array.of(4, 5), true, 5) }, 3)
    expect(readWindow).toHaveBeenCalledTimes(3)
    expect(view.container.querySelector('[data-textpreview-interrupted]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-resume]')).toBeNull()
    expect(Array.from(instance.getSnapshot().byTab[TAB_ID]?.complete?.data ?? [])).toEqual([1, 2, 3, 4, 5])
    cleanup()
  })
})

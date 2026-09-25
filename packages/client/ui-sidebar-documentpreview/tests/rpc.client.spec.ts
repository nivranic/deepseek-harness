/**
 * The address-to-read translation: a `dsh-resource://file/session/<id>/<path>`
 * address names the session the read runs under and the workspace-relative path
 * it hands the Host; absolute paths also travel inside the Session address.
 * An address without a Session fails loud.
 */
import { describe, expect, it, vi } from 'vitest'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { createReadByteWindow, createReadPage, documentFileBytes, hostFileOf } from '../src/client/rpc.ts'
import type { ReadDocumentByteWindow, ReadWorkspaceFilePage, WorkspaceFilesReadRemote } from '../src/client/rpc.ts'
import { TRANSFER_WINDOW_BYTES } from '../src/client/bytes/transfer.ts'
import { ADDRESS, FILE, PATH, SESSION, page } from './fixtures.client.ts'

describe('hostFileOf', () => {
  it('reads the session and the decoded relative path out of a session file address', () => {
    expect(hostFileOf(ADDRESS)).toEqual(FILE)
    expect(hostFileOf('dsh-resource://file/session/s%2F1/work/a%20b%23c.md')).toEqual({ sessionId: 's/1', path: 'work/a b#c.md' })
  })

  it.each(['/etc/hosts', 'C:/w/a b.md', '//host/share/a b.md'])('preserves the Session address\'s absolute path %s for the Host', (path) => {
    expect(hostFileOf(sessionFileAddress(SESSION, path))).toEqual({ sessionId: SESSION, path })
  })

  it('throws for an address that is not a Session file address', () => {
    for (const address of [
      'dsh-resource://file/absolute/etc/hosts', 'dsh-resource://file/absolute/C:/w/a.md',
      'dsh-resource://file/shared/team/notes.md', 'dsh-resource://file/session', 'file:///work/notes.md', 'sidebar://guide',
    ]) {
      expect(() => hostFileOf(address)).toThrow('not a session file address')
    }
  })
})

describe('createReadPage', () => {
  it('binds the paged read to the Remote with the offset as the only range', async () => {
    const read = vi.fn<WorkspaceFilesReadRemote['workspaceFiles']['read']>(() => Promise.resolve(page(4, ['d'], true)))
    const signal = new AbortController().signal
    const readPage: ReadWorkspaceFilePage = createReadPage({ workspaceFiles: { read, readBytes: vi.fn() } })
    await expect(readPage(SESSION, PATH, 4, signal)).resolves.toEqual(page(4, ['d'], true))
    expect(read).toHaveBeenCalledWith(SESSION, PATH, { offset: 4 }, signal)
  })
})

describe('createReadByteWindow', () => {
  it('binds the window read at the transfer window size', async () => {
    const value = { absolutePath: '/workspace/a.bin', version: 'v1', bytes: 3, offset: 4, data: 'AAH/', eof: false }
    const readBytes = vi.fn<WorkspaceFilesReadRemote['workspaceFiles']['readBytes']>(() => Promise.resolve({ ok: true, value }))
    const signal = new AbortController().signal
    const readWindow: ReadDocumentByteWindow = createReadByteWindow({ workspaceFiles: { read: vi.fn(), readBytes } })
    await expect(readWindow(FILE, 4, signal)).resolves.toEqual({ ok: true, value })
    expect(readBytes).toHaveBeenCalledWith(SESSION, PATH, { offset: 4, length: TRANSFER_WINDOW_BYTES }, signal)
  })
})

describe('documentFileBytes', () => {
  it.each(['', 'AAH/'])('decodes complete Remote bytes without changing metadata (%j)', (data) => {
    const file = { absolutePath: '/workspace/a.bin', version: 'v1', bytes: 3, offset: 0, data, eof: true }
    const result = documentFileBytes(file)
    expect(result).toEqual({ ...file, data: data === '' ? new Uint8Array() : new Uint8Array([0, 1, 255]) })
    expect(result.data.buffer).toBeInstanceOf(ArrayBuffer)
    expect(file.data).toBe(data)
  })

  it('rejects malformed wire base64', () => {
    expect(() => documentFileBytes({ absolutePath: '/workspace/a.bin', version: 'v1', offset: 0, data: '!!!', eof: true })).toThrow()
  })
})

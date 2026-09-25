/**
 * The transfer engine's pure pieces: wire windows decode to native bytes,
 * malformed base64 fails loudly, and chunks assemble in arrival order with an
 * exact byte count — the guarantees the face's resume arithmetic leans on.
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import { TRANSFER_WINDOW_BYTES } from '../src/client/bytes/transfer.ts'
import { assembleTransfer, decodeBase64Bytes, decodeTransferWindow } from '../src/client/bytes/transfer.ts'

function window(data: string, eof: boolean, offset = 0, bytes?: number): WorkspaceFileBytes {
  return {
    absolutePath: '/work/asset.bin', version: 'v1', offset, data: btoa(data), eof,
    ...(bytes !== undefined ? { bytes } : {}),
  }
}

describe('bytes/transfer', () => {
  it('decodes one wire window with native bytes and stat fields', () => {
    const decoded = decodeTransferWindow(window('AB\x00CD', false, 4, 12))
    expect(decoded.offset).toBe(4)
    expect(Array.from(decoded.data)).toEqual([65, 66, 0, 67, 68])
    expect(decoded.eof).toBe(false)
    expect(decoded.version).toBe('v1')
    expect(decoded.bytes).toBe(12)
  })

  it('keeps a window without a reported size usable', () => {
    expect(decodeTransferWindow(window('', true)).bytes).toBeUndefined()
  })

  it('rejects malformed base64 loudly', () => {
    expect(() => { decodeTransferWindow({ ...window('A', true), data: 'not base64!!' }) }).toThrow()
    expect(() => { decodeBase64Bytes('>>>>') }).toThrow()
  })

  it('assembles chunks in arrival order with an exact byte count', () => {
    const assembled = assembleTransfer([
      Uint8Array.of(1, 2, 3),
      Uint8Array.of(),
      Uint8Array.of(4, 5),
    ])
    expect(Array.from(assembled)).toEqual([1, 2, 3, 4, 5])
    expect(assembled.byteLength).toBe(5)
  })

  it('assembles an empty chunk list into an empty buffer, not an error', () => {
    expect(assembleTransfer([]).byteLength).toBe(0)
  })

  it('keeps the window size at or below the Host default window cap', () => {
    // The Host refuses a window above its configured maxBytes (2 MiB by
    // default); the transfer window must stay valid at that default.
    expect(TRANSFER_WINDOW_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024)
  })
})

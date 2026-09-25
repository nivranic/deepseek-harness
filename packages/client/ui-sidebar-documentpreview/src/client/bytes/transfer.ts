/**
 * The interrupted-transfer recovery engine for complete-byte reads: one file
 * arrives as fixed windows, a failed attempt keeps its received prefix, and a
 * resume continues from the first missing byte — never re-reading what the tab
 * already holds, and restarting from zero when the Host reports the file's
 * version moved under the attempt.
 *
 * Pure pieces live here so the matrix is testable without a Host: base64
 * window decoding and chunk assembly. The driving loop belongs to the face,
 * which owns read generations and tab lifetimes.
 */
import type { WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'

/**
 * Bytes per `readBytes` window. The Host refuses a window above its configured
 * `maxBytes` cap (2 MiB by default); half the cap keeps the request valid
 * whatever the deployment configures above this floor.
 */
export const TRANSFER_WINDOW_BYTES = 1024 * 1024

/** One decoded `readBytes` window, ready for assembly. */
export interface TransferWindow {
  /** Window start, as requested. */
  readonly offset: number
  /** The window's bytes; empty only at or past the file's end. */
  readonly data: Uint8Array
  /** Whether the window includes the file's last byte. */
  readonly eof: boolean
  /** File version at the stat before the window. */
  readonly version: string
  /** Absolute file path at the stat before the window. */
  readonly absolutePath: string
  /** Complete file size when the backend reports it. */
  readonly bytes: number | undefined
}

/**
 * Decode base64 into bytes.
 * @param data - base64 text the wire carried.
 * @returns the decoded bytes; malformed input throws.
 */
export function decodeBase64Bytes(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), character => character.charCodeAt(0))
}

/**
 * Decode one successful `readBytes` window.
 * @param value - Host window result with base64 data.
 * @returns the window with native bytes; malformed base64 throws.
 */
export function decodeTransferWindow(value: WorkspaceFileBytes): TransferWindow {
  return {
    offset: value.offset,
    data: decodeBase64Bytes(value.data),
    eof: value.eof,
    version: value.version,
    absolutePath: value.absolutePath,
    bytes: value.bytes,
  }
}

/**
 * Concatenate received windows into the complete file.
 * @param chunks - windows in arrival order.
 * @returns one buffer holding every received byte.
 */
export function assembleTransfer(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const assembled = new Uint8Array(new ArrayBuffer(total))
  let written = 0
  for (const chunk of chunks) {
    assembled.set(chunk, written)
    written += chunk.byteLength
  }
  return assembled
}

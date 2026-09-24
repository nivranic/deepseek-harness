/** Pure byte-window formatting for the binary document preview; no React or DOM here. */

/** Display bound: the preview shows at most this many leading bytes. */
export const MAX_PREVIEW_BYTES = 256

/** Bytes per hex row. */
export const HEX_ROW_BYTES = 16

/** One formatted hex row with its file offset. */
export interface HexRow {
  /** File offset of the row's first byte. */
  readonly offset: number
  /** Lowercase two-digit hex pairs, one per byte in the row. */
  readonly cells: readonly string[]
}

/**
 * Format a bounded leading window of a byte array as hex rows.
 * @param data - the complete file bytes as loaded.
 * @returns hex rows covering at most {@link MAX_PREVIEW_BYTES} leading bytes.
 */
export function hexRowsOf(data: Uint8Array<ArrayBuffer>): readonly HexRow[] {
  const rows: HexRow[] = []
  const shown = Math.min(data.byteLength, MAX_PREVIEW_BYTES)
  for (let start = 0; start < shown; start += HEX_ROW_BYTES) {
    const cells: string[] = []
    for (let index = start; index < Math.min(start + HEX_ROW_BYTES, shown); index += 1) {
      cells.push(data[index]?.toString(16).padStart(2, '0') ?? '00')
    }
    rows.push({ offset: start, cells })
  }
  return rows
}

/**
 * Locale-agnostic byte formatting for the size fact: binary thousands with no
 * fraction, so the card never implies a precision it does not have.
 * @param bytes - complete file size.
 * @returns the size formatted with a thousands separator.
 */
export function formatByteCount(bytes: number): string {
  return bytes.toLocaleString('en-US')
}

/** Pure byte formatting: hex window bounds, row width, and size formatting. */
import { describe, expect, it } from 'vitest'
import { formatByteCount, hexRowsOf, HEX_ROW_BYTES, MAX_PREVIEW_BYTES } from '../src/client/binary/bytes.ts'

describe('hexRowsOf', () => {
  it('returns no rows for an empty file', () => {
    expect(hexRowsOf(new Uint8Array(0))).toEqual([])
  })

  it('formats a partial single row with lowercase two-digit cells', () => {
    const rows = hexRowsOf(new Uint8Array([0x00, 0x0f, 0xa5, 0xff]))
    expect(rows).toEqual([{ offset: 0, cells: ['00', '0f', 'a5', 'ff'] }])
  })

  it('splits full rows at the row width and keeps file offsets', () => {
    const data = new Uint8Array(Array.from({ length: HEX_ROW_BYTES + 3 }, (_, index) => index))
    const rows = hexRowsOf(data)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ offset: 0, cells: Array.from({ length: HEX_ROW_BYTES }, (_, index) => index.toString(16).padStart(2, '0')) })
    expect(rows[1]).toEqual({ offset: HEX_ROW_BYTES, cells: ['10', '11', '12'] })
  })

  it('stops at the display bound without reading the rest', () => {
    const data = new Uint8Array(MAX_PREVIEW_BYTES + 100)
    const rows = hexRowsOf(data)
    expect(rows).toHaveLength(MAX_PREVIEW_BYTES / HEX_ROW_BYTES)
    expect(rows.at(-1)?.offset).toBe(MAX_PREVIEW_BYTES - HEX_ROW_BYTES)
  })
})

describe('formatByteCount', () => {
  it('formats with binary-precise thousands separators and no fraction', () => {
    expect(formatByteCount(0)).toBe('0')
    expect(formatByteCount(999)).toBe('999')
    expect(formatByteCount(1_024)).toBe('1,024')
    expect(formatByteCount(123_456_789)).toBe('123,456,789')
  })
})

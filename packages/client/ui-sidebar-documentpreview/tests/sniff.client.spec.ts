/** Header inference excludes incomplete signatures and active text formats. */
import { describe, expect, it } from 'vitest'
import { sniffDocument } from '../src/client/contract/sniff.ts'

describe('document signatures', () => {
  it.each([
    [[137, 80, 78, 71, 13, 10, 26, 10], 'image/png'],
    [[255, 216, 255], 'image/jpeg'],
    [[71, 73, 70, 56, 55, 97], 'image/gif'],
    [[71, 73, 70, 56, 57, 97], 'image/gif'],
    [[66, 77], 'image/bmp'],
    [[80, 75, 3, 4], 'application/zip'],
    [[80, 75, 5, 6], 'application/zip'],
    [[80, 75, 7, 8], 'application/zip'],
  ] as const)('recognizes %j as %s', (header, mediaType) => {
    expect(sniffDocument(new Uint8Array(header))).toEqual({ kind: mediaType.startsWith('image/') ? 'image' : 'binary', mediaType })
    expect(sniffDocument(new Uint8Array(header.slice(0, -1)))).toBeUndefined()
  })

  it.each([
    [[137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13], 'image/png'],
    [[82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], 'image/webp'],
    [[0, 0, 1, 0], 'image/x-icon'],
  ] as const)('recognizes %j as %s despite NUL bytes', (header, mediaType) => {
    expect(sniffDocument(new Uint8Array(header))).toEqual({ kind: 'image', mediaType })
  })

  it.each([
    [[0, 104, 105]],
    [[104, 105, 0, 33]],
    [[82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66]],
    [[0, 0, 1]],
  ] as const)('selects the binary fact card for %j with a NUL byte and no signature', (header) => {
    expect(sniffDocument(new Uint8Array(header))).toEqual({ kind: 'binary', mediaType: 'application/octet-stream' })
  })

  it.each(['', 'PK??', 'GIF80a', '<svg><script/></svg>', '<!doctype html>', '%PDF-1.7', 'plain text', 'héllo wörld ✓', '中文纯文本'])(
    'leaves %j to the fallback reader', (text) => {
      expect(sniffDocument(new TextEncoder().encode(text))).toBeUndefined()
    },
  )
})

/** Header inference excludes incomplete signatures and active text formats. */
import { describe, expect, it } from 'vitest'
import { sniffDocument } from '../src/client/document/sniff.ts'

describe('document signatures', () => {
  it.each([
    [[137, 80, 78, 71, 13, 10, 26, 10], 'image/png'],
    [[255, 216, 255], 'image/jpeg'],
    [[71, 73, 70, 56, 55, 97], 'image/gif'],
    [[71, 73, 70, 56, 57, 97], 'image/gif'],
    [[82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], 'image/webp'],
    [[66, 77], 'image/bmp'],
    [[0, 0, 1, 0], 'image/x-icon'],
    [[80, 75, 3, 4], 'application/zip'],
    [[80, 75, 5, 6], 'application/zip'],
    [[80, 75, 7, 8], 'application/zip'],
  ] as const)('recognizes %j as %s', (header, mediaType) => {
    expect(sniffDocument(new Uint8Array(header))).toEqual({ kind: mediaType.startsWith('image/') ? 'image' : 'binary', mediaType })
    expect(sniffDocument(new Uint8Array(header.slice(0, -1)))).toBeUndefined()
  })

  it.each(['', 'PK??', 'GIF80a', '<svg><script/></svg>', '<!doctype html>', '%PDF-1.7', 'plain text'])(
    'leaves %j to the fallback reader', (text) => {
      expect(sniffDocument(new TextEncoder().encode(text))).toBeUndefined()
    },
  )
})

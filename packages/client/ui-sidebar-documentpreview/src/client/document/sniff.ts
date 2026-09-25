/** Conservative binary signatures for files without a registered filename suffix. */

/** A recognized header selects an inert image or binary fact-card renderer. */
export interface DocumentSignature {
  readonly kind: 'image' | 'binary'
  readonly mediaType: string
}

/**
 * Recognize supported binary headers; textual formats never enable active rendering.
 * @param bytes - file prefix, starting at byte zero.
 * @returns a supported signature, or undefined for unknown and incomplete headers.
 */
export function sniffDocument(bytes: Uint8Array): DocumentSignature | undefined {
  const at = (offset: number, signature: readonly number[]): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte)
  let mediaType: string | undefined
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mediaType = 'image/png'
  else if (at(0, [0xff, 0xd8, 0xff])) mediaType = 'image/jpeg'
  else if (at(0, [0x47, 0x49, 0x46, 0x38]) && (at(4, [0x37, 0x61]) || at(4, [0x39, 0x61]))) mediaType = 'image/gif'
  else if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) mediaType = 'image/webp'
  else if (at(0, [0x42, 0x4d])) mediaType = 'image/bmp'
  else if (at(0, [0, 0, 1, 0])) mediaType = 'image/x-icon'
  if (mediaType !== undefined) return { kind: 'image', mediaType }
  if (at(0, [0x50, 0x4b]) && (at(2, [3, 4]) || at(2, [5, 6]) || at(2, [7, 8]))) {
    return { kind: 'binary', mediaType: 'application/zip' }
  }
  return undefined
}

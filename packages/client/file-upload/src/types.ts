/** Browser-safe request and receipt types for staged file and image uploads. */

import type { EncodedImageAttachment, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Canonical encoded upload accepted by the Remote fallback. */
export interface EncodedFileUploadRequest {
  /** Canonical base64 encoding of the exact file bytes. */
  readonly data: string
  /** Optional display name; the Host sanitizes it into the stored leaf name. */
  readonly name?: string
}

/** Digest-addressed upload that skips re-receiving bytes the Host already stores. */
export interface EncodedFileDedupeRequest {
  /** Lowercase hex SHA-256 of the exact file bytes of a prior upload. */
  readonly digest: string
  /** Optional display name; the Host sanitizes it into the stored leaf name. */
  readonly name?: string
}

/** Durable receipt for one staged file upload. */
export interface FileUploadValue {
  /** Per-upload authority accepted only inside the receiving Agent scope. */
  readonly receiptId: FileUploadReceiptId
  readonly file: FileAttachmentRef
}

/** Host-minted authority for one staged file upload in one Agent scope. */
export type FileUploadReceiptId = Branded<'file-upload-receipt-id'>

/** Canonical image bytes and declared media type accepted by image staging. */
export type EncodedImageUploadRequest = EncodedImageAttachment

/** Normalized image and Host-minted authority for a later prompt in the receiving Session. */
export interface ImageUploadValue {
  readonly receiptId: ImageUploadReceiptId
  readonly image: ImageAttachmentRef
}

/** Host-minted authority for one staged image in one Agent scope. */
export type ImageUploadReceiptId = Branded<'image-upload-receipt-id'>

/**
 * Fetch-shaped carrier installed by a page that owns its Host transport.
 * @param input - absolute same-origin upload URL.
 * @param init - raw request body, headers, and cancellation signal.
 * @returns the Host response.
 */
export type FileUploadFetch = (input: URL, init: RequestInit) => Promise<Response>

/** Pre-Cordis hook supplied by a page whose Host runs in another execution context. */
export interface ClientFileUploadHooks {
  readonly fetch: FileUploadFetch
}

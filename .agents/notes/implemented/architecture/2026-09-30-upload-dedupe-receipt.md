# Agent Note: Upload deduplication restages stored files by digest without re-receiving bytes

Status: implemented

English | [中文](2026-09-30-upload-dedupe-receipt.zh.md)

- **Date:** 2026-09-30
- **Scope:** §35 File/Artifact (interrupted transfer / large file on the upload path), §21 device permissions, §28 attach flow
- **Area:** `dsh-attachment`, `dsh-attachment-local`, `dsh-client-file-upload`, Android companion core

## Problem

A Host SIGKILL restart (or any companion reconnection after receipt loss) invalidated every staged upload receipt (`FILE_NOT_STAGED`) while the uploaded bytes stayed durable under `<DSH_HOME>/attachments/v1` with an unchanged content-addressed `attachmentId`. The only documented recovery re-sent the complete file body: the Host had no lookup that could turn a digest back into a reference, and the Android companion had no way to ask for one.

## Decision

Add a digest-addressed staging operation instead of widening the existing upload:

- `AttachmentStore.ensureFileByDigest(digest, name?)` joins the capability seam. The digest only locates the object; the local implementation re-hashes the stored object (`digestFile`) and reports a digest mismatch as a miss, then publishes the sanitized display-name alias through the existing `publishImmutableAlias`. The default seam implementation returns `undefined` so non-local backends keep working and callers fall back to a full upload.
- `FileUploads.uploadDedupe({ digest, name? })` is a new Remote operation under capability `file-upload.dedupe.v1` with `prompt.send` permission. It validates the wire digest as lowercase hex SHA-256 (`FILE_DIGEST_INVALID`), refuses subagent sessions before any store lookup, answers a miss with `FILE_DIGEST_NOT_KNOWN`, and on a hit stages the verified reference through the same `commit()` that mints receipts for full uploads — so receipt binding, retirement, and prompt admission semantics are identical.
- The Android companion hashes each prepared FILE upload with SHA-256 and remembers digests it uploaded successfully (process-local memory under the model lock). A re-upload of remembered bytes probes `uploadDedupe` first; `FILE_DIGEST_NOT_KNOWN` and `host/capability-unavailable` for `file-upload.dedupe.v1` fall back to exactly one full upload, while every other refusal stays fatal. First-time uploads never probe, so the common path pays no extra round trip.
- `uploadImage` keeps its full-upload path: normalization changes the bytes, so the client cannot know the stored digest.

## Alternatives considered

- **Digest plus bytes in one request with server-side fallback:** couples the wire to a heuristic (the body would travel anyway whenever the Host lacks the object) and gives the capability check no clean advertisement point.
- **Unconditional dedupe probe on every upload:** wastes a refused round trip on every first upload and doubles gateway noise for new files.
- **Persisted receipts across Host restart:** contradicts the process-local staging invariant established by the Host-restart acceptance; durable authority is the stored object, not the receipt.

## Consequences

- A surviving companion that re-uploads bytes the Host already stores sends one small digest-only RPC instead of the whole base64 body; the Host-restart e2e now asserts the stored object's mtime and size are unchanged across the re-upload.
- Host trust never extends to the client's declaration: the digest chooses where to look, and only a re-verified object produces a receipt. A corrupt object surfaces as a miss, then as a loud `ATTACHMENT_CORRUPT` on the full-upload collision.
- The Android capability allowlist (`NativeObservedCapability`) and its diagnostics fixture gained `file-upload.dedupe.v1`, and the catalog generator classifies `EncodedFileDedupeRequest` beside the other upload types.
- Fixing the e2e also fixed a latent defect from the Host-restart increment: the profile inserted `@deepseek-ai/dsh-api-native-remote` by bare name, which `plugin-package-inventory-deepseek` could not resolve into package identity in a clean checkout (REQUEST_EXTENSION on the first model request). The insert now uses an absolute entry like the other fixtures, so identity resolution walks to the workspace manifest.

## Open work

- The browser streaming carrier (`uploadStream`) has no deduplication path; it would need a pre-flight digest hash of the stream.
- Cross-process digest memory (a companion cold start after its own restart) still re-uploads once before re-learning the digest.

# Agent Note: The browser Client restages remembered upload bodies through uploadDedupe

Status: implemented

English | [中文](2026-09-30-browser-upload-dedupe.zh.md)

## Problem

The digest-deduplication operation (`fileUploads/uploadDedupe`) existed only on the Host and in the Android companion. A browser page that re-uploaded a body its own session had already stored — after a dropped receipt, a refreshed draft, or a retried send — still pushed the complete bytes through the streaming carrier, paying the full transfer for bytes the Host already held.

## Decision

The browser `FileUploadRuntime` now applies the same remembered-digest probe to re-readable bodies:

- A module-level `uploadedDigests` set records the digest of every body this page uploaded successfully, mirroring the companion's process-local memory.
- When the Host advertises `file-upload.dedupe.v1` and the input is a `Blob` or exact bytes, the runtime hashes the body in bounded 1 MiB chunks (`@noble/hashes` sha2, cancellation checked between chunks), and a remembered digest is addressed through `remote.fileUploads.uploadDedupe` before any carrier starts. A hit stages the receipt with zero bytes transferred and reports no byte progress.
- `FILE_DIGEST_NOT_KNOWN` falls back to exactly one full upload (the digest is re-learned on success); every other refusal is returned to the caller as-is instead of silently re-uploading. One-shot `ReadableStream` inputs are never hashed — they cannot be re-read — and always take the streaming carrier; a Host without the capability skips hashing entirely.
- The refusal branch narrows the error through a tolerant shape because the Host injects attachment refusal codes outside the statically declared failure union.

## Alternatives considered

- **Probe on every upload without memory:** pays a local full read plus a refused round trip on every first upload for a hit rate of zero until the second attempt.
- **Persist digests in storage:** a page-scoped memory matches the receipt's own lifetime; a cross-reload memory would probe against hosts that may differ and adds a stale-digest cache for no measured need.
- **Hash one-shot streams through `tee`:** the probe would race the transfer and still need the full body read twice; streams keep the streaming contract instead.

## Consequences

- Re-uploading a body this page already delivered costs one local hash pass plus one digest-only RPC instead of the whole carrier transfer.
- Digest computation reads re-readable bodies one extra time in bounded chunks; no allocation scales with the body.
- The first upload of any body is byte-for-byte the previous behavior (no probe, no hash).

## Open work

- No real-browser end-to-end exercise of the deduplication hit yet; coverage is the client unit matrix (probe, fallback, refusal passthrough, capability gate) plus the Host-side `uploadDedupe` acceptance already sealed in the upload-dedupe increment.
- The streaming carrier itself still has no deduplication path; it would need a pre-flight digest of a stream that cannot be re-read.

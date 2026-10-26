# Agent Note: The file-upload edge matrix runs against the real local attachment store

Status: implemented

English | [中文](2026-10-26-file-upload-edge-matrix.zh.md)

## Problem

Section 35 of the original specification names nine file edges — large file, binary, image, unknown MIME, partial download, range, interrupted transfer, filename encoding, zero-byte file — and the only evidence was the capability-source replays of the happy upload path. None of the edges had a test that reached durable storage: nothing pinned that a mid-stream failure leaves no published digest, that a restart deduplicates identical bytes through the content-addressed layout, or that a preview text card never renders for NUL-bearing bytes.

## Decision

Add the edge matrix at three layers. `packages/client/file-upload/tests/file-upload-edge.host.spec.ts` builds the real service stack — SessionStore, AgentRegistry, CommandRuntime, and `LocalAttachmentStore` on a temporary `DSH_HOME` — instantiates `FileUploads` directly, and drives the streaming route it registers with real `POST` requests. Six cases pin the storage edges: NUL and high bytes round-trip byte-for-byte through route, staged receipt, alias path, and disk; a zero-byte body with an absent name stores the empty object under the default leaf; CJK and emoji display names survive the URL-encoded wire while a Windows path stem with reserved characters sanitizes to a safe leaf; a 96 MiB patterned stream uploads once, and the public `readFileStream` read-back returns the exact byte count, digest, and probed offsets; a body that errors mid-stream returns `session/attachment-invalid` with `ATTACHMENT_WRITE_FAILED`, leaves no object, alias, or staging residue, and the Session still accepts a follow-up upload; a second service instance over the same root treats the first instance's receipts as foreign while identical bytes restage to the same attachment id, with `uploadDedupe` and `ensureFileByDigest` adding names as aliases around one stored object. Two intake edges close beside it: the documentpreview signature sniffer returns the binary card for any bytes containing NUL (two truncated-image assertions that used to expect text now expect the binary card, because their prefixes contain NUL), and empty or unknown browser MIME values classify to verbatim file drafts. The client `digestBody` chunked hash is pinned end to end: a 2.5 MiB Blob crosses three 1 MiB chunk boundaries, uploads once through the carrier, and the dedupe probe on the second upload carries exactly the Node `sha256` of the bytes.

## Alternatives considered

A stubbed attachment store (the session-controller harness form) was rejected — the seams under test are storage facts: staging cleanup, content-addressed publication, alias layout, and digest verification, which a stub only restates. One combined mega-test was rejected — each edge stays a single readable case with its own failure message. Reaching into store internals for temp paths was rejected — assertions stay on the published layout and the public `readFileStream`, which verifies byte count and digest itself.

## Consequences

The nine §35 edges now split into proven storage edges (binary, zero-byte, filename encoding, large file, interrupted transfer) and the still-open presentation edges: the shared Diff matrix across the three diff consumers (documentpreview parser, ui-primitives DiffBlock, trajectory structuredPatch) and partial-download resume semantics stay on the gen-80 ledger, and §34 remains NOT_STARTED until that matrix exists. The matrix proves the local store through the streaming route; it does not exercise a real gateway HTTP server, cross-process concurrent writers, or image normalization edges, which keep their existing lanes. `pdf-license-bundle` fails on this Windows host from GNU tar treating `C:` as a remote host — recorded host quirk, unaffected by this change and owned by CI's Linux lanes.

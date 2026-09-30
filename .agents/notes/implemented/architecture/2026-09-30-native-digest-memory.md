# Agent Note: The companion persists uploaded-file digests across its own process restarts

Status: implemented

English | [中文](2026-09-30-native-digest-memory.zh.md)

## Problem

The Android companion remembered uploaded digests only in process memory. After the system killed and relaunched the app, the first re-upload of a body the Host already stored paid a full transfer again before the memory re-learned the digest — the exact loss the deduplication path exists to prevent.

## Decision

Give the digest memory a durable, advisory home of its own:

- `NativeUploadDigestMemory` is a core interface (`load()` oldest-first, `remember(digest)` as most recent). `FileNativeUploadDigestMemory` stores a bounded plaintext JSON document (version 1, capacity 256, hex-SHA-256 entries only) with atomic same-directory replacement. A missing or damaged document loads as empty — the cost is one full upload, never a blocked one.
- `NativeFileAttachmentsModel` accepts an optional memory, seeds its in-process set from `load()`, and persists every digest after a successful full upload. A deduplication hit refreshes nothing on disk: the digest is already remembered.
- `CompanionModelSet` passes the memory through, and the app wires one per restored installation (`CompanionRuntime.uploadDigests`, a lazy single `upload-digests.json` under the restore directory) into both model-set construction sites. Unpaired state reads as no memory.

## Alternatives considered

- **Extend the encrypted input snapshot (v3 document):** that document is user input with a strict fixed field set and a rejection policy for older formats; hanging an advisory cache off it couples cache churn to user-data compatibility.
- **Per-principal memory files:** content addressing makes a digest meaningful to whichever Host stores the object; a wrong-Host probe costs one refused round trip through the existing fallback. Deferred as open work.
- **Remembering on every deduplication hit:** a write per hit buys only recency ordering inside the capacity window.

## Consequences

- A relaunched companion deduplicates its first re-upload of previously stored bytes with zero full transfers.
- The memory is best-effort: deletion, damage, or a full app-data clear degrades to the previous behavior.
- The acceptance APK was rebuilt with the change and the real Host-restart e2e stayed green, so the durable path composes with the sealed upload-deduplication semantics.

## Open work

- Per-principal (per-Host-identity) memory scoping; a capacity/eviction policy tuned on real usage.
- The browser Client keeps its page-scoped memory only; a storage-backed browser memory is unexplored.

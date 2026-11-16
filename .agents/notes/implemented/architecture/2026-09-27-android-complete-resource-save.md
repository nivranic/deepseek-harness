# Agent Note: Android saves complete resource snapshots through a user-selected document

Status: implemented

English | [中文](2026-09-27-android-complete-resource-save.zh.md)

## Problem

A bounded resource prefix is useful for inspection but cannot represent a complete file. The system document picker can also return after resource navigation, Host replacement or process loss. Using the current selection at callback time could save unrelated bytes, while replaying cleanup on a duplicate result could delete an accepted document.

## Decision

The Files and Artifact previews offer Save only for a complete READY observation. Beginning a save copies its accepted bytes and retains the exact observation and Host-owned saver. The system receives only a basename and detected MIME type through `ACTION_CREATE_DOCUMENT`; the user and document provider choose the final name and location. Saving performs no additional Host read or mutation. This is a bounded in-memory snapshot, not a persistent download or a promise that the Host file remains unchanged afterward.

The application registers one picker at its root. Its Activity-scoped owner retains the original saver across UI recreation and consumes the pending result once. It holds no process-restorable resource approval. A restored owner with no selection discards the newly created destination without writing. Clearing a completed notice for another resource does not reset the consumed-result guard.

Resource replacement and closure invalidate pending choices and cancel owned writes. Host retirement waits for writes and cleanup through model lifetime. Delivery closes and flushes the destination before reporting success; failure or cancellation attempts to discard that new document. Cleanup failure remains a distinct result even after cancellation and tells the user that an incomplete file may remain. Late picker results cannot consume another resource selection, and duplicate callbacks do not delete a saved document.

The [resource-reading decision](2026-09-27-android-current-resource-reading.md) retains byte validation, preview limits and retry ownership. The [saved-Host decision](2026-09-26-android-saved-host-catalog.md) retains principal adoption and quiescent model replacement. Both remain active. Resource export does not use the scanner approval required by diagnostic export because it deliberately saves user-selected file content rather than a support report.

## Alternatives considered

**Save the displayed prefix or re-read after the picker returns.** A prefix is incomplete; another read can observe a different version or Host. Capturing only accepted complete bytes preserves the user's selected content.

**Write to a fixed public path or hand an authenticated URL to DownloadManager.** The document picker provides explicit destination selection. Current Gateway reads require signed admission and opaque version checks that a generic URL download would not preserve.

**Persist pending save approval or forget consumed results when dismissing status.** Restored approval would need a durable principal-bound transfer protocol. Re-admitting a duplicate callback can remove a previously saved file. This operation keeps approval in memory and treats process loss as expiry.

## Consequences

Core tests cover byte capture, zero-byte content, partial refusal, cancellation, late and duplicate callbacks, write failure, failed cleanup, reentrant retirement and awaited I/O. Installed tests check picker intent and callback ownership. A real Host scenario drives the system picker and independently reads saved Unicode, empty and binary files; it also verifies cancellation, expiry cleanup and absent save controls for partial previews. Persistent large-file downloads, crash-safe transfer recovery, third-party document providers and physical-device layouts remain separate qualification work.

# Agent Note: Android saves principal-scoped input before explicit submission

Status: implemented

English | [中文](2026-09-26-android-encrypted-input-checkpoints.zh.md)

## Problem

Process death can lose human input and the request identity needed to retry an ambiguous prompt. A credential file proves identity but cannot recover a draft. Restoring a queued mutation automatically would hide the user's opportunity to inspect its outcome. Input from another Host key or device grant must never become the current principal's draft.

## Decision

The Android process owns one encrypted input document per Host id, pinned fingerprint, and device id. Version 1 stores Session drafts, unconfirmed original prompt intents, Question answers keyed by Session/interaction/revision, and the last ordinary Session selection. It stores neither credentials nor Host transcript events. The application uses a separate Keystore alias and a 1 MiB encrypted-document limit. Reads reject unknown fields, versions, invalid UTF-8, duplicate rows, mismatched principals, and conflicting request identities. Unreadable bytes remain untouched.

A shared state owner serializes and coalesces writes. Each explicit prompt or Question reply waits for its input checkpoint before dispatch; save failure prevents the RPC and exposes an explicit save retry. A pending prompt retains its original text and request id independently of newer composer edits. Positive acknowledgements and matching Host user-message receipts retire only the accepted intent and matching draft. Reopening observations reconciles receipts without replaying a mutation. Question closure or revision replacement retires obsolete answers; a changed event client during saving prevents dispatch of a stale reply.

A same-directory temporary file and mandatory atomic replacement protect the previous document. Restore failure disables input edits and offers explicit backup-and-reset recovery. Recovery first copies the unreadable encrypted bytes, then commits empty input; failed replacement does not publish an empty state. Reading never creates a missing encryption key. A new key may be created only by an explicit save. Saved checkpoints survive application process death; sudden power-loss durability is not qualified.

Re-pairing drains model producers and saves the old principal before adoption. Cancellation resumes that principal's saved input and viewing position. A new device grant uses a separate document. The process retires the old writer after adoption, preventing stale writes from crossing owners. The [native connection decision](2026-09-25-native-remote-connection-source.md) owns transport and model-owned submission lifetime; the [saved Host catalog decision](2026-09-26-android-saved-host-catalog.md) owns multi-Host selection and credential adoption. This decision extends input lifetime with local storage.

## Alternatives considered

**Keep input only in models or Activity state.** This retains input across UI recreation but cannot recover an ambiguous intent after process death.

**Automatically resend a restored prompt or reply.** Observation recovery does not establish that a mutation failed. Explicit retry preserves the original prompt identity and lets the user inspect the Host outcome first.

**Treat unreadable input as empty or overwrite the file directly.** These approaches destroy recovery evidence or the last complete snapshot when parsing, encryption, or writing fails. Explicit backup/reset and atomic replacement preserve that evidence.

## Consequences

Input edits can be temporarily unsaved; the UI distinguishes saving, failed saving, and failed restoration. The size cap rejects oversized input instead of silently dropping rows. Retained backup files require deliberate future retention policy; the application does not delete them automatically. Unit tests cover encryption, principal isolation, strict decoding, write failure, checkpoints, receipt reconciliation, revision ownership, and writer retirement. The recorded Android scenario checks different-process restoration, no automatic submission, and encrypted recovery using only the isolated acceptance application's data. Physical devices, hardware-backed permanent key invalidation, and release qualification remain separate work.

The [HTTP response-retirement decision](../bug-fix/2026-09-26-http-disconnect-response-retirement.md) owns cleanup of a result returned after the caller disconnects. Two real Host cases verify Android death after prompt admission: explicit retry reuses the saved id and yields one inbox insertion, user message, and model response; an already recorded receipt clears pending input without another RPC. Both preserve newer text across another process restart.

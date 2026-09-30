# Agent Note: A real Host restart invalidates staged upload receipts while durable identity and bytes survive

Status: implemented

English | [中文](2026-09-30-android-host-restart.zh.md)

## Problem

The [receipt-recovery decision](2026-09-28-android-attachment-receipt-recovery.md) proved that disposing a Session object invalidates its upload receipts inside one Host process, and its scenario explicitly excluded Host restart. No test combined an abrupt Host process death with the paired Android companion: whether the device pairing, the Host identity, the uploaded bytes, and the staged receipts survive a real SIGKILL restart were three separate unverified claims.

## Decision

The [installed host-restart scenario](../../../../apps/web/tests/android-host-restart.e2e.ts) drives a real Host child process (`apps/cli --profile hostrestart`) in an isolated `DSH_HOME`, pairs the emulator through a pairing code issued over private fixture IPC, stages one SAF file upload, flushes the session, kills the Host with SIGKILL, restarts on the same fixed native port, and reconnects the surviving companion through an adb-reverse teardown and rebuild. The observed semantics are now asserted facts: staged upload receipts are process-local (`FileUploads.stagedUploads` is an in-memory map), so the old receipt is refused with `session/attachment-invalid` / `FILE_NOT_STAGED` and the companion walks the explicit recovery path — discard the pending intent, remove the stale attachment, reselect the source, receive a fresh receipt (content-addressed `attachmentId` unchanged), and send once. Durable state survives the restart unchanged: `hostId`, TLS `spkiFingerprint`, the fixed native port, the paired device grant, and the uploaded file bytes under `<DSH_HOME>/attachments/v1` all compare equal across processes, the restarted Host re-advertises `native-remote.http-request-budget.v1`, and the re-selected upload re-queries that budget before dispatch.

The Host-side [fixture](../../../../apps/web/tests/android-host-restart.fixture.ts) is the reusable pattern for device scenarios that need a killable Host: it reports `ready` with live native-remote and host-description facts and answers `issuePairing`, `describe`, `createSession`, `observe` and `flush` requests over request-id-correlated IPC, never exposing the credential-bearing web URL. The [file budget decision](2026-09-28-native-http-upload-budget.md) keeps owning the budget mechanism; this scenario adds the restart axis to its evidence, not a new budget rule.

## Alternatives considered

**Simulate Host death with `setHostReachable(false)`.** Removing the adb reverse exercises transport loss only; it cannot lose process-local staging state, so it proves nothing about restart semantics.

**Reuse the in-process web scaffold and dispose the Agent.** That is the receipt-recovery scenario's Session-dispose axis; a Host process death is a different failure domain that also resets process-local state the Agent scope keeps.

**Persist staged receipts to make them survive restarts.** Durability would need Host-side staging storage and a defined reconciliation for half-written uploads; the explicit reselection path already restores the user's intent, and durable uploaded bytes make the re-upload content-addressed. No requirement asks receipts to cross Host restarts.

## Consequences

The scenario passes its single case with exit code 0 across three independent runs (sub-agent r3/r4, main-session r5), with the installed APK pair unchanged from the image-budget increment (no product code changed; the only tracked edits are the two new test files and their two-line tsconfig face registration mirroring `host-restart.fixture.ts`). The durable session log records exactly one user-origin message with the replacement text and the file attachment, one completed turn, and one mock model request. Three screenshots (`reconnected-session`, `rejected-old-receipt`, `final-send`) and the machine-readable observation record are preserved under `.artifacts/android-host-restart-ui/`. Full typecheck, oxlint and the 17 documentation quick checks pass with exit code 0.

These results verify the tested emulator, the child-process Host profile, and the TLS path. Physical devices, iOS companions, Host restart during an in-flight upload or stream, concurrent multi-device reconnection, and receipt persistence design remain separate qualification work. The [receipt-recovery decision](2026-09-28-android-attachment-receipt-recovery.md) keeps the Session-dispose axis; this note owns the Host-restart axis.

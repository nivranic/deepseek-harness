# Agent Note: Android file attachments retain one explicit selection and complete prompt intent

Status: implemented

English | [中文](2026-09-27-android-file-attachments.zh.md)

## Problem

A local document must reach the selected Host before a prompt can reference it. Picker results, source reads and upload replies can arrive after a Session or Host changes. A staged receipt also has a different lifetime from the local draft: restoring its metadata does not prove the Host still accepts it. The Android composer needs file intake without sending a newer draft under an older request identity or treating restored URI metadata as permission to read again.

## Decision

The Session composer exposes **+ → 文件** when the Host advertises both `file-upload.stage.v1` and `native-remote.http-request-budget.v1` and Session control is available. It opens `ACTION_OPEN_DOCUMENT` with `*/*` for one file. `NativeFileAttachmentPicker` is Activity-ViewModel-owned and retains the original `NativeFileAttachmentsModel` and single-use `NativeFileSelection` across rotation. A restored process has no selection authority. A cancelled picker remains occupied until its result returns, preventing a second selection from consuming the old result. Duplicate, cancelled and retired results cannot open a source for a different Session generation or Host.

`AndroidNativeFileAttachmentSource` reads display metadata and opens the selected content URI only when the core model invokes it on its I/O dispatcher. The application takes no persistent URI grant, stores no source URI in input checkpoints and never deletes the source document. Source streams close before their work completes. Session changes invalidate the selected generation; cancellation and Host retirement await owned provider I/O and RPC work. A blocking provider can delay that wait.

`NativeFileAttachmentsModel` accepts files up to 512 KiB, shares a maximum of 8 files and images per draft, and bounds the UTF-8 encoded upload-arguments JSON at 1 MiB. These application-supplied limits remain independent of the Host's complete request-body limit. The model base64-encodes the admitted bytes and calls `fileUploads/upload` through the selected model's signed wire. The Native client also reads the receiving listener's current body budget and checks the complete signed request before dispatch; the [request-budget decision](2026-09-28-native-http-upload-budget.md) owns that check and its failure semantics. File intake does not use the Host's streaming route or support resumable upload offsets.

The returned receipt and file metadata enter the selected Session draft as a `SessionFileAttachment`. A completed upload has a removable filename-and-size card; selecting, reading or uploading disables send and pending-prompt retry. A prompt can contain files without text. Removal changes only the local draft and never deletes Host bytes. Failure notices use fixed localized categories without source paths or raw provider exceptions. `DomainFold` presents received durable file blocks as filename-and-byte-count summaries.

## Durable intent and receipt lifetime

The [input-checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md) owns the strict version 3 document, principal isolation and complete text/attachment request identity. Prompt assembly sends text and ordered file or image receipt references; the [photo decision](2026-09-27-android-photo-attachments.md) owns mixed attachment ordering. Explicit retry reuses the original pending intent, including receipts, even when the composer contains newer text or files. Acknowledgement clears a composer draft only when its complete intent still matches. Process restoration reloads saved receipts without uploading or submitting them.

The [generic-file-upload decision](../feature/2026-08-26-generic-file-upload.md) retains authority over Host byte storage, Session-scoped staged receipts, durable `FileBlock` admission and model-visible file handles. Its in-memory staged receipts can expire after Host or Session retirement. Android preserves the failed intent instead of replacing a receipt during retry. Recovery requires explicit removal and a new file selection/upload; an unconfirmed original intent must first be explicitly discarded rather than silently rewritten. Discarding local input does not withdraw a prompt the Host may already have accepted.

Cancelling encoded upload cannot promise rollback: the Host may already have stored bytes before Android cancels or rejects a late reply. Those unreferenced bytes remain under the Host attachment-retention policy. Input persistence, Host upload storage and [saved-Host adoption](2026-09-26-android-saved-host-catalog.md) remain independently useful decisions; this note owns their Android document-picker consumer.

## Alternatives considered

**Persist URI permission or resume a restored file selection automatically.** A source URI is separate from a user's current upload intent. Memory-only picker authority makes process restoration observational and requires a new explicit selection for another upload.

**Replace an expired receipt inside a pending retry.** This would change the file intent associated with its existing request id. The pending intent remains immutable; a replacement upload belongs to a new explicit intent.

**Add a native streaming or resumable upload protocol.** The existing encoded operation supports the bounded file intake without adding a transport. The trade-off is a local file-size limit and retransmission from byte zero after failure.

**Clear a draft on any successful acknowledgement.** An older send can complete after text or file edits. Clearing only an identical complete intent preserves those newer edits.

## Consequences

The Files increment verification records 373 passing core tests across 62 suites, with no failures, errors or skips. Their attachment coverage includes byte and encoded-JSON limits, receipt validation, complete-intent identity, persistence, selection-generation rejection and awaited source/request cancellation. All six [installed picker tests](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeFileAttachmentPickerTest.kt) pass.

The [real-Host scenario](../../../../apps/web/tests/android-file-attachments.e2e.ts) passes on an Android 34 x86_64 emulator with the system document provider and installed application/test APK hashes matching the current build. It independently hashes Host-stored bytes, checks local removal and encrypted input, and terminates the Android process before restoring the same device grant, file receipts and request id without an automatic upload or prompt. Explicit submission produces exactly one user-origin message with the complete text and ordered `FileBlock` list; plugin-origin system-prompt snapshot metadata is checked separately. This does not assert that the complete `user/message` event stream contains only one event.

The combined native regression passes all five cases across four files: file attachments, [input persistence](../../../../apps/web/tests/android-input-persistence.e2e.ts), both [lost-acknowledgement recovery cases](../../../../apps/web/tests/android-prompt-retry.e2e.ts), and [persistent downloads](../../../../apps/web/tests/android-download-adoption.e2e.ts). These results qualify the tested emulator and system provider.

The [photo decision](2026-09-27-android-photo-attachments.md) owns Photos intake and its separate verification; the Files evidence above does not qualify that extension. The [share decision](2026-09-28-android-share-intake.md) owns incoming Intent confirmation and atomic batch adoption. Camera intake, persistent URI access, background upload scheduling and upload resumption remain outside this decision. Physical devices, third-party document providers, live-model file use and interoperability across platforms remain unqualified.

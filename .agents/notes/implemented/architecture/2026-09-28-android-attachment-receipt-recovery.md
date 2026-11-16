# Agent Note: Android attachment receipt recovery preserves explicit prompt intent

Status: implemented

English | [中文](2026-09-28-android-attachment-receipt-recovery.zh.md)

## Problem

An Android draft can outlive the exact Host Session that staged its attachments. Restoring that draft cannot restore the receipt's authority. A generic invalid-input notice does not explain how to replace the attachment while preserving a different newer draft or avoiding a changed payload under an old request id.

## Decision

`PromptSubmissionFailure.attachmentReceiptUnavailable` recognizes only `session/attachment-invalid` with a string `details.reason` equal to `FILE_NOT_STAGED` or `IMAGE_NOT_STAGED`. The reason is not the top-level code. Other reasons, missing or mistyped details and other codes retain the existing Gateway classification and presentation. The failure envelope remains intact for diagnostics.

The Session composer presents a localized recovery notice for those two reasons. It warns that discarding the old send also deletes its corresponding draft when that draft has not been edited and advises copying needed text first. The user then removes any remaining old attachments, selects them again and sends explicitly. The notice does not assign a timeout, restart or other cause: unknown, foreign or wrong-kind receipts can also produce the same refusal.

The [file](2026-09-27-android-file-attachments.md) and [photo](2026-09-27-android-photo-attachments.md) decisions retain ownership of picker intake, upload limits, source lifetimes and ordered draft attachments. Receipt replacement uses those existing operations. It adds no automatic upload, prompt, discard or source access and stores no provider URI authority. No Host operation, Session event or encrypted input format changes.

## Pending sends and newer drafts

A refused send retains its captured text, attachments and request id. Explicit retry submits that original intent even if the composer contains different text. Editing the composer creates a different request id without changing the pending intent. Discard removes the named pending intent and only removes the composer draft when its request id still matches; a different newer draft remains. Local discard does not withdraw work the Host may already have accepted.

Removing an old attachment and adding a newly selected upload each changes the draft's request id. The replacement receipt belongs to the resulting new intent, never to an overwritten pending retry. Host byte deduplication can preserve the attachment id even though the upload receipt and prompt request id are new.

Retry remains available only with Session control, editable input, no send in progress and no attachment operation in progress. Discard requires editable input and no send in progress; an attachment operation alone does not disable it. The [input-checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md) continues to own saved inputs, acknowledgements and process restoration.

## Alternatives considered

**Treat every attachment-invalid response as an unavailable receipt.** Model modality and other attachment failures require different corrections. Matching the two exact detail values keeps those failures on their existing path.

**Replace a receipt during pending retry or reupload a remembered source automatically.** Either action changes the captured intent or assumes source authority that the restored metadata does not provide. A new explicit selection and request id preserve user control.

**Clear both pending input and newer edits after refusal.** The refusal concerns the original request. Clearing unrelated newer text would destroy input that the user did not submit.

## Consequences

Core verification passes 434 tests across 69 suites, with no failures, errors or skips. Receipt classification covers both exact not-staged reasons and fallback cases. Prompt-intent coverage verifies original-request retry, independent newer-draft retention, same-request discard and distinct request ids after editing, removal and replacement.

The Host-only feasibility case passes one test with exit code 0. A public Agent handle completes a real file upload, Session flush and awaited disposal; the persisted header remains readable without an extra title write. Normal Session Controller resume creates new Agent and Session objects under the same durable identity. An authenticated HTTP prompt with the old receipt receives the exact not-staged refusal without adding events.

The [installed Android recovery scenario](../../../../apps/web/tests/android-attachment-receipt-recovery.e2e.ts) passes one case with exit code 0. Both application and instrumentation builds succeed, and installed APK hashes match those builds. A real SAF file reaches Host storage with an independently verified byte hash. Awaited Session disposal and ordinary Controller resume keep the same Host and durable Session id while invalidating the old receipt. Initial submission and explicit retry receive the real `session/attachment-invalid` / `FILE_NOT_STAGED` refusal; the captured original and a different newer draft remain intact. Explicit discard preserves the newer draft, and removal plus SAF reselection produce a new receipt and four distinct draft request ids across the edits. Exactly two uploads and three prompt calls produce one durable user message only after the final explicit send. The Android PID, local Session model, Host identity and single device grant remain unchanged; request, follow and driver cleanup complete.

Four reviewed screenshots record the complete refusal guidance, the original pending text beside different newer draft text, the replacement attachment ready to send, and the unique accepted file message with an empty composer. The pending card is scrollable: its notice and discard button are individually scrolled into view and checked before clicking; the scenario does not require the whole card to fit on screen.

The independent regression run passes three files and three cases with exit code 0: [Files](../../../../apps/web/tests/android-file-attachments.e2e.ts), [Photos](../../../../apps/web/tests/android-photo-attachments.e2e.ts) and [notification permission](../../../../apps/web/tests/android-notification-permission.e2e.ts). These results are separate from the recovery case. The Photos regression covers its existing intake and restoration behavior, not image-receipt invalidation recovery.

These results verify Session-lifetime invalidation for SAF files, not Host process restart or elapsed-time expiry. Real photo-receipt recovery, mixed attachments, physical devices and interrupted or resumable uploads remain separate qualification work.

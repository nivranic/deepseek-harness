# Agent Note: Android photos use staged image receipts and one ordered attachment intent

Status: implemented

English | [中文](2026-09-27-android-photo-attachments.zh.md)

## Problem

A selected photo needs Host image validation and normalization before a durable prompt can reference it. Treating it as a generic file would give the model a file handle instead of an image, while retaining inline bytes in encrypted input would couple retry identity to a large payload. Separate file and image lists would also lose the user's mixed selection order. Source bytes, normalized bytes, staged receipt authority and accepted message identity have different lifetimes and cannot substitute for one another.

## Decision

The Session composer exposes **+ → 照片** when Session control and `image-upload.stage.v1` are advertised. **+ → 文件** independently requires both `file-upload.stage.v1` and `native-remote.http-request-budget.v1`. The photo entry requests one image through AndroidX `PickVisualMedia(ImageOnly)`. Files and photos share one active selection owner, so cancellation, Activity recreation, Session replacement and Host retirement preserve the same single-use authority described in the [file-attachment decision](2026-09-27-android-file-attachments.md). The application takes no persistent URI grant and saves no source URI; process restoration cannot reopen or upload a selected source.

Android accepts PNG, JPEG, WebP and GIF source MIME types; unknown types and HEIC are refused without conversion. The application limits each source to 512 KiB, the combined draft to 8 attachments, and UTF-8 upload-arguments JSON to 1 MiB. The JSON limit excludes the signed RPC envelope, and these limits are not negotiated with the Host. Reading and upload remain explicit, bounded work; a blocking content provider can delay cancellation cleanup. A shared `SessionAttachmentAdmission` reservation rejects send and retry at model entry points throughout selection, reading, upload and cancellation cleanup. Owned job or lifetime completion releases the reservation, including cancellation before a coroutine body starts.

The Host `fileUploads/uploadImage({ data, mediaType, name? })` operation requires `prompt.send` and uses the attachment service's canonical-base64 validation, supported-format checks and normalization. It returns an opaque image `receiptId` and normalized `image` metadata. The Host privately retains the source encoded byte count with the receipt. Normalized bytes, dimensions and media type describe the stored image and need not equal the selected source; `originalDimensions` is optional metadata, not authority to reread a source.

Android stores files and images in one ordered `SessionDraft.attachments` list. An image entry retains its receipt, normalized attachment id, media type, byte count, width, height, optional name and optional original dimensions. Prompt assembly preserves the mixed order using file receipt parts and the independent `{ type: 'staged-image', receiptId }` tag. The [input-checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md) owns strict version 3 persistence: versions 1 and 2 are refused while their encrypted bytes remain intact. Restoring a draft only restores metadata and observations. Changing text or attachments creates a new request id; unchanged explicit retry preserves the complete original intent, even when the composer has newer edits.

The Session Controller resolves every staged receipt inside its receiving ordinary Session and rejects mismatched file/image kinds. Both staged and inline images require a selected image-capable model. Attachment admission combines their occurrence count and original encoded byte totals, including repeated references, before writing any inline image. Staged totals use the Host's retained source count rather than the smaller or larger normalized byte count. Accepted staged images become the existing durable `ImageBlock`; durable events contain neither source URIs nor base64. The [attachment service](../../../../packages/attachment/attachment/README.md) owns image admission and storage, and the [upload service](../../../../packages/client/file-upload/README.md) owns receipt publication and binding.

## Receipt lifetime and recovery

File and image receipts share prompt binding, rollback on failed delivery, retirement after queue/history observation, and request-id deduplication. Unsent receipts expire on Host restart or owning Session disposal. Android retains an expired pending intent for inspection; replacing its attachment requires explicit discard followed by a new selection and upload. Removing a card or discarding local input cannot retract a prompt already accepted by the Host.

Cancelling before image receipt publication returns no usable receipt, but an ongoing Host storage write can still complete. Session or Host replacement rejects late local results; neither cancellation nor local removal promises storage rollback. Immutable unreferenced objects remain under the existing retention policy, with no new garbage collection. The [generic-file-upload decision](../feature/2026-08-26-generic-file-upload.md) continues to own verbatim file storage, command attachments and model file handles; the file-picker and input-checkpoint decisions remain active for their independent lifecycle and recovery rules.

## Alternatives considered

**Upload photos as generic files.** A generic file preserves exact bytes and projects a read-on-demand path. Photo intake needs image validation, normalization and the model's existing image route, so it uses a separate staged image operation.

**Persist inline base64 or source URI authority.** Both enlarge the durable intent's responsibilities and encourage automatic source reads after restoration. A completed Host receipt and normalized metadata suffice for explicit send and retry; unreadable or expired authority remains a visible failure.

**Use normalized bytes for the prompt budget.** Normalization can shrink a large source or enlarge a small one. The receipt's Host-owned original count preserves the source budget when staged and inline images are mixed.

**Keep separate file and image draft lists.** Concatenating them changes user selection order and weakens complete-intent equality. One tagged list preserves order through persistence, acknowledgement and retry.

## Build verification

The [root Host compiler program](../../../../tsconfig.host.json) includes the Android E2E family, and the [Web Client program](../../../../apps/web/tsconfig.json) excludes it. Each driver belongs to one compiler face because Host and Client Cordis `Context` declarations cannot share a program. Real-Loader verification requires both `pnpm run build:lib:host` and `pnpm run build:lib:client`; the file-upload package's [bundle configuration](../../../../packages/client/file-upload/tsdown.config.ts) emits its Node entry during the Client phase. A Host-only build does not provide every artifact loaded by this scenario.

## Consequences

Focused Host verification passes 170 tests across 9 files; Host and Client builds and the complete Host typecheck pass. Full Android core results contain 385 passing tests across 63 suites with no failures, errors or skips, including model-owned submission exclusion and cancellation cleanup. All 9 installed [picker tests](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeFileAttachmentPickerTest.kt) pass.

The [Photos scenario](../../../../apps/web/tests/android-photo-attachments.e2e.ts) passes on the Android 34 x86_64 emulator with both installed APK hashes matching current builds. The system Photo Picker and SAF produce an ordered image/file/image draft; independent Host storage hashes match the known metadata-free PNG and file bytes. Removing the test-owned source photo and terminating the app process preserves the same grant, receipts, order and request identity without automatic upload or submission. Explicit send produces exactly one user-origin message with matching ImageBlock/FileBlock/ImageBlock content; system-prompt snapshot metadata is checked separately. Session-authorized image reading returns the verified PNG, and Android displays the sent names.

The Android UI offers photo intake without adding a second attachment store, Session event type, automatic mutation replay or upload-resumption protocol. Host normalization remains authoritative, and staged receipt expiry remains visible after Android process restoration. The model response is a keyless recorded reply; it does not qualify live-model image interpretation. Physical devices, third-party photo providers and HEIC conversion remain outside the qualified scope. The [Camera decision](2026-09-27-android-camera-attachments.md) owns system-camera intake; the [share decision](2026-09-28-android-share-intake.md) owns incoming Intent confirmation and atomic batch adoption. Each entry path has separate verification.

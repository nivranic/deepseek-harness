# Agent Note: Android camera outputs carry temporary file authority, not restored upload authority

Status: implemented

English | [中文](2026-09-27-android-camera-attachments.zh.md)

## Problem

A system camera writes a full-size capture into an output URI supplied by its caller. The companion therefore owns both the temporary file and the write grant while another application is active. A late result, cancelled upload or process death must not leave that grant available indefinitely, attach the capture to another Session, or restore permission to upload without a new explicit selection. A camera result thumbnail is not the full captured image.

## Decision

Camera intake uses AndroidX `TakePicture` with an explicit output URI and read/write grants carried by the intent and `ClipData`. The companion requests neither `CAMERA` nor broad media-library permissions; the selected camera application owns capture. Its `FileProvider` is not exported and grants access only to `cache/native-camera/captures/` under `${applicationId}.native-camera`. Each allocation creates one `capture-<UUID>.jpg` in that directory. A successful Boolean callback authorizes reading that particular output; returned intent data and thumbnails do not supply attachment bytes.

The [photo decision](2026-09-27-android-photo-attachments.md) owns image staging, normalized metadata, complete mixed attachment intent and the shared limits. Camera uses the same `image-upload.stage.v1` capability, core image admission and `fileUploads/uploadImage` operation. Its full-size JPEG is subject to the existing 512 KiB source limit; Android does not silently recompress an oversized capture. Camera confirmation stages an image in the draft; prompt submission remains explicit. No new Host operation, Session event or encrypted-input format is introduced.

The Activity-owned picker keeps the original Host model, Session selection and capture authority across rotation. Camera callbacks are distinguished from Files and Photos callbacks, although both image sources use the same core image admission. The shared attachment reservation blocks model-level send and retry during capture, read, upload and cancellation cleanup. A changed Session generation or retired Host cannot adopt a late camera result. Cancelling a launched camera marks its result for discard. Output cleanup may finish first, but the picker retains the output name, registered launcher and occupied callback slot until the actual result is consumed. A later Files, Photos or Camera selection cannot begin during that wait. Cancellation before launch releases the picker after cleanup.

The [share decision](2026-09-28-android-share-intake.md) owns external share delivery and batch adoption. A share arriving during capture leaves the camera's original ticket and callback ownership intact.

## Temporary output lifetime

`NativeCameraFiles` is a process singleton; live output reads require the exact in-memory lease token. Capture allocation and finalization share a reservation so cancellation cannot miss a file whose allocation is still running. Successful intake retains the output until the owned read/upload job settles, then revokes its exact URI grant and removes that file. Cancellation, failed launch, invalid result and owner retirement also release the owned output. Local cleanup does not roll back immutable image bytes already stored by the Host.

`SavedStateHandle` retains the output filename and `native-camera-awaiting-result` disposition solely for cleanup and result discard; it restores no model, lease token or upload authority. If a callback is still due, the restored launcher consumes and discards it whether it arrives before or after cleanup. If the callback was already consumed before process death, restoration performs cleanup without waiting for another result. Neither case reopens the camera.

On first use in a cold process, the store removes unleased UUID-named captures from its dedicated directory after revoking their URI grants. Rotation reuses the existing process store and preserves live leases. Cleanup requires the exact canonical capture directory below the application cache, rejects symbolic links and leaves unrelated names untouched. The source document rules in the [Files decision](2026-09-27-android-file-attachments.md) remain distinct: the application owns these camera outputs and can delete them, while selected user documents remain untouched. URI revocation cannot forcibly close a file descriptor already held by the external camera.

The core reports `CLEANING` until its non-cancellable cleanup settles. Failure produces `FAILED` with `CLEANUP_FAILED` and a fixed localized notice; cleanup metadata remains available for a later restoration attempt. The core releases its submission reservation even on cleanup failure. Once any outstanding camera result has been discarded, later attachment actions are available while the cleanup failure remains visible.

A completed image receipt follows [encrypted input persistence](2026-09-26-android-encrypted-input-checkpoints.md). It survives Android process restart as part of the same ordered draft and request identity without rereading a capture, reopening the camera, uploading again or sending automatically. An unfinished capture restores no attachment. Host receipt expiry retains its existing explicit-discard and new-selection recovery path.

## Alternatives considered

**Use the returned thumbnail.** A thumbnail can be absent or substantially smaller than the camera's JPEG. An explicit output URI gives the application one full-size source whose bytes can be checked independently.

**Publish captures in MediaStore or request broad camera/media access.** The companion needs one temporary input, not ownership of a user's photo library or an embedded camera. A narrowly granted private output avoids adding permanent media entries and broader permission state.

**Persist a capture URI and resume its upload after process death.** Cleanup metadata cannot establish current upload intent or a current Host/Session owner. Completed receipts restore through the input store; incomplete captures are retired without upload.

**Unregister the camera launcher when file cleanup finishes.** An external result can arrive later and remain buffered in Activity Result saved state without its callback. Retaining the registered launcher until that result is consumed and discarded completes the launched request before another picker is admitted.

**Delete the output immediately after the camera returns.** The attachment reader and upload still own the source. Cleanup waits for their job to settle so cancellation and normal completion obey the same lifetime rule.

## Consequences

The companion adds camera intake while retaining the existing Host image and prompt mechanisms. Full-size captures may exceed the bounded mobile intake limit, and a blocking provider can delay awaited cleanup. Physical devices, third-party camera applications, background capture, automatic resumption and live-model image interpretation require separate qualification.

Full Android core results contain 390 passing tests across 64 suites with no failures, errors or skips. The application and instrumentation APK builds pass. On the Android 34 emulator, the installed Files/Photos picker and [Camera tests](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeCameraCaptureTest.kt) pass all 18 cases, including 9 Camera cases. These checks cover owned-output and Activity Result lifecycle behavior.

The [Camera scenario](../../../../apps/web/tests/android-camera-attachments.e2e.ts) passes with the real system camera on an Android 34 x86_64 emulator and both installed APK hashes matching the current builds. An independently read 1392 × 1856 temporary JPEG matches the uploaded bytes. Host-stored normalized bytes match the attachment id and byte count; Android independently decodes their dimensions and media type. The source and normalized image need not have the same hash.

Cancelling capture preserves the complete draft, deletes its temporary output and makes no Host call. Upload completion cleans its source after the Host operation settles. Actual process termination with a second capture pending restores the same completed receipt, draft and request identity, removes the orphan output and performs no upload or prompt. Explicit submission records one user-origin message with the expected `ImageBlock`; Session-authorized reading returns the independently hashed stored bytes. The model response comes from a keyless recorded fixture.

Final native regression passes in two runs: 8 cases across 7 files cover Camera, Photos, Files, input persistence, both lost-acknowledgement recovery cases, diagnostics and viewing position; a separate [persistent-download run](../../../../apps/web/tests/android-download-adoption.e2e.ts) passes 1 case in 1 file. Together these runs cover 9 cases across 8 files on the tested emulator.

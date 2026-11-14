# Agent Note: Native image uploads use the same complete-body budget admission

Status: implemented

English | [中文](2026-09-29-native-image-upload-budget.zh.md)

## Problem

The [file budget decision](2026-09-28-native-http-upload-budget.md) admitted only `fileUploads/upload`. `fileUploads/uploadImage` sent its complete signed body without reading the listener budget, so a Photo Picker image inside the local source and encoded-arguments limits could still exceed the receiving listener's body limit and surface as a transport failure instead of an admission result. The composer's Photos entry also stayed available whenever `image-upload.stage.v1` was advertised, offering an action whose every upload would fail when the Host did not also advertise `native-remote.http-request-budget.v1`.

## Decision

The Native client's budget admission now covers both explicit upload endpoints. `fileUploads/upload` and `fileUploads/uploadImage` each read the receiving listener's budget once through the same verified Native client, validate it, and refuse the complete final UTF-8 body before creating the HTTP call. An observed excess maps to the attachment model's `REQUEST_TOO_LARGE` issue with no retry, no receipt, and no draft or pending replacement; one fresh read per explicit upload, no cache and no default follow the file budget decision. The composer's Photos action requires both `image-upload.stage.v1` and `native-remote.http-request-budget.v1`; when only the budget capability is missing, the entry's hint names the missing Host limit instead of image support. The [file budget decision](2026-09-28-native-http-upload-budget.md) keeps owning budget discovery, dispatch scope and failure categories.

## Alternatives considered

**Admit images by encoded arguments only.** RPC metadata and signed admission put the complete body above the arguments; that mismatch is why the file decision compares final bytes.

**Cache one budget across uploads of both kinds.** A cross-request cache can reuse a value from another listener or an earlier configuration; each explicit upload reads fresh.

**Leave the Photos entry available without the budget capability.** Every image upload would then fail at the transport with no admission explanation; the entry reports the missing prerequisite instead.

## Consequences

The full Android core suite passes 450 tests with no failures, errors or skips, including the [client budget tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/gateway/NativeGatewayUploadBudgetTest.kt) image cases: a fresh budget per explicit image upload signed at the inclusive limit, refusal of a body one byte over before the POST, a refused or capability-missing Host blocking instead of falling back to an unbounded body, and prompt operations not querying the budget. The support export fixture records the `native-remote.http-request-budget.v1` capability row that the file increment's filtered unit round had left unrecorded.

The [installed image budget scenario](../../../../apps/web/tests/android-native-image-upload-budget.e2e.ts) passes its single case with exit code 0, with both installed APK hashes matching the tested builds. A padded real PNG — 1280 bytes through one ancillary tEXt chunk, encoded arguments within 2048 — is refused locally as `REQUEST_TOO_LARGE` after exactly one budget read with zero image POSTs, zero prompts and the typed draft intact. After deleting the refused source photo, an explicit smaller selection reads the budget again, uploads the 69-byte source PNG once, Host storage and session-authorized reading return the verified bytes, and the final explicit send produces exactly one durable user message with one ImageBlock. Three screenshots (`image-budget-refused`, `small-image-ready`, `sent-small-image`) and the installed APK hashes are preserved under `.artifacts/android-native-image-upload-budget-ui/`.

Focused regressions pass with exit code 0: [Photos](../../../../apps/web/tests/android-photo-attachments.e2e.ts) — required because the Photos entry gating changed — plus [Files](../../../../apps/web/tests/android-file-attachments.e2e.ts), [receipt recovery](../../../../apps/web/tests/android-attachment-receipt-recovery.e2e.ts) and [share intake](../../../../apps/web/tests/android-share-intake.e2e.ts), one case each. These results verify the tested emulator, scaffold and TLS paths; physical devices, third-party senders, image batch admission, streaming and resumable uploads, and Host-restart budget invalidation remain separate qualification work owned by the file budget decision's open boundaries.

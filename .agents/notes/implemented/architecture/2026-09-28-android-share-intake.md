# Agent Note: Android share intake confirms one target and adopts complete batches atomically

Status: implemented

English | [中文](2026-09-28-android-share-intake.zh.md)

## Problem

An external share can arrive before pairing, while another picker is active, or during a Host or Session change. Receiving its Intent does not authorize provider reads, uploads or prompt submission. Importing each attachment directly into the draft would expose partial batches and leave gaps in prompt exclusion. A local save failure after adoption also differs from an upload failure: repeating the import would append content twice.

## Decision

`MainActivity` accepts `ACTION_SEND` and `ACTION_SEND_MULTIPLE` with `singleTask` delivery through `onNewIntent`. `NativeShareIntake` holds one pending text-and-URI payload in memory without querying provider metadata, opening streams or uploading. Another delivery cannot overwrite a pending or active import; after consumption, a new explicit delivery is a new proposal even when its URI repeats. Text, URLs and HTML-looking content remain literal text and never trigger navigation or fetching.

The receiving card displays the current Host and ordinary Session and requires **添加到草稿** confirmation. The captured target includes the exact attachment model and input owner, Host key and generation, Session id and selection generation. Confirmation checks the displayed target again, the role, input availability, Session-control support and relevant upload capabilities. Core admission compares the expected Session generation under the same lock used for prompt exclusion. Target replacement cancels the captured operation without adopting a replacement target automatically. An existing Files, Photos or Camera picker retains its own ticket and callback; share delivery cannot consume it. Confirmation remains disabled until that operation's independent result and cleanup complete; it does not queue an automatic import.

A new share entering review clears composer focus and dismisses the software keyboard so the user can inspect the Host, Session and confirmation controls.

Intent parsing prefers the ordered `EXTRA_STREAM` payload; only its absence selects URI entries from `ClipData`. It does not concatenate both representations or deduplicate repeated occurrences. Sources must be `content` URIs with an authority and no user information; malformed extras, nested Intents, selectors and the application's private camera-provider URIs are refused. The application never takes persistable source grants, deletes shared documents or stores source bytes in input checkpoints.

Incoming text is limited to 64 KiB of UTF-8, incoming and combined-draft attachments to 8, each source to 512 KiB, and each encoded upload-arguments JSON to 1 MiB. The JSON limit excludes the signed RPC envelope; these application limits are not negotiated with the Host. MIME resolution occurs on the I/O dispatcher after confirmation. A declared image must resolve to supported PNG, JPEG, WebP or GIF; unknown or unsupported image types fail instead of falling back to generic files. Other items use the provider MIME to choose image or file admission. The resolved kind must be allowed before the application queries its name or opens its bytes.

The [view-link decision](2026-09-28-android-view-deep-links.md) owns `ACTION_VIEW` navigation. URLs received through Share remain text. Neither external entry replaces the other's pending operation; a busy refusal requires explicit retry or a new delivery after the existing work ends.

## Atomic draft adoption

`NativeFileAttachmentsModel.importShare()` holds one `SessionAttachmentAdmission` across the entire ordered batch. It reuses bounded reads, encoded uploads and receipt validation from ordinary attachment intake without releasing admission between items. Send, retry and other attachment intake remain excluded through provider and RPC work, atomic adoption, and the subsequent `inputs.flush()` checkpoint attempt. Cancellation waits for owned work to settle; completion releases admission even when parent cancellation prevents the coroutine body from starting.

Only a complete set of valid staged receipts reaches one atomic input update. That update rechecks the target and total attachment count against the latest draft, preserves existing attachments and edits made during upload, appends the incoming ordered attachments, and joins non-empty existing and incoming text with one blank line. It assigns one new request id and leaves every original pending prompt unchanged. Before adoption, any read, upload, receipt, limit or ownership failure leaves the draft untouched by the import. Successfully staged Host objects can remain unreferenced after such a failure; the batch adds no storage rollback or garbage collection.

`NativeShareResult` distinguishes `NotAdopted` from `Adopted(requestId, saved)`. An independent completion result retains the adoption fact if cancellation or `inputs.flush()` failure follows the atomic update. Both adopted outcomes consume the pending share. `saved = false` keeps the adopted draft and offers the existing local input-save retry; it does not upload or append again. A save notice clears only when the identical adopting `CompanionInputState` reports `SAVED`. A different Host's successful save cannot clear it. Neither failure path schedules an automatic upload retry or prompt.

## Restoration and ownership

Rotation retains the in-memory intake owner. `SavedStateHandle` records only pending/done disposition; process restoration marks an unfinished share interrupted and does not reconstruct text, sources or URI authority from that marker. A consumed share restores without an interruption notice. A restored Activity or `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` launch does not reprocess its original share Intent. A later explicit new Intent can create a new proposal. Already adopted drafts use the existing encrypted input format and restore their receipts without provider reads or automatic submission.

The [Files decision](2026-09-27-android-file-attachments.md) retains document-picker and source-read ownership, the [Photos decision](2026-09-27-android-photo-attachments.md) retains image staging and mixed receipt semantics, and the [Camera decision](2026-09-27-android-camera-attachments.md) retains owned-output cleanup and external callback retirement. The [input-checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md) continues to own durable input identity and recovery. Share intake composes these mechanisms without changing the Host protocol or encrypted-input version.

## Alternatives considered

**Read or upload as soon as a share arrives.** The user has not confirmed a Host or Session, and provider access itself can fail or perform work. Reception holds only the delivered values; confirmation establishes the exact target before I/O.

**Loop over ordinary single-item picker admission.** Each release would permit a prompt between items, and each adopted receipt would expose a partial batch. One reservation and one final draft update preserve whole-batch intent.

**Reapply the draft captured when confirmation began.** Upload can overlap newer user edits. Appending under the input lock preserves the current text and attachments instead of replacing them with an older snapshot.

**Treat checkpoint failure as an unadopted share.** The draft already contains the batch. Keeping the original share retryable would upload and append it again, so adoption is reported independently from saving.

**Restore URI payloads or replay the Activity's original Intent.** Saved values cannot establish a current provider grant or an explicit new import decision. Interrupted unadopted shares require another delivery; completed receipts restore through the input store.

## Consequences

Share intake extends the draft without sending a message or creating a second attachment protocol. Sender grants can expire, providers can block cancellation, and failed batches can leave staged Host objects. Physical devices, arbitrary third-party senders/providers, cross-platform sharing and live-model attachment interpretation need separate qualification.

Full Android core results contain 406 passing tests across 66 suites with no failures, errors or skips. These include 10 [batch tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeShareAttachmentsModelTest.kt) and 6 [lifecycle tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeShareAttachmentsLifecycleTest.kt) covering atomic adoption, limits, exclusion and cancellation. The application and instrumentation APK builds pass.

The installed emulator run passes all 31 cases: 12 [Share intake tests](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeShareIntakeTest.kt), 1 [Activity test](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeShareActivityTest.kt), 9 Files/Photos picker cases and 9 Camera cases. Share coverage includes Intent parsing, exact target ownership, cancellation, restoration and single-Activity delivery across rotation.

The [real-Host Share scenario](../../../../apps/web/tests/android-share-intake.e2e.ts) passes its single case with both installed APK hashes matching current artifacts. System Files delivers test-owned sources through the real Sharesheet; review and dismissal preserve the draft without Host mutations. Assertions verify that review closes the keyboard and exposes the Host, Session and confirmation controls. Explicit text-only confirmation appends literal text and URLs. Holding the second upload proves that the first receipt cannot partially update the draft or admit sending; complete adoption preserves a concurrent edit and the delivered order. Independently hashed Host file and image bytes match the known binary and metadata-free PNG.

The scenario checks source hashes before deleting only its test-owned sources, then terminates the app with another share pending. Restart discards pending intake while restoring the completed draft and request identity without upload or prompt. Explicit send records one user-origin message with the exact ordered attachment content. This evidence qualifies the tested emulator and system sharing path; the model response is a keyless recorded reply.

The broader native regression passes 12 cases across 9 files covering Share, Camera, Photos, Files, input persistence, both prompt-retry paths, diagnostics, viewing position and three credential-recovery cases. After the local keyboard fix, a focused run passes Share and [persistent downloads](../../../../apps/web/tests/android-download-adoption.e2e.ts), 2 cases across 2 files; the latest installed run also passes all 31 cases. These are separate runs, not an accumulated count of independent cases. All five current Share screenshots were reviewed: the receiving card shows the full target with the keyboard closed, draft editing retains normal keyboard use, and restored/sent attachments retain their displayed names and order.

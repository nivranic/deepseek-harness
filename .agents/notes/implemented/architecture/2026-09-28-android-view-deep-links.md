# Agent Note: Android viewing-position links bind one navigation attempt to the selected trusted Host

Status: implemented

English | [中文](2026-09-28-android-view-deep-links.zh.md)

## Problem

A copied viewing-position payload identifies an existing Host log but is not an Android URI. External launches also arrive while credentials restore, another source is active, or a Host observation is changing. Replaying an old Activity Intent or treating retained capability facts as a newly completed query can navigate without a new user action or against the wrong model owner.

## Decision

Android accepts `ACTION_VIEW` with the exact outer prefix `dsh-companion://session-view/`, followed by the existing `dsh-session-view.v1.` payload. The prefix is 29 characters; the complete inner payload is limited to 4096 characters and the complete URI to 4125. `NativeViewLocations.encodeDeepLink()` and `decodeDeepLink()` reuse the existing Web-compatible v1 encoder and decoder. They do not trim, normalize or percent-decode. Different casing, authorities, ports, user information, extra path segments, query strings, fragments and percent escapes are refused. The inner field and safe-integer rules remain unchanged.

The manifest advertises the scheme through `DEFAULT` and `BROWSABLE`; admitted VIEW deliveries still pass parser validation. Only `ACTION_VIEW` grants navigation. Selectors, nested Intent extras and ClipData are refused. The existing bare-payload copy and paste actions remain, and **复制查看位置链接** copies the URI for the first visible durable row. A URL delivered through `ACTION_SEND` remains ordinary Share text.

A genuinely new valid VIEW delivery directly opens the existing Session and reveals its anchor. It adds no second confirmation, Session creation, prompt, upload, pairing or runtime transfer. Viewing uses the Host's existing observation and activation policy. A viewer can navigate when the Host permits reading; `SESSION_CONTROL` is not required, and a capability observation does not replace Host authorization.

## Admission and query ownership

The entry requires the selected trusted Host to be `READY`, its id to match the location, the current `CompanionViewModel` to match that Host generation, and a successful observation of `SESSION_FOLLOW`. It captures the exact `SessionModel`, Host key and generation. It neither selects a Host nor trusts an endpoint from the URI. Replacing that owner cancels the old navigation and rejects its late completion. Session selection generation is not part of the outer owner because opening the target Session deliberately changes it.

A pending Share, picker, attachment read/upload/cleanup or message send refuses the external navigation as busy. An outstanding link rejects another link or Share instead of overwriting its payload or adopting that source's work. Ending the busy operation does not automatically retry a rejected delivery. The [Share decision](2026-09-28-android-share-intake.md) retains draft adoption and source authority.

A new cold VIEW launch can wait for that launch's Host restoration and initial description query. After an attempt fails or is cancelled, only **重试打开** or a new delivery starts another attempt. Explicit retry increments `refreshEpoch` and waits for its query even when the wire retains an earlier `AVAILABLE` description. Observer state is owned by wire, pairing state, Host generation and refresh epoch; an older non-cancellable finalizer cannot publish into the replacement observation.

Each observation separately records query progress, completion and failure. Initial absence of a snapshot waits. A completed query with no snapshot, or with only `NOT_REQUESTED`/`CHECKING`, fails instead of waiting indefinitely. Cancellation and ordinary exceptions fail that observation even if the shared wire snapshot still says `AVAILABLE`, including cancellation before a query obtains its lock. Closed or retired descriptions and missing follow support cannot admit navigation.

## Navigation and restoration

The entry calls the existing `SessionModel.openViewLocation()` after Host checks. Unless input restoration is `RESTORE_FAILED`, Core navigation changes `lastSessionId` before waiting for the target snapshot or anchor and schedules its normal asynchronous input save; it does not await `flush()`. An unreadable input store remains untouched during read-only navigation. Missing anchors and cancellation do not roll selection back. Completion therefore proves a revealed anchor, not a durable checkpoint of the last selection, and no anchor is persisted for automatic replay.

Cancelling the link waits for its own navigation task to finish. The selected Session can remain open, and shared history-page HTTP work remains owned by its journal. Session or Host retirement stops and awaits that journal's work. A late page cannot publish the cancelled attempt's anchor or mark that attempt `OPENED`.

Navigation itself preserves each Session's full draft text, attachment order, request id and pending prompts. Observed Host receipts still reconcile accepted intents: a matching Session/request removes its pending prompt, and clears its draft only when the current complete draft still equals the accepted one. Newer edits and other Sessions remain. Core callers with an ongoing send keep its captured target; changed selection generations refuse late attachment adoption. These input rules remain owned by the [input-checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md).

Rotation retains the in-memory navigation owner. A waiting attempt can attach to the recreated composition's capability query under the same attempt identity; cancelling the old composition's query without delivering its result to the intake owner does not independently fail that attempt. An attempt already marked failed or cancelled stays stopped, and an opening attempt retains its existing job without another navigation.

Saved state stores only pending/done disposition, not a reusable location or navigation authorization. Process restoration and `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` never replay the Activity's original VIEW Intent; an interrupted attempt displays a fixed notice. A genuinely new cold delivery can run after current restoration, and a later explicit delivery of the same URI is a new attempt. The [view-location decision](2026-09-26-android-native-view-location.md) retains bounded history, cancellation and anchor-generation semantics; the [saved Host catalog](2026-09-26-android-saved-host-catalog.md) retains principal selection and retirement.

## Alternatives considered

**Interpret every shared string as a location.** Share text can contain URLs without requesting navigation. An exact VIEW URI distinguishes opening a location from adding literal content to a draft.

**Choose or pair a Host from the link.** A location carries identity, not trust or authority. The current trusted Host must match; switching and retrying remain explicit user actions.

**Add another confirmation before every navigation.** Opening a VIEW link already requests read-only navigation. The application validates the target and shows progress, cancellation and failures while preserving the direct action.

**Reuse a retained successful description after retry or cancellation.** Stored capability facts do not establish the outcome of the current query. Per-epoch progress and completion prevent an old `AVAILABLE` snapshot or late finalizer from admitting the new attempt.

**Persist the location and retry after restoration or readiness changes.** Those changes are not new navigation requests. Memory-only attempts and disposition-only restoration prevent an old Intent from reopening a location unexpectedly.

## Consequences

The complete Core run passes 417 tests across 67 suites with no failures, errors or skips. The [codec tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeViewLocationTest.kt), [navigation tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeViewLocationModelTest.kt) and [input-combination tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeViewLocationInputTest.kt) contain 19 cases covering strict URI parsing, size bounds, wrong-Host refusal, full input retention, accepted receipts, ongoing sends/uploads and cancellation without selection rollback.

The application and instrumentation APK builds pass, and both APKs install successfully. All 17 installed cases pass across [Intent/intake ownership](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeViewLinkIntakeTest.kt), [Activity delivery](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeViewLinkActivityTest.kt) and the [observer regression](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/HostDescriptionViewLinkNativeTest.kt). They cover direct navigation, owner replacement, restoration markers, fresh-query admission and late or cancelled query results.

The [real-Host deep-link scenario](../../../../apps/web/tests/android-view-deep-links.e2e.ts) passes its single case with installed APK hashes matching current artifacts. Public VIEW/BROWSABLE delivery lets a viewer open the selected trusted Host directly. Wrong-Host and malformed links add no Session follow or history request and preserve both drafts. Share/link exclusion, explicit retry after a refused page, the older anchor in an 88-turn Session, URI copying and repeated new delivery of the same URI are exercised without navigation issuing a prompt, upload, Session creation, runtime migration or additional pairing.

Process-recovery evidence uses force-stop followed by MAIN launch: it restores drafts without repeating the interrupted anchor request. A genuinely new cold VIEW then waits for restoration and opens its requested anchor once. Installed tests cover history-flag rejection; actual Android Recents re-entry remains unverified. Four full-screen screenshots were reviewed for wrong-Host refusal, the older anchor, restoration without replay and cold VIEW navigation, with no observed layout blocker on the tested emulator.

A separate installed regression passes 18 cases: 12 Share intake, 1 Share Activity, 2 existing description-observer and 3 capability-details cases. These results are separate from the 17 deep-link cases. Browser distribution, HTTPS App Links, other platform shells and physical devices remain separate qualification work.

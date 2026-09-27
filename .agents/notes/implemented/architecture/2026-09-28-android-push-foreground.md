# Agent Note: Android Push recovery follows foreground entry and model ownership

Status: implemented

English | [中文](2026-09-28-android-push-foreground.zh.md)

## Problem

Returning to an existing Android Activity does not recreate its retained models. A terminated event observation can therefore remain silent after a notification opens the application. Stopping every observation in the background would also prevent a live Host from producing local notifications, while recreating models would discard unrelated Session history and input ownership.

## Decision

The application invokes `PushModel.ensureWatching()` through the lifecycle's `ON_START` event. Registering an observer on an already started Activity delivers that same initial event; there is no second unconditional start. Initial attachment and each later foreground entry use one synchronous admission. A healthy or opening observation keeps its existing job, including while the Activity is in the background. There is no timer or background retry loop.

The model admits its first observation, then admits another only after the current job and its cleanup have completed with normal EOF or a failure accepted by `canReconnectObservation()`. Classification uses the original exception: ordinary transport failures and recognized temporary Host failures can recover; permission, authentication, compatibility, unknown refusals, malformed responses, internal failures and certificate or TLS peer failures cannot. Cancellation does not become EOF. A support snapshot's coarse failure category cannot authorize retry.

Synchronous admission reserves the next start before scheduling work. The existing stream owner waits for retired work and isolates generations. Only completion from the current generation can restore recovery eligibility, and a cancelled model scope cannot restore it. An entry during cleanup leaves that job alone; once it finishes, recovery requires another foreground entry. Foreground return does not restart Session, Workspace or Interaction models or issue business mutations.

## Producer and notification ownership

`CompanionModelSet` owns the Push producer in its ViewModel scope. The Compose observer keeps consuming while backgrounded; rotation removes that consumer and its lifecycle listener without stopping the producer. Listener removal is awaited through `NonCancellable + Dispatchers.Main.immediate`, satisfying the lifecycle registry's main-thread requirement even after scope cancellation. The recreated consumer attaches to the same model. Host/model retirement still closes the owned work. `stopWatching()` immediately invalidates observation and unconsumed notifications and permanently prevents that model from being restarted; `stopWatchingAndAwait()` also waits for stream cleanup. Neither operation cancels a Host task or retires the process transport.

The model retains deduplicated pushes and atomically claims unconsumed entries through `takePendingNotifications()`. Consumption is recorded before platform presentation. A recreated or concurrent consumer cannot claim them again, and a re-forward of the same push does not create another notification. This is best-effort delivery: missing notification permission or unavailable presentation does not queue a later replay. Retirement discards unconsumed presentation, and a late frame cannot append to the retired generation.

Notifications contain fixed local titles and body text. The existing immutable PendingIntent opens `MainActivity` without a Host, Session or event target; it grants no navigation or approval authority. The fixed notification id means a later notification replaces the displayed one. Push remains a prompt to inspect the Host's authoritative state, with no approval buttons, extra pairing or second Session truth. These choices cover the Background Push and Notification Action concerns in specification section 50 and the recovery states in section 64; they do not establish complete mobile-release acceptance.

The [diagnostic decision](2026-09-27-android-native-gateway-diagnostics.md) retains local, producer-labeled counters and privacy rules. The [native transport decision](2026-09-25-native-remote-connection-source.md) retains signed admission and TLS identity. The [input-checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md) retains draft and pending-intent persistence. These independently useful decisions remain active.

## Alternatives considered

**Stop Push at every background transition.** That would prevent healthy same-process local notifications while the user is in another application.

**Restart unconditionally on attachment or foreground entry.** That replaces healthy streams and retries permanent failures. A separate initial start also duplicates the lifecycle event replay when the first observation ends immediately.

**Recover by replacing all models.** Session journals, cursors and other retained state have their own owners. Push recovery does not require retiring them.

**Treat the retained push list as a presentation queue on every collection.** StateFlow replays its latest value to a recreated consumer. Model-owned consumption prevents old notifications from being displayed again.

## Consequences

The complete Core run passes 427 tests across 68 suites with no failures, errors or skips. The ten [foreground recovery tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/PushForegroundRecoveryTest.kt) cover overlapping entry, normal and temporary termination, permanent failure, cancellation, cleanup, retirement, valid late frames and atomic consumption. The [existing projection tests](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/CompanionPushTest.kt) and [connection diagnostics](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/ConnectionDiagnosticsTest.kt) retain their separate checks.

Application and instrumentation APK builds and installation succeed. All eight installed cases pass: seven [lifecycle cases](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativePushObserverLifecycleTest.kt) and the existing [notification target case](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/PushNotificationTargetTest.kt). Lifecycle cases exercise immediate termination, background consumption, foreground recovery, permanent failures and recreation; the target case checks the actual immutable PendingIntent without tapping it.

The [real Host notification scenario](../../../../apps/web/tests/android-push-foreground.e2e.ts) passes its single case, including successful instrumentation teardown. Its test-owned wire wrapper ends the first signed `$events` iterator through a private cancellation signal and waits for natural EOF; it leaves the physical mux intact. HOME and a real SystemUI notification click retain the same process, Host, models, Session, full draft and pending prompt. Recovery adds one subscription without business replay; a healthy return and rotation add none and do not redisplay consumed notifications. Four full-screen screenshots were reviewed for both system notifications, the recovered Session and rotation, with no observed layout blocker on the tested emulator. The resumed draft remains editable with its keyboard, and rotation retains the pending-send failure notice.

The scenario first issues one explicit prompt and uses a controlled refusal to retain pending input; its zero-business-call assertions begin after that setup. Test code cancels the two Host approval waits, rather than Android cancelling them automatically. Notification permission is pregranted, so the permission-dialog flow is not qualified.

Logical event-stream EOF is not evidence of physical network loss, mux reconnection, Host restart, FCM/APNs, process-death delivery, actual Recents entry, precise notification targeting or physical-device background behavior. Those qualification limits remain open.

# Agent Note: Android notification permission belongs to the application process

Status: implemented

English | [中文](2026-09-28-android-notification-permission.zh.md)

## Problem

Notification request history held by a Compose instance disappears on rotation. Recording a request only after its answer also leaves overlapping foreground entries free to request again while the system dialog is open. A remembered answer cannot show a notification setting that the user changes outside the application.

## Decision

`CompanionApplication.notificationGrant` lazily owns one `NotificationGrantController` for the process. The controller retains only application context for the system query; Activities, Host models and Sessions do not own or reset its history. Notification permission may be requested before pairing, matching the existing initial entry. Android determines whether an admitted request displays a system dialog.

The controller serializes `refresh()`, `claimRequest()` and `onUserAnswer()` under one lock. `claimRequest()` accepts only a missing system grant with an unused process request budget and records `requested=true` before calling the launcher. Repeated or overlapping claims cannot start a second automatic request, including before the first callback arrives. Launch failure does not return the budget. The state is memory-only; a new process receives a new budget.

`systemEnabled` records the latest `NotificationManager.areNotificationsEnabled()` result. Refresh preserves `requested` and `lastAnswer`. A permission callback records its answer and reads the system again: a positive answer cannot override a disabled system, and a historical denial cannot override a later system grant. `lastAnswer` is history, not permission authority. This application-level setting does not describe each notification channel, Host permission or transport health; the presenter still checks Android when posting.

## Lifecycle and settings entry

`NativeNotificationGrantObserver` uses only lifecycle `ON_START` to refresh and then claim. Adding it to an already started Activity replays that event and supplies initial admission, without another initial call. Host pairing state is not a prerequisite or effect key. The Activity result launcher stays registered at a stable composition position and directs its callback to the same Application controller. Listener removal is awaited through `NonCancellable + Dispatchers.Main.immediate`, including when the observation's scope has been cancelled.

When notifications are disabled, a compact row shows **应用通知已关闭** and **打开通知设置** on both the unpaired and paired surfaces. The button sends `Settings.ACTION_APP_NOTIFICATION_SETTINGS` with the current application's package in `Settings.EXTRA_APP_PACKAGE`. It neither sets permission nor requests a new Host grant. Returning through the system lifecycle refreshes the projection; tests must not call `refresh()` to stand in for that return.

A missing permission Activity produces a fixed request-failure notice. Missing or refused notification settings produce a fixed settings-failure notice. These notices belong to the composition and can disappear when it is recreated; the process-owned `requested` flag does not roll back. The disabled state and explicit settings entry remain available. No exception message becomes ordinary UI copy, and no persistent denial preference is added.

The [Push foreground decision](2026-09-28-android-push-foreground.md) continues to own observation recovery, retirement and model-local notification consumption. Granting permission does not itself restart that producer or replay consumed entries. Healthy observations and existing Session/input owners stay intact; Android notification permission grants no Gateway or approval authority. The existing Push record's pregranted tests remain evidence for their original scope, not for the system permission dialog.

## Alternatives considered

**Keep request history in composition or a Host ViewModel.** Composition recreates on rotation, while Host models retire on pairing and selection changes. Neither lifetime matches an application permission request budget.

**Mark requested only when the callback returns.** Another lifecycle entry can arrive before an asynchronous answer, and a result can also be synchronous. Claiming before launch covers both orders.

**Use the last answer as the current setting or refresh only after pairing changes.** System settings can grant permission after a denial without changing the Host. A foreground system read observes that change.

**Persist rejection history or automatically retry a failed launch.** Those choices add cross-process policy or repeated prompts. This implementation keeps the existing once-per-process limit and explicit settings recovery.

## Consequences

Application and instrumentation APK builds pass. The complete installed run passes 18 cases and its runner exits successfully: five [controller cases](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NotificationGrantControllerNativeTest.kt), five [permission lifecycle cases](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NotificationPermissionLifecycleTest.kt) and eight existing Push regressions. Controller cases verify synchronous admission, system authority and retained history. Lifecycle coverage comprises three real-dialog cases and two controlled observer cases: Allow, Deny, recreation during and after the dialog, overlapping observers, disposal and launch/settings failures. Recreation while the real permission dialog is open delivers its answer to the same Application controller. HOME is followed by an explicit `MainActivity` launch, not a launcher UI or Recents interaction. Real-permission cases use separate instrumentation processes and isolated-app permission baselines without `GrantPermissionRule` or a production-state reset hook. Core source is unchanged and its earlier test baseline was not rerun for this increment.

The final [real Host permission scenario](../../../../apps/web/tests/android-notification-permission.e2e.ts) passes its single case, including successful instrumentation cleanup. Its explicit runtime-permission driver mode omits pregranting while existing callers retain their default. The active instrumentation owns system UI interaction throughout Deny, the application's settings button, the actual application-wide notification switch and Back. It observes the same PID and Application controller after the real settings return. A simultaneous external UIAutomator owner would invalidate that control path and is not used.

The scenario prepares one explicitly rejected prompt and a different newer draft before its zero-business-call interval. Host notification A arrives while Settings is foregrounded, the application is backgrounded and permission is denied; it is consumed without a system notification. Granting permission, returning through Back and rotating do not replay A. New B produces a real system notification whose click returns to the application. Current Host/Session/model owners, the complete newer draft and distinct pending intent, healthy subscription count and device authorization remain unchanged. Test code cancels and awaits both Host approval requests; Android does not answer or cancel them automatically. Six full-screen screenshots record the initial permission dialog, denial after rotation, the disabled and enabled system settings, the new Host notification and the returned Session.

The default-pregranted regression passes four files and five cases: [Push foreground](../../../../apps/web/tests/android-push-foreground.e2e.ts), [VIEW deep links](../../../../apps/web/tests/android-view-deep-links.e2e.ts), [cursor resume](../../../../apps/web/tests/android-cursor-resume.e2e.ts) and [input persistence](../../../../apps/web/tests/android-input-persistence.e2e.ts). These are distinct from the final permission case and do not close the separately retained intermittent cursor investigation.

Notification-setting changes may terminate the application. A lost process or driver is a distinct result, not a reason to start MAIN or another instrumentation session and report a successful settings return. A new process does not retain controller identity, denial history or the Push model's consumption cursor. Channel-level disabling, kill-on-revoke recovery, physical devices, FCM/APNs and permission or notification delivery after process death remain open. This decision addresses notification and permission-state concerns in specification sections 50 and 64; it does not complete Mobile Release or either whole section.

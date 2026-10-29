# Agent Note: The Minimal Push Chain on Android and Apple

Status: implemented

English | [中文](2026-08-31-android-apple-push-chain.zh.md)

## Problem

Chapter 70 schedules push for three moments — approval waiting, question waiting, task completed — with content minimized to references: source code, prompts, credentials, and diff content never ride a push, and details load over the secure remote link after the app opens. The relay that will carry APNs/FCM pushes is deferred, so the companion had no push vocabulary, no chain, and no presentation at all.

## Decision

The minimal push chain rides the wire that exists today — the live `$events` stream — with a vocabulary shaped exactly for the relay to carry later. `CompanionPush` has three members holding reference data only (`ApprovalWaiting`/`QuestionWaiting` with session and event ids, `TaskCompleted` with session id and turn); titles and the shared body line are device-side localized strings (`宿主等待审批`/`宿主等待答复`/`任务完成` + `打开应用，经安全连接查看详情。`). The parsers extract only the reference fields: `pushFromForward` reads an `$events` approval or question forward and never touches its `title`/`text`, and `pushFromTurnEnd` projects only a `turn/end` whose reason is `completed`. Content minimization is structural — the types have no fields for wire content — so the forbidden classes cannot ride a push even by accident.

Each stack wires one push view model over the shared stream seam: Kotlin `PushModel` (StateFlow of deduplicated pushes) presenting through `PushNotifications` (platform channel, best-effort without the runtime grant, tapping reopens the app), Swift `PushViewModel` with a `CompanionPushPresenting` seam whose `SystemPushPresenter` builds the minimized `UNNotificationContent` and hands it to UNUserNotificationCenter; `CompanionRootView` starts the watch beside the interaction inbox. A lost stream simply ends the watch — the inbox keeps its own subscription, and the relay carries these pushes when it exists.

## Consequences

FakeWire-driven tests on the Kotlin side and FakeWire plus a recording-presenter fake on the Swift side pin the same chain: a forward carrying `title` and `text` fields yields the reference-only push; a re-forward of the same event deduplicates; a non-push-worthy frame and a frame missing its session id project nothing; the localized notification content asserts the minimized title and body. The turn-end parser test pins completed-yes/aborted-no/other-tag-no. Both lanes verified green. What remains for the relay stage: APNs/FCM delivery, background wake, and the runtime notification grant flow on Android.

## Alternatives considered

Deriving pushes from the interaction inbox was rejected — it would couple the answer surface to the notification surface and leave TaskCompleted with no path; the push view model owns its own `$events` subscription at the cost of one extra stream. Carrying the forward's `title` into the notification was rejected — an approval title is host-composed content and chapter 70 draws the line at references only; the device-localized dictionary keeps the payload minimal by construction.

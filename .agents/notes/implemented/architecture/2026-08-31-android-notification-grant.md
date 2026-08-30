# Agent Note: The Android Runtime Notification Grant

Status: implemented

English | [中文](2026-08-31-android-notification-grant.zh.md)

## Problem

The chapter-70 push chain presented best-effort: on Android 13+, POST_NOTIFICATIONS is a runtime grant, and without asking for it the system silently drops every notification the chain posts. The relay stage's Android leg — the grant flow — was the one piece of the push path that could not work on a real device.

## Decision

The grant logic splits into a pure projection in core and an Activity-bound flow in the app. `NotificationGrantState` carries the system enablement read, whether this process has asked, and the user's last answer: presenting proceeds whenever the system allows it, and the ask fires once per process while the grant is missing — a denial sticks for the process, and the recovery path is the user changing the grant in system settings, which the enablement read observes on refresh. The app-side `NotificationGrantController` holds the projection as a StateFlow, records the system dialog's answer, and re-reads enablement; `CompanionApp` refreshes the projection after pairing and launches the `RequestPermission` contract once when `shouldRequest` says so. `PushNotifications` exposes the enablement read (`notificationsEnabled`) that the controller and its own presenter guard share.

Background wake and APNs/FCM delivery stay deferred with the relay; this is the grant leg only.

## Consequences

`NotificationGrantTest` pins the projection: an enabled system presents without asking; a missing grant asks exactly once per process (fresh state requests, a recorded denial does not); a granted answer flips the system read and presents. The Android lane verified green. With the grant leg in place, the relay stage's remaining Android work is delivery (APNs/FCM) and background wake.

## Alternatives considered

Requesting on the first push arrival instead of after pairing was rejected — the ask would interrupt at an unpredictable moment, and pairing completion is the natural "this app will talk to you" moment. Re-asking after every denial was rejected — Android 13+ auto-denies repeated requests, so the projection models ask-once honestly and treats the settings read as the recovery signal rather than nagging.

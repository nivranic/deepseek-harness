# Agent Note: Backgrounded carrier-loss and foreground return for the persisted follow window (§25)

Status: implemented

English | [中文](2026-10-03-android-follow-foreground.zh.md)

## Problem

Backgrounded reconnect must restore observation without submitting retained input, consume live records without a visible window, and present the reconciled history on foreground return.

## Decision

- Recovery is observation-only: reconnect must preserve unsent input and send no business mutation. The Host's current follow interface supplies a complete bounded opening; the native journal owns overlap validation.
- New lane `apps/web/tests/android-follow-window-foreground.e2e.ts` on the outage skeleton: pair, open a seeded Session, load one older page, append three records and let the device display them (durable cut advanced), `systemHome`, poll the backgrounded state (`foregroundSnapshot`: CREATED, unfocused, foreign window), then `terminateDeviceConnections({ deviceId })` **while backgrounded**.
- The follow loop belongs to `viewModelScope`, independently of foreground focus. The scenario destroys the carrier while backgrounded, verifies a reopen with the original request fields, appends three live records, then returns through the launcher and checks the complete retained window, unsent draft, and single device grant.
- Honest boundaries kept: a healthy background round-trip by design produces no new follow request (the stream survives; both outcomes are lawful per the spec lens), OS background-kill behaviors (Doze, real devices) and FCM delivery stay unqualified, and the reopened-snapshot shape stays unpinned.

## Alternatives considered

- **Plain HOME→return round-trip without a carrier kill:** the follow stream survives backgrounding, so it does not test reopening or reconciling a new snapshot; a deterministic reopen requires destroying the carrier while backgrounded.
- **Returning via a real push notification (`clickPushNotification`):** rejected — the notification path requires manufacturing a real approval push and heavily overlaps the push-foreground lane's claims; a plain launcher return exercises the same task-bring-forward without any intent side effects.
- **`deliverSharedText` as the in-op foreground return:** rejected — it routes a share intent through `onNewIntent`, polluting `getIntent()` and the UI.
- **Reducing the fixture below ~192 records:** rejected — the Host's window bound swallows the whole session, leaving no older page for `loadOlderHistory`.

## Consequences

- The scenario defines background reconnect and foreground presentation acceptance. Its complete-opening adaptation requires a new installed-app run; it does not qualify push delivery or physical-device behavior.
- The driver's per-request budget rose from 40s to 90s (test infrastructure, not an assertion): whole-window assertions scroll up to the Host's ~192-record bound and measured ~60s on a loaded emulator while still completing server-side; the raised budget removes the dropped-response retry storm at its root. Two consecutive green runs anchor stability.
- `bringToFront()` joins the driver's controlled-reachability surface for any future lifecycle lane.

## Open work

- Real-device qualification and OS background-kill behaviors across the native tracks; FCM delivery stays unqualified by design.

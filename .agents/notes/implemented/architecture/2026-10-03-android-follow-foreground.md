# Agent Note: Backgrounded carrier-loss and foreground return for the persisted follow window (§25)

Status: implemented

English | [中文](2026-10-03-android-follow-foreground.zh.md)

## Problem

§25's persisted window had installed evidence for logical interruption, process death, and foreground carrier loss, but the traceability ledger still carried the acceptance label "foreground and push recovery": nothing proved that a **backgrounded** process re-opens follow with its durable cursor on its own, consumes records arriving while backgrounded, and presents the merged window intact on foreground return.

## Decision

- Spec grounding first: §25's original text names only network interruption with cursor resume; "foreground/push recovery" is a ledger label. The binding spec sentences are §80's "断网、后台、Host restart 后可恢复" plus §25's cursor semantics and §19/§67's no-silent-send/no-auto-submit. The push observation's one-shot foreground restart belongs to the push-foreground lane (§64/§50) and is not re-claimed here.
- New lane `apps/web/tests/android-follow-window-foreground.e2e.ts` on the outage skeleton: pair, open a seeded Session, load one older page, append three records and let the device display them (durable cut advanced), `systemHome`, poll the backgrounded state (`foregroundSnapshot`: CREATED, unfocused, foreign window), then `terminateDeviceConnections({ deviceId })` **while backgrounded**.
- The follow loop is lifecycle-independent (`viewModelScope`, no foreground hook, 1s retry): the backgrounded process re-opens follow on its own — the lane pins `requests[1].fromSeq == cursor + 3`, appends three more records **while backgrounded** (consumed by the re-attached follower, cursor advancing without the UI), then returns to the foreground through a plain launcher `am start` (singleTask, no intent routed) via a new driver `bringToFront()` helper, and asserts the merged window `first..cursor+6` contiguous with `attempts: 2`, the unsent draft retained, zero business mutations, and the single device grant.
- Honest boundaries kept: a healthy background round-trip by design produces no new follow request (the stream survives; both outcomes are lawful per the spec lens), OS background-kill behaviors (Doze, real devices) and FCM delivery stay unqualified, and the reopened-snapshot shape stays unpinned.

## Alternatives considered

- **Plain HOME→return round-trip without a carrier kill:** rejected as the lane's core — the follow stream survives backgrounding, so no reopen occurs and no cursor claim can be observed; the deterministic reopen moment requires destroying the carrier while backgrounded.
- **Returning via a real push notification (`clickPushNotification`):** rejected — the notification path requires manufacturing a real approval push and heavily overlaps the push-foreground lane's claims; a plain launcher return exercises the same task-bring-forward without any intent side effects.
- **`deliverSharedText` as the in-op foreground return:** rejected — it routes a share intent through `onNewIntent`, polluting `getIntent()` and the UI.
- **Reducing the fixture below ~192 records:** rejected — the Host's window bound swallows the whole session, leaving no older page for `loadOlderHistory`.

## Consequences

- §25's foreground-recovery label now has local installed evidence: backgrounded reconnect with the durable cursor, backgrounded consumption, intact foreground presentation, and no business writes across the whole arc.
- The driver's per-request budget rose from 40s to 90s (test infrastructure, not an assertion): whole-window assertions scroll up to the Host's ~192-record bound and measured ~60s on a loaded emulator while still completing server-side; the raised budget removes the dropped-response retry storm at its root. Two consecutive green runs anchor stability.
- `bringToFront()` joins the driver's controlled-reachability surface for any future lifecycle lane.

## Open work

- Real-device qualification and OS background-kill behaviors across the native tracks; FCM delivery stays unqualified by design.

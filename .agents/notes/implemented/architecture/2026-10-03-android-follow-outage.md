# Agent Note: Carrier-loss lane for the persisted follow window (§25)

Status: implemented

English | [中文](2026-10-03-android-follow-outage.zh.md)

## Problem

The §25 persisted window had installed evidence for logical stream interruption and process death, but no physical-transport break: §29's outage lane documented both that an idle follow stream cannot detect an adb-reverse removal and that the Host-side `terminateDeviceConnections` primitive is the deterministic carrier-destroying tool — whether the device's follow reopen after such a break carries the persisted cursor had never been proven.

## Decision

- New lane `apps/web/tests/android-follow-window-outage.e2e.ts` on the persistence skeleton: pair, open a seeded Session, load one older page, append three records on the still-open stream and let the device display them (durable cut advanced), then `terminateDeviceConnections({ deviceId })` destroys the paired device's stream carrier on the Host side — a real transport break the device detects on its own, with no adb-reverse removal involved.
- The gateway-side spy pins the contract facts: the first request carries no cursor; the reopened request carries the last applied sequence **including the pre-outage appends**; nothing is appended during the outage, so no outage-time Host write is claimed; after reconnection three further records arrive on the reopened stream and fold into the retained page without a gap (`assertSessionWindow` with `attempts: 2`, which itself proves a reconnect attempt happened).
- The window assertion uses a bounded three-step retry ladder covering two observed flake classes: a dropped slow response (the driver's per-request timer expires while the operation still completes server-side) and the Compose scroll verifier bailing after the window facts already matched — both are re-observation classes. Two consecutive green runs anchor stability.
- Unsent input, the single device grant, and zero business mutations are asserted; a screenshot lands under `.artifacts/screenshots/android-follow-window/outage.png`.

## Alternatives considered

- **adb-reverse removal as the outage:** rejected — §29's outage lane already documented that an idle follow stream cannot detect a removed reverse tunnel, so the lane would hang on an undetected break instead of exercising the reconnect path.
- **Appending during the outage:** the Host's published window advances only while a follower is attached, so outage-time appends would be invisible to the reopened snapshot; the lane appends before the cut (advancing the durable cut the reopen must carry) and after reconnection (proving the reopened stream is live).
- **Pinning the reopened snapshot's shape:** the Host may lawfully serve a full latest window on reopen; the lane pins only what §25 guarantees — the resume cursor, the post-outage merge contiguity, and the retained older page.

## Consequences

- §25's carrier-loss resume item now has installed-level evidence on a real Host; foreground/push recovery and real devices stay open, and the idle-stream adb-reverse gap stays documented rather than papered over.
- The widened retry ladder (timeout + scroll-verifier classes) is the new baseline for whole-window assertions on loaded emulators.

## Open work

- §25's foreground/push recovery acceptance; real-device qualification across the native tracks.

# Agent Note: Carrier-loss lane for the persisted follow window (§25)

Status: implemented

English | [中文](2026-10-03-android-follow-outage.zh.md)

## Problem

Carrier-loss recovery must retain already loaded history and unsent input while reattaching to a live stream. An idle follow cannot reliably detect removal of an adb reverse tunnel, so that operation cannot provide a deterministic reconnect trigger.

## Decision

- New lane `apps/web/tests/android-follow-window-outage.e2e.ts` on the persistence skeleton: pair, open a seeded Session, load one older page, append three records on the still-open stream and let the device display them (durable cut advanced), then `terminateDeviceConnections({ deviceId })` destroys the paired device's stream carrier on the Host side — a real transport break the device detects on its own, with no adb-reverse removal involved.
- The reopened follow uses the original address and page bound. No record is appended during the outage; after reconnect, three further records arrive on the new stream and must merge into the retained page without a gap.
- The window assertion uses a bounded three-step retry ladder covering two observed flake classes: a dropped slow response (the driver's per-request timer expires while the operation still completes server-side) and the Compose scroll verifier bailing after the window facts already matched — both are re-observation classes. Two consecutive green runs anchor stability.
- Unsent input, the single device grant, and zero business mutations are asserted; a screenshot lands under `.artifacts/screenshots/android-follow-window/outage.png`.

## Alternatives considered

- **adb-reverse removal as the outage:** rejected — §29's outage lane already documented that an idle follow stream cannot detect a removed reverse tunnel, so the lane would hang on an undetected break instead of exercising the reconnect path.
- **Appending only during the outage:** a complete opening can recover those records, but that alone does not establish delivery on the new live stream. This scenario appends before the break and after reconnect to check retained history and resumed live delivery.
- **Pinning raw snapshot length:** the Host returns a complete message-bounded opening, which may also include metadata. The scenario checks identical request fields, merged continuity, and retained older history.

## Consequences

- The scenario defines carrier-loss recovery acceptance. Its complete-opening adaptation requires a new installed-app run; foreground/push behavior and physical devices remain separately qualified.
- The widened retry ladder (timeout + scroll-verifier classes) is the new baseline for whole-window assertions on loaded emulators.

## Open work

- §25's foreground/push recovery acceptance; real-device qualification across the native tracks.

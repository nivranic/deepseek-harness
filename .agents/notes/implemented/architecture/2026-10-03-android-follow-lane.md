# Agent Note: Installed process-death lane for the persisted follow window (§25)

Status: implemented

English | [中文](2026-10-03-android-follow-lane.zh.md)

## Problem

The §25 persisted window shipped with core-level evidence (two `SessionModel` instances sharing a store in `NativeJournalPersistenceTest`), but the installed application had never proven it: a real force-stop between a session's appends and its reopen, on a real Host, was the open installed-level item.

## Decision

- `apps/web/tests/android-follow-window-persistence.e2e.ts` pairs, opens a seeded Session, loads an older page, force-stops the application, appends three records while it is stopped, and relaunches the same installation before reopening.
- Initial and restarted follow requests use the same address and page bound. The complete opening includes the newly appended records and an overlap with persisted history; the application must display the retained older page without gaps or duplicates.
- The window assertion uses one lane-side retry: a restored process starts its list at the top, so the first full-window scroll can exceed the driver's per-request timer while the operation still completes server-side; the retry observes the settled list. Stability evidence must come from runs against the current opening protocol.
- Unsent input, the single device grant, and zero business mutations are asserted; a screenshot lands under `.artifacts/screenshots/android-follow-window/`.

## Alternatives considered

- **Moving `persistJournalWindow` off the main dispatcher first:** evaluated and rejected as the hang's fix — each process performs two or three bounded writes (~hundreds of milliseconds) and the gateway observed no reconnect storm, so main-thread file I/O cannot explain a forty-second compose clock freeze; the synchronous save-before-load ordering is pinned by the core tests. The scroll-boundary retry addresses the actual observed mechanism.
- **Appending only before the kill:** this cannot establish that a complete opening reads changes made without the old follower. Appending after process death checks the Host's independent snapshot read.
- **Counting all records as messages:** message limits exclude metadata records. The scenario checks the appended records, overlapping sequence coverage, and merged continuity.

## Consequences

- The scenario defines installed-app acceptance of persisted-window recovery. Its complete-opening adaptation requires a fresh installed-app run; physical network loss and physical-device acceptance remain separate.
- The retry-once window assertion documents the restored-process scroll cost honestly instead of hiding it in infra timeouts.

## Open work

- §25's physical-network and foreground/push recovery acceptance; real-device qualification across the native tracks.

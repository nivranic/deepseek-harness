# Agent Note: Installed process-death lane for the persisted follow window (§25)

Status: implemented

English | [中文](2026-10-03-android-follow-lane.zh.md)

## Problem

The §25 persisted window shipped with core-level evidence (two `SessionModel` instances sharing a store in `NativeJournalPersistenceTest`), but the installed application had never proven it: a real force-stop between a session's appends and its reopen, on a real Host, was the open installed-level item.

## Decision

- New lane `apps/web/tests/android-follow-window-persistence.e2e.ts` on the cursor-resume skeleton: pair, open a seeded Session, load one older page, append three records **while the follow stream is still open** (the Host's published window advances only with a follower attached — appends after the kill are invisible to the reopened snapshot), force-stop (`driver.kill()`), relaunch the same installation, `assertRestored`, reopen.
- The gateway-side spy pins the contract facts: the first request carries no cursor; the reopened request carries the persisted last retained sequence; the Host's resumed snapshot omits the covered tail and returns exactly the three appended records (`first == cursor + 1`); the app's merged window keeps the older page contiguously (`assertSessionWindow` over the full range with `attempts: 1` — the restarted process counts only its own follow).
- The window assertion uses one lane-side retry: a restored process starts its list at the top, so the first full-window scroll can exceed the driver's per-request timer while the operation still completes server-side; the retry observes the settled list. Two consecutive green runs anchor stability.
- Unsent input, the single device grant, and zero business mutations are asserted; a screenshot lands under `.artifacts/screenshots/android-follow-window/`.

## Alternatives considered

- **Moving `persistJournalWindow` off the main dispatcher first:** evaluated and rejected as the hang's fix — each process performs two or three bounded writes (~hundreds of milliseconds) and the gateway observed no reconnect storm, so main-thread file I/O cannot explain a forty-second compose clock freeze; the synchronous save-before-load ordering is pinned by the core tests. The scroll-boundary retry addresses the actual observed mechanism.
- **Appending after the kill:** the Host serves the reopened snapshot from its published window, which advances only while a follower is attached — the spec's interruption shape (records appended during the interruption, reopen from the last applied sequence) requires the appends to precede the kill.
- **Pinning the resumed snapshot's shape beyond the contract:** the Host may lawfully fall back to a full window; the lane pins only what §25 guarantees (the resume cursor, the omitted tail when covered, the merged contiguity).

## Consequences

- §25's persisted-window item now has installed-level evidence on a real Host; physical network loss and foreground/push recovery stay open, as does physical-device qualification.
- The retry-once window assertion documents the restored-process scroll cost honestly instead of hiding it in infra timeouts.

## Open work

- §25's physical-network and foreground/push recovery acceptance; real-device qualification across the native tracks.

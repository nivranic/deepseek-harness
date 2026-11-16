# Agent Note: Android persisted follow window across process restarts (§25)

Status: implemented

English | [中文](2026-10-02-android-follow-window-persistence.zh.md)

## Problem

An in-memory follow window disappears when the process ends. Retaining the complete bounded window lets a restarted process reconcile a new Host snapshot with earlier loaded history; a cursor alone cannot reconstruct the view.

## Decision

- New core persistence seam `NativeJournalStore.kt`: `NativeJournalWindow` (sessionId, address, cut, hasMore, records), `NativeJournalStoring` (load/save), and `FileNativeJournalStore` — one encrypted v1 document per principal (`<sha256>.journal`, the `FileCompanionInputStore` layout), exact field sets, atomic same-directory move, bounded reads and writes.
- The window is a Host-reconstructible cache, not user input: `load()` quarantines unreadable bytes (malformed document, failed cipher authentication) beside their file as `.unavailable-<uuid>` and reads as absent — the documented recovery is a cold open, never a crash and never a silent replace.
- `save()` keeps the newest records within the byte bound by dropping from the oldest side with `hasMore` forced true; the cut and newest record never drop. A single record beyond the bound fails loud.
- Live events may extend a window past its snapshot cut (the ordinary in-memory state), so the persisted contract allows `last >= cut` with contiguity validation; an empty window carries the empty cut `-1`.
- `NativeSessionJournal` gains two seams: `installPersisted` (installs a validated window for the just-reset owner before its first follow — the ordinary resume merge then governs the next snapshot) and `checkpoint` (one durable copy of the current window).
- `SessionModel` wires them: the store loads on every follow open and seeds only a session-and-address match (a subagent address never seeds); replacement publications persist (the complete-window moments); both close paths persist the final window including live events past the snapshot cut. A fresh model without a store still opens cold.
- `CompanionRuntime.followJournal` constructs one `FileNativeJournalStore` per restored installation (`native-journal/`, `AndroidKeystoreCipher("dsh-native-journal")`, 1 MiB), the `uploadDigests` precedent; both `CompanionModelSet` construction sites pass it.

## Alternatives considered

- **Persisting only the resume cursor:** the records make the restart merge the ordinary in-memory path (`beginFollow` → `mergeSnapshot` keeps the identical prefix); persisting only a cursor would need a second, divergent merge rule.
- **Persisting on every live event:** full-document rewrites up to the in-memory bound per event; replacement publications plus the close paths capture every state the merge can resume from — appends after the last checkpoint simply refetch through the ordinary snapshot.
- **Treating an unreadable store as fatal:** drafts are user input and fail loud; the window refetches from the Host, so quarantine-plus-cold-open is the honest recovery.

## Consequences

- A process restart of the same principal restores its records locally and requests a complete Host opening. Identical overlap preserves older history; an uncovered opening replaces it without inventing missing events.
- 持久化窗口 closes at core level; 物理断网、前台与推送恢复及真机验收 stay open, and no emulator process-restart lane ran this increment.

## Open work

- The installed-app process-death scenario must verify persisted-window reconciliation with a complete opening after restart. Its current protocol adaptation still requires an installed-app run.
- §25's physical-network and foreground/push recovery acceptance remain open.

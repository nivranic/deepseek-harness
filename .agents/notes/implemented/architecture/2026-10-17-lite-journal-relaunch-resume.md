# Agent Note: Lite sessions resume their journal across relaunches

Status: implemented

English | [中文](2026-10-17-lite-journal-relaunch-resume.zh.md)

## Problem

The Lite surface persisted its journal but never read it back: `LiteChatViewModel` always constructed an empty `LiteSession`, so a relaunch opened a blank conversation — and worse, the first send after relaunch persisted a journal holding only that new turn, silently discarding every prior turn's bytes (the section 46 silent-drop shape). Section 67's recovery clause — a mobile relaunch restores the last session, never auto-submitting an unfinished draft — had no Lite-side carrier. One adjacent defect compounded the loss: a turn that ended in a provider or network failure still recorded a `message/completed` event whose text restated the user's prompt, a fabricated assistant reply that resume would have made permanent.

## Decision

Construction seeds the session: `seedJournal` loads the store's journal for the session id and replays it as the session's history — the fold's full replay is the restore, and the constructor's existing first emission carries the recovered conversation to the UI with zero rendering changes. A journal that fails to load is quarantined, not crashed on: the store renames the file beside itself as `<id>.litejournal.unavailable-<uuid>`, bytes preserved, and the session cold-opens empty (the native journal store's documented-recovery template); a quarantine rename that itself fails stays loud, since a file the load just read failing to rename is filesystem damage, not a recovery decision. Because the seeded session carries its history, the next save's whole-file atomic write includes every prior turn — the silent overwrite repairs itself through seeding. The error-turn fabrication is fixed in the same stroke: a turn ending in `provider-error` or `network-error` records the fold's existing `provider/error` (code, message) or `network/error` (kind) event instead of a fabricated completion, so a failed turn replays as its error, never as a reply. Seeding matches on the session id alone: a changed endpoint or preset changes the next turn's request face, not the conversation's history.

## Alternatives considered

Crashing on an unreadable journal was rejected: the loader's fail-loud contract stays for direct callers, but assembly is a relaunch path, and section 67 recovers rather than crashes; the quarantine preserves both the bytes and the failure's observability. Migrating to an incremental on-disk format was rejected: the whole-file atomic replace already satisfies section 46 once the in-memory session carries its history, and a format change would drag adjacent-version migration into a recovery fix. Seeding the driver's own fold was rejected: the driver's per-event state and the journal's turn-level fidelity rule (chapter 64) are different planes, and merging them would entangle the streaming live cut with persisted outcomes — the first live turn after a resume shows only that turn until its journal replay restores the full transcript, an accepted, documented transient. Expanding the journal vocabulary to record tool or todo state was rejected: the closed sixteen-tag set is cross-checked against the TypeScript and Swift folds; resume recovers the conversation plane exactly as the journal already records it. Matching the journal to the endpoint or preset at seed time was rejected: configuration changes request faces, not history.

## Consequences

A relaunch now lands in the conversation the user left — the recovered transcript renders from the first frame — and the journal grows across relaunches instead of resetting. A corrupt journal costs its history once, observably, without blocking the app. Provider and network failures persist as themselves. One transient remains: during the first live turn after a resume, the streaming cut shows only the in-flight turn; the journal replay at turn end restores the full transcript. Two pre-existing behaviors are now named follow-ups rather than silently kept: a handoff turn still records a `message/completed` restating the prompt (the same fabrication family the error path shed), and the driver's `pendingHandoff` sticks across later non-handoff turns in the journal view.

## Open follow-ups

The handoff-turn fabricated completion and the sticky `pendingHandoff` journal view; seeding the live driver state to smooth the first post-resume turn; the RelayClient java.net.http migration or retirement; the support-export facts projection; the approval ask tier; attribution headers; the section 54 network matrix.

# Agent Note: The turn's tool rows ride the journal — chapter 64 re-adjudicated on its write face

Status: implemented

English | [中文](2026-10-24-tool-journal.zh.md)

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core` (`LiteChat.kt`), `apps/android/core` tests (`LiteChatViewModelTest.kt`)

## Problem

Chapter 64's turn-outcome fidelity rule kept tool rows entirely out of the journal: `send()` persisted the prompt and the turn's terminal events while the call and result rows lived only in the process-memory fold. A relaunch replayed the conversation but lost every tool row — the restart gap gen-63 recorded as the honest price of the then-standing Behavior-Spec decision, and §31 kept the tool-row journal persistence open behind that decision.

## Decision

Re-adjudicate chapter 64 on the write face (part A of the recorded split-two): the journal now keeps the turn's complete folded face. After the turn's terminal event lands, `send()` rebuilds the turn's tool rows from the fold as the canonical events and records them between the prompt and the outcome events — each completed or failed row as its `tool/call` plus `tool/result` pair (the result's `ok` read from the folded phase), each new artifact as its `artifact/created` + `artifact/status` pair, and a row still `running` (the turn died mid-execution — a handoff marker or a cancelled turn) records its `tool/call` alone so a relaunch replays the honest interrupted state. The rebuilt order (tool rows, then artifact pairs) replays to the same folded state because the fold aggregates the two families independently. The vocabulary stays the closed set — `tool/call`, `tool/result`, `artifact/created`, `artifact/status` are fold events already; the journal simply records them now, so no tag is added and the three-way fixture verification is untouched. Raw deltas stay out as before. Part B — feeding the replayed journal's tool rows into the request history across a relaunch — stays open: `seedJournal` still seeds only the rendering face and the export still reads the live fold, exactly as before.

## Alternatives considered

- Recording the events live through a new driver event callback: an event seam on the loop driver would carry the original ordering of artifact pairs beside their result rows, but the fold aggregates both families independently, so the rebuilt order replays identically — a new seam would add a face the write path does not need.
- Persisting the folded aggregate as a new journal row shape: the journal is an event stream the fold replays; a serialized aggregate would need its own replay path and a new vocabulary, against the closed-set rule.
- Deferring the whole item behind part B: the write face is the decision's substance — once the rows persist, B is a read-side change with its own risks (history export correctness), and the split-two was recorded precisely so the decision lands on its own evidence.

## Consequences

- Seven journal-sequence assertions flip in `LiteChatViewModelTest` (executed, denied, handoff, handoff-then-normal, two-turn history, and the replay-state emission): every turn that reached a tool call now carries its rows, and the replayed state after a relaunch carries the completed call row — the visible effect of the re-adjudication pinned. `:core:test` stays at 85 suites / 612 tests (no new test methods; the flipped assertions are the contract).
- The relaunch rendering face gains the tool rows for free: `seedJournal` replays the journal through the fold, and the fold already consumes these events — no `seedJournal` change in this part.
- The request history still rides the live fold only: a relaunched session shows its tool rows but does not yet feed them to the next request — part B's scope, unchanged by this note.
- The debug APK drifts (`5b996719 → 69e9f027`, the core main source set changed); the androidTest APK replays byte-identically at `e0d3214b` (zero androidTest input change).

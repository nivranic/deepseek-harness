# Agent Note: A relaunched session feeds its replayed tool rows into the next request — chapter 64's read face

Status: implemented

English | [中文](2026-10-24-resume-feed.zh.md)

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core` (`LiteLoop.kt`, `LiteChat.kt`), `apps/android/core` tests (`LiteChatViewModelTest.kt`)

## Problem

Part A made the journal carry the turn's tool rows, and a relaunch replayed them into the rendering face — but the request history still rode the live fold alone: the loop driver started every process empty, so a relaunched session showed its prior tool calls on screen while the next request carried no history at all. The model lost its own tool output across a restart even though the rows now survive on disk.

## Decision

Close the loop on the read face (part B): `LiteLoopDriver.seed(events)` replays a stored journal into the driver before any live turn — each event applies through the same fold, and every replayed `prompt/accepted` takes the same boundary snapshot `drive` takes (`turnRoundStarts` and `roundToolBoundaries`), so the exported request history reconstructs the replayed turns with their tool rows at the exact round boundaries. `LiteChatViewModel`'s construction seeds the driver from the stored session's events whenever the journal is non-empty; a running turn refuses a seed (`check(!running)`), and a cold open stays empty exactly as before. The seam is the driver itself: no new export path, no journal-shape change — the write face's events replay through the one fold and the one history exporter, so a relaunched session's next request carries the prior turns (their calculator calls and result texts included) verbatim.

## Alternatives considered

- Exporting history from the journal at request time, bypassing the fold: a second exporter over the same events would drift from the live one the moment either changes — one exporter over one fold is the invariant worth keeping.
- Seeding through a constructor parameter list: the seed is an ordered replay, not configuration; a `seed(events)` method named beside `submit`/`cancel` states the lifecycle (seed before any turn) better than a fourth constructor argument could.
- Replaying only the tool rows into the boundaries without the conversation events: the history exporter reads turns from the conversation rows — a partial seed would corrupt the round slicing it exists to serve.

## Consequences

- The new test pins the full closure: turn one executes a calculator call through the real evaluator (result `9`) and persists; the relaunched view model over the same store feeds its second request a history of exactly one prior turn whose single round carries the calculator call and its result text — the model sees its own tool output across the relaunch. `:core:test` grows to 85 suites / 613 tests (+1).
- The seed applies events through `onEventApplied`, so construction emits the replayed cuts into the live-state flow — the same states the replay already published, in the same order; collectors see no new shape.
- The debug APK drifts (`69e9f027 → ac58c38b`, the core main source set changed); the androidTest APK replays byte-identically at `e0d3214b`.

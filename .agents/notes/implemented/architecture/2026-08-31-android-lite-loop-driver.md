# Agent Note: The Android Lite Loop Driver

Status: implemented

English | [中文](2026-08-31-android-lite-loop-driver.zh.md)

## Problem

The Android embedded-runtime stage had its fold foundation and its tool registry but nothing that drove a turn: no seam a model provider could stream through, no dispatch path from streamed tool calls to the registry, and none of the terminal-event semantics — cancel, handoff, transport failure — that make the fold observable.

## Decision

`LiteLoop.kt` mirrors Apple's `LiteLoopDriver`. The `LiteProviding` seam streams one response per prompt as chunks (`Reasoning`/`Text`/`ToolCall`), with `ScriptedLiteProvider` as the prompt-matched double. The driver owns a Job in a passed scope: `submit` folds `prompt/accepted`, streams the chunks into the live fold (the `LiteFold` class gained an incremental `apply` surface beside the fixture-facing `foldLiteDomain`), dispatches each tool call through the registry — a handoff name folds `handoff/requested` and stops the turn at the marker without executing, an unknown name folds the call but never dispatches — then folds `message/completed` with the assembled text and `turn/completed`. Cancellation of the driver's own Job folds `turn/cancelled`, finalizing the delivered prefix; thrown failures split by vocabulary: `LiteTransportError.Network` folds `network/error` (the fold keeps the partial for resume), `Provider` folds `provider/error`, and anything else folds `PROVIDER_FAILED`.

Kotlin forced one deviation from the Swift mirror: only `Throwable` subtypes are catchable, so `LiteTransportError` is a sealed class over `RuntimeException` rather than a bare enum — the vocabulary and equality are unchanged.

## Consequences

`LiteLoopDriverTest` asserts every path through the folded `LiteDomainState`: the happy turn (reasoning + text chunks assemble into the assistant row, streaming resets, turn completes), registry dispatch (the executor receives the exact id/name/arguments and the call pairs to completed), handoff (`run_tests` executes nothing, `pendingHandoff` carries the marker, no turn end, the call stays running), unknown names (folded, never dispatched, turn still completes), cancellation (a stream parked mid-flow finalizes the partial as an interrupted row and `running` clears), and the three failure vocabularies with the network-drop retention versus provider-error clearing. The Android lane verified green. The next mirror steps remain persistence and the chat surface.

## Alternatives considered

Rebuilding the whole state per event through `foldLiteDomain` was rejected — an incremental `apply` on the same accumulator is what a live driver needs and what Swift already exposes. Throwing a bare string from the seam was rejected — the transport classification is part of the spec's observable vocabulary, and a typed sealed error keeps the fold's error rows pinned by data equality in tests.

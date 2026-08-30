# Agent Note: Lite loop driver skeleton

Status: implemented

English | [中文](2026-08-30-lite-loop-driver.zh.md)

## Problem

The Lite runtime had its Behavior-Spec fold and static tool registry but no driver: nothing submitted a prompt to a model seam, streamed the response, dispatched bundled tools, or emitted the terminal event — the loop that turns the vocabulary into a runtime.

## Decision

`LiteLoopDriver` (MainActor) drives one prompt through three seams: a `LiteProviding` actor (`stream(prompt:)` yielding `LiteStreamChunk`s — reasoning, text, tool call), a `LiteToolExecuting` closure the registry gates, and the existing `LiteFold`. Reasoning and text chunks fold as stream events; a tool call first consults `LiteToolRegistry`: a `fallbackCapability` emits `handoff/requested` and stops the loop without executing, an unknown name folds the call but never dispatches, and a bundled name executes and folds the result. The terminal events follow the spec exactly — `message/completed` with the accumulated text then `turn/completed`; cancellation folds `turn/cancelled` (the fold finalizes the delivered prefix); a thrown stream folds `provider/error`. `ScriptedLiteProvider` is the keyless mock: prompt-matched chunk scripts plus a submitted-prompt recorder.

## Consequences

The full chapter-63 chain — prompt, streaming, tool call, tool result, completion — now executes on-device as code, and the loop's tests assert the resulting `LiteDomainState` through the same models the conformance replay compares, so driver behavior is pinned against the spec's semantics rather than ad-hoc expectations. Handoff is honest: a full-runtime tool never executes locally, and a dynamic tool name never dispatches. Swift remains authored-not-compiled locally (standing macOS-lane caveat). The skeleton deliberately has no persistence, attachments, or real provider adapter — those land with the product increments that need them.

## Alternatives considered

Dispatching tools outside the registry was rejected — chapter 36's rule is that only app-bundled static tools execute, and the driver is where that rule bites. Continuing after a handoff was rejected — the marker means the full harness owns the work; folding past it would misstate state. A real HTTP provider now was rejected — the scripted seam keeps the loop keyless and testable; the adapter arrives with actual model routing.

# Agent Note: The Android Lite Chat Live Projection

Status: implemented

English | [中文](2026-08-31-android-lite-live-projection.zh.md)

## Problem

The chat surface rendered per persisted turn: while a turn streamed, the UI held the previous cut because only the journal's size drove re-reads. The deferral condition recorded with the chat surface — "until the provider feeds the UI in anger" — expired when the real HTTP provider landed.

## Decision

`LiteLoopDriver` gained a per-event projection callback: every lifecycle event it folds now surfaces the cut state to `onEventApplied` (one wrapper routes all of `drive`'s applications, so no event can bypass the projection). `LiteChatViewModel` feeds that callback into a `MutableStateFlow<LiteDomainState>` — the `liveState` the UI collects — and publishes the journal replay after each persisted turn; the old `state` property now reads the same flow's value, so the two views of the surface can never diverge. `LiteChatScreen` collects `liveState` with `collectAsStateWithLifecycle` and drops the journal-size reread entirely; stopped states pause collection instead of rendering stale cuts.

## Consequences

A Turbine test pins the emission sequence cut by cut over a scripted turn (initial empty journal; the user row; two growing partials; the tool row folding running then completing with the partial retained; the assistant row landing with the stream reset; the turn end moving; and finally the journal replay, which by the chapter-64 fidelity rule carries no tool rows). The Android lane verified green; the existing send/restore/handoff tests pass unchanged against the flow-backed property.

## Alternatives considered

Polling the fold from the UI was rejected — the fold is plain state with no observer, and polling re-introduces the staleness this increment removes. Projecting per chunk rather than per event was rejected — the event cut is the conformance-pinned unit; chunks are the provider's private vocabulary.

# Agent Note: Lite chat UI skeleton

Status: implemented

English | [中文](2026-08-30-lite-chat-ui-skeleton.zh.md)

## Problem

The Lite runtime had its loop, fold, stores, and provider seam but no surface: nothing a user could type into, watch stream, see tools run in, or be told a handoff happened on (chapter 35's "continue on <Host>" moment).

## Decision

`LiteChatViewModel` binds one on-device session to the loop: `send` drives `LiteLoopDriver`, then records the turn's fold-visible outcome events into the `LiteSession` journal and saves it through `LiteSessionStoring` when one is configured; `state` exposes the driver's live fold while a turn runs and the journal's replay otherwise. `LiteChatView` renders the Behavior-Spec state directly — conversation rows with the interrupted marker, the streaming partial, tool rows with phases, artifact references, and a handoff banner naming the capability that continued on the host. A real provider or the scripted one both plug in unchanged.

## Consequences

The on-device loop is now end-to-end: type, stream, tool dispatch, handoff, persist, relaunch-replay. The journal keeps turn outcomes (prompt, completed message, handoff or completion) rather than raw stream deltas — a deliberate skeleton simplification so replay stays cheap; delta-level journaling arrives when the product needs token-fidelity resume. Tests cover submit-and-persist with restore, and the handoff banner state. Swift remains authored-not-compiled locally (standing macOS-lane caveat).

## Alternatives considered

Journaling every stream delta was deferred — the fold finalizes prefixes already, and chapter 64 forbids premature fidelity. A separate handoff screen was rejected — one banner keeps the turn's context visible while naming where the work continued.

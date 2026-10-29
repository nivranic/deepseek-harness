# Agent Note: CompanionUI subagent surface

Status: implemented

English | [中文](2026-08-30-companion-subagent-surface.zh.md)

## Problem

Phase 2's module list names Subagent, and the host already owned the pieces: the `subagents` Remote namespace with `@Remote('list')` over the durable direct-child catalog, and `session/follow`'s subagent address (`{kind:'subagent', parentSessionId, childSessionId, mode}`). But the remote allowlist carried no subagent endpoint, the contract table had no catalog vocabulary, and the companion had no surface. Wiring the surface also forced a wire-shape correction: the session view model had been sending `session/prompt`, `session/cancel`, and `session/follow` with flat argument fields, while the host's session verbs all take one `request` object parameter — a latent mismatch FakeWire's non-validating fake had let pass.

## Decision

`subagents/list` joined the observer allowlist, and `dsh-link-contracts` models the catalog as a flat `LinkSubagentEntry` (the child and diagnostic rows share one struct: kind constant, id, activity, hasChildren, mode, optional label and reason) plus `LinkSubagentCatalog`, with fixtures pinned to the real `SubagentListEntry`/`SubagentCatalog` types. On the companion, `SubagentsViewModel` loads the open session's children and `SubagentsView` is the sixth tab (label, mode, running state, diagnostics); tapping a child opens its read-only timeline on the same follow stream through `RemoteSessionViewModel.openSubagent`, which sends the durable parent/child address and remembers it so a reconnect resubscribes by address. The session view model's wire shapes were corrected to the host's descriptors: `session/prompt` and `session/cancel` carry `{request: {…}}`, `session/follow` carries `{request: {address: {…}}}` with no cursor (the protocol replays a full snapshot on every subscription, and the domain-state fold already replaces its state from a snapshot), and FakeWire now records stream payloads so the address shapes are asserted.

## Consequences

The Phase 2 module list is complete on the companion (sessions, approvals/questions, plan/todo/goal, tools, files, subagents), and the session verbs' real wire shapes are now pinned by tests instead of assumptions. The desktop-composition e2e proves `subagents/list` answers through the shipped bridge (an unknown parent yields an empty catalog — a valid answer, not an error). Swift remains authored-not-compiled locally; decode correctness rides the contract fixtures. Subagent follow-ups (`subagents/prompt`, interrupt) stay unlisted on the allowlist — they are controller-level mutations for a later increment.

## Alternatives considered

Flattening the catalog into two arrays (children and diagnostics) was rejected — the wire carries one ordered entries array and the flat entry struct preserves it. A dedicated child-timeline view model was rejected: the follow fold is session-agnostic, so reusing `RemoteSessionViewModel` with an address parameter costs nothing and keeps one fold. Adding `subagents/prompt` to the allowlist now was rejected — the Phase 2 surface is observational; mutation verbs should land with their own policy review.

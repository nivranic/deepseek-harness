# Agent Note: CompanionUI tool trajectory

Status: implemented

English | [中文](2026-08-30-companion-tool-trajectory.zh.md)

## Problem

Phase 2's module list (plan chapter 50) names Tools as a primary companion module, and the session-event vocabulary increment had just landed the decoded `tool/call`/`tool/result` payloads — but the timeline only rendered one-line summaries per event, with no paired view of what the model invoked, what it sent, and what came back.

## Decision

`RemoteSessionViewModel` now folds a tool trajectory from the same follow records as the timeline and the pane state: a `tool/call` appends a running `ToolCallRecord` keyed by the wire `callId` (name, raw arguments JSON, opening seq fixing order), and a `tool/result` closes the record matched by the result block's `toolCallId` — completed or failed by the presence of the failure identity, carrying the nested result text. An unmatched result is a tolerated no-op, and reopening a session resets the trajectory alongside the pane state. `ToolsView` renders the trajectory as the fourth tab (name and phase headline, monospaced arguments, result text, failure in red), reading the `@Observable` model directly so records close live as results arrive. No wire surface changed: everything decodes through the generated `LinkToolCallData`/`LinkToolResultData` models the fixture drift gate already pins.

## Consequences

The companion shows the execution story the plan's Trajectory module asks for with zero new contract surface, and the view-model tests cover the pairing (success, failure, orphan result, reset on reopen) over real envelope shapes. Swift remains authored-not-compiled on this host (the standing macOS-lane caveat); the assertions ride the fixture bytes the drift gate proves identical to the TypeScript pins.

## Alternatives considered

Deriving the trajectory from the timeline items (string summaries) was rejected — the paired record needs the structured payloads, and re-decoding them per render would duplicate the fold. A separate trajectory view model was rejected: the records arrive on the same follow stream the session model already owns, so a second subscriber would double the wire traffic for the same events.

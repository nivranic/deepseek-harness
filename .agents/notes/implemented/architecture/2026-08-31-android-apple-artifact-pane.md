# Agent Note: The Read-Only Artifacts Pane on Android and Apple

Status: implemented

English | [中文](2026-08-31-android-apple-artifact-pane.zh.md)

## Problem

Chapter 56 makes artifacts first-class objects — the journal carries references, metadata, and status, while content rides a resource channel — but both companion apps could only show artifacts as opaque tool-call rows. No pane collected them, and the folded domain state had no artifacts field to collect them into.

## Decision

The artifacts pane rides the chapter-62 domain-state fold itself, symmetrically in all three runtimes: the TypeScript reference fold, the Swift `CompanionSessionFold`, and the Kotlin `DomainFold` each gain an `artifacts` list consuming the repo's existing artifact event vocabulary — the Lite spec's `artifact/created` (`id`/`kind`/`title`, folded to status `pending`) and `artifact/status` (last-write-wins by id; an orphan status is a no-op; a repeated created pushes again, mirroring the Lite fold). A malformed payload — non-object data, a non-string id, an unknown status value — is an absent referent and skips. Timeline rows render `新建工件 title（kind）` and `工件 id：待定/就绪/失败` identically in every language. No golden scenario fabricates the events: the scenario builder is typed to real `SessionEventMap` members and no host event exists yet, so every fixture honestly pins an empty pane until the host journals artifacts — the regenerated conformance fixtures carry `artifacts: []` in all three languages.

Both surfaces present the pane read-only as a seventh tab between files and subagents: Compose `ArtifactsTab` (title, status word colored by state, kind) and SwiftUI `ArtifactsView` (same rows over `RemoteSessionViewModel.artifacts`), matching the plan's companion pane list.

## Consequences

The trilingual same-fixture-same-state guarantee now covers the pane's shape, not just its emptiness: TypeScript unit tests pin the full fold semantics (status transitions, orphan tolerance, malformed skipping, repeat-created push, empty start), and FakeWire-driven tests on both native sides fold the same event sequence through the real session view models and assert the same three-entry list. Both lanes verified green; the fixture regeneration touched every conformance JSON in all three locations. Reading artifact content over the resource channel stays deferred with the host-side event vocabulary.

## Alternatives considered

Fabricating a golden scenario with artifact records was rejected — the builder's `keyof SessionEventMap` bound is what keeps fixtures honest, and inventing host events to pin strings would lie about the wire. Projecting artifacts from tool-call arguments like the diff viewer was rejected — no model-facing artifact tool exists, so the projection would never fire; the fold consumes the vocabulary the repo has actually pinned, and stays honestly empty until the host speaks it.

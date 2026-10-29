# Agent Note: Cross-language domain-state conformance

Status: implemented

English | [中文](2026-08-30-domain-state-conformance.zh.md)

## Problem

Plan chapter 62 requires the golden fixtures to prove more than decoding: the same records must fold to the same domain state in TypeScript, Swift, and Kotlin. The link-contract table pinned wire types and the CompanionUI fold rendered them, but nothing tied the Swift fold's behavior to a TypeScript reference — the two could drift silently in summaries, pane state, or trajectory pairing, and the Swift tests only replayed hand-built frames.

## Decision

`dsh-link-contracts` gained the reference fold and its scenarios. `foldCompanionDomain` is a pure TypeScript projection of follow records into the companion domain state — timeline rows with the per-tag Chinese summaries, plan-mode boolean, whole-list todos, the current goal (empty after a clear tombstone), and the callId-paired tool trajectory with orphan tolerance — reading each known tag's payload through the real `SessionEventMap` members. Three golden scenarios (`basic-turn`, `plan-todo-goal`, `tool-trajectory`) are record sequences built from the real payload types; `generateConformanceArtifacts` pairs each with the state the reference fold derives, and the gen/verify pipeline emits `generated/conformance/<id>.json` plus synced copies for both Apple test bundles under the same byte-for-byte drift gate. On the Swift side the fold moved out of `RemoteSessionViewModel` into a pure `CompanionSessionFold` owning a `CompanionDomainState` (Codable, JSON-keyed to the TypeScript shape); the view model delegates every snapshot/live frame to it and projects the pane and trajectory views from its state. `CompanionUITests` gained a conformance case that decodes each synced scenario, folds its records, and asserts equality with the fixture's expected state — the chapter-62 check, runnable the moment a macOS lane exists.

## Consequences

A rendering change (summary string, pairing rule, last-write-wins semantics) now fails twice: the TypeScript unit suite asserts the behavioral invariants over the scenarios, and the drift gate fails until the expected states regenerate — then the Swift replay must match the new bytes. The fold's language coupling is deliberate: identical Chinese strings live in both implementations, and the fixtures are what keeps them identical. The view model shrank to wire orchestration plus projections; `ToolCallRecord` folded into `CompanionDomainState.ToolCall` and the trajectory view reads it directly. Swift remains authored-not-compiled on this host (standing macOS-lane caveat); the conformance assertions ride fixture bytes the drift gate proves identical to the TypeScript result.

## Alternatives considered

Emitting the fold itself as generated Swift was rejected — the generator emits data contracts, and the fold is behavior the native side owns under conformance, not code to transpile. Comparing domain states structurally per language (each test asserting its own expected literals) was rejected — that is exactly the silent drift the shared fixture exists to prevent. Keeping the fold private to the view model was rejected — a MainActor, wire-coupled fold cannot replay fixture bytes in a test without a fake stream, and the pure split is what makes the conformance case a plain decode-fold-compare.

# Agent Note: Swift Lite runtime skeleton

Status: implemented

English | [中文](2026-08-30-swift-lite-skeleton.zh.md)

## Problem

The Lite Behavior Spec existed only as TypeScript reference code and fixture bytes; Phase 3 needed its native half — a Swift module that decodes the spec's events, folds them with the reference semantics, and replays the golden scenarios — plus the chapter-36 static tool registry that bounds what an app-bundled Lite runtime may dispatch.

## Decision

A third SwiftPM library target, `LiteRuntime` (iOS 17+/macOS 14+), owns the spec's Swift face. `LiteEvent` is a decoded tagged union over the seventeen fixture event shapes; `LiteFold` mirrors `foldLiteDomain` exactly — cancel finalizes the delivered stream prefix as an interrupted assistant row, a network drop keeps the partial, a provider error clears streaming and sets the terminal outcome — with a `LiteDomainState` JSON-keyed to the TypeScript emission. `LiteToolRegistry` carries the chapter-36 bundled set (web_search, url_fetch, image_inspect, attachment_read, artifact_create, calculator) plus a `run_tests` descriptor whose `fallbackCapability` is `requiresFullRuntime`: arbitrary execution hands off to the full harness rather than executing on-device, and unknown names resolve to nil, never to a dynamic dispatch. The gen/verify pipeline now syncs the lite-conformance fixtures into `Tests/LiteRuntimeTests/Fixtures` (replacing the earlier SharedAppleRemoteCore copies), and the conformance test decodes each scenario, folds its events, asserts equality with the expected state, and checks that all eleven chapter-63 points are covered.

## Consequences

The chapter-63 loop is closed on the native side: the same fixture bytes drive the TypeScript reference (drift-gated) and the Swift fold (decode-fold-compare), so any semantic divergence fails a gate or a replay. Swift remains authored-not-compiled on this host (standing macOS-lane caveat). The registry is deliberately vocabulary-only — no executor, provider adapter, or loop driver yet; those are Phase 3's next increments and will consume this fold and registry directly.

## Alternatives considered

Generating the event models from the contract table was rejected — the table models structs and enums, while the spec's events are a tagged union with per-variant payloads; hand-decoding keeps the discriminator explicit. Folding through the companion's `CompanionSessionFold` was rejected — Lite is its own runtime vocabulary (chapter 33), and coupling the two folds would make the spec hostage to remote-surface changes. An executor stub in the registry was rejected — a tool that pretends to run is worse than a name that honestly resolves to nil.

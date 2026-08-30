# Agent Note: Reading Artifact Content Through the Resource Channel

Status: implemented

English | [中文](2026-08-31-lite-artifact-content-reading.zh.md)

## Problem

Chapter 56 kept artifact content out of events by design — references and status ride the journal, bytes live in the resource channel — and both Lite runtimes had the channel (`LiteFileArtifactStore`) but no consumption face: nothing read the bytes back, so every artifact stayed a name in a list.

## Decision

Both runtimes gained the same read-and-present function over their existing channel: `readLiteArtifact(store, reference)` fetches the bytes by id and decides the presentation — the textual kinds (markdown, text, report, patch) decode and render their content directly, every other kind renders its type and byte size only, and a missing id reads as absent, the honest empty state (as does having no channel at all). The chat view models take the artifact store as an optional injection beside the journal store and expose `readArtifact`; the surfaces render per-reference rows — Compose's artifact rows gained an on-demand 内容 toggle that reads on first open, SwiftUI's rows read on appear behind a disclosure — showing the text, the `kind 类型 · N 字节` line, or 内容缺失.

## Consequences

Tests on both sides pin the same behaviors against real temp-directory stores: textual kinds round-trip to their exact text (markdown and patch), binary kinds show kind and size (image with 1234 bytes, file with the encoded size), a missing id reads as null, and the chat surface reads through its injected channel — returning content with one, null without. Both lanes verified green. The remote companion's artifacts pane stays reference-only by design: the host journals no artifact events yet, so its channel consumption arrives with them.

## Alternatives considered

Inlining content into the fold was rejected — that is exactly what chapter 56 forbids; the fold stays metadata-only and the channel owns bytes. Rendering binary bytes (for example images) was deferred — no artifact kind on the wire today carries image bytes the surfaces could decode; the type-and-size line is the honest first version.

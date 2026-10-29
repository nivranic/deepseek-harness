# Agent Note: Paged Artifact Reads

Status: implemented

English | [中文](2026-08-31-artifact-paged-reads.zh.md)

## Problem

Both artifact read faces round-tripped the whole content on every call: a model re-reading a large artifact paid its full size into the conversation each time, and a paired companion fetched every byte to show a prefix. The workspace-file face already solved this shape with UTF-16 ranges.

## Decision

The artifact read vocabulary adopts the workspace-file paging terms verbatim: optional `offset` (range start in UTF-16 code units, default 0) and `limit` (maximum returned units, absent reads through the end), with the response reporting `truncated` (whether `limit` cut before the end) and `size` (total units). `artifact_read` gains the two optional integer parameters and the two result fields; `session/artifact` grows the same request fields and returns the page's base64. Negative ranges fail loud (`ARTIFACT_BAD_RANGE` on the wire; a stable tool error in-session). The contract row and golden fixture grow `truncated`/`size`, regenerated into the Swift and Kotlin models; both native `readArtifact` consumers pass the optional range through, and only an unbounded read still fills the byte cache — a paged read returns its range without caching, because the pane that assembles pages does not exist yet and a half-artifact in the full-content cache would lie.

## Consequences

A large artifact is now payable in slices on every face; the default full read remains byte-identical with the previous behavior. Remaining on this face: binary artifact input, and a retention policy for stored bytes.

## Alternatives considered

Byte-based ranges were rejected — artifact content is model-authored text and every consumer (model context, companion decode) works in code units; the workspace-file face already standardized UTF-16 units and symmetry wins. Caching pages keyed by offset was rejected — a page cache is pane policy, not transport policy; caching nothing until a consumer assembles ranges keeps the model honest.

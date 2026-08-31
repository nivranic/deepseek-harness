# Agent Note: Binary Artifact Input

Status: implemented

English | [中文](2026-08-31-artifact-binary-input.zh.md)

## Problem

Artifacts were textual end to end: `artifact_create` took a required `content` string, the channel stored its UTF-8 bytes, and every reader decoded the bytes back to text. A model that generated an image, a spreadsheet, or any other byte payload had no way to hand it to the user as a first-class artifact — the previous note left exactly this hole open.

## Decision

The authoring format becomes journaled truth. `artifact/created` grows a required `format: 'text' | 'bytes'` — a durable discriminant every later reader (model tool, wire endpoint, native consumer) trusts instead of guessing. `artifact_create` takes `content` (text) XOR `data` (base64 bytes); the schema cannot express the XOR, so execute fails loud with a stable message on both-set and neither-set. Base64 decoding is strict: ASCII whitespace is tolerated (models line-wrap long encodings), any other non-canonical input is rejected rather than silently truncated by Node's lenient decoder. `artifact_read` answers in the journaled arm — text pages by UTF-16 code unit into `content`, bytes page by byte into base64 `data` — and an id the calling session never journaled falls to the base64 arm, because without the journal row the authoring format is unknowable and base64 is the lossless rendering. The wire `session/artifact` endpoint pages by the journaled format the same way and returns `format` in `SessionArtifactValue`, so `LinkArtifactReadValue` grows the field (regenerated into Swift and Kotlin with a `LinkArtifactFormat` enum), and both native `readArtifact` consumers decode and surface it. The invariant adds the closed format set.

## Consequences

Binary payloads are now first-class: a generated PNG or PDF travels through the same journal-reference plus resource-channel split as text, one tool call either way. Base64 inflates model-facing bytes by a third on both the create arguments and bytes-arm reads — paging keeps that cost sliceable. The companion artifact fold deliberately stays format-free (it renders id and status only); a pane that renders bytes differently from text can take the field from the read value when it exists. Remaining on this face: a retention policy for stored bytes.

## Alternatives considered

A separate `artifact_create_binary` tool was rejected — two producer names double the schema surface and the journal would still need a discriminant to route readers; one tool with a checked XOR arm is smaller. Recording format only on the read response (deriving it from decodability) was rejected — decodability is a heuristic that mislabels valid UTF-8 binaries, and the journal is the authoritative event stream this repo trusts. Accepting Node's lenient base64 decoder was rejected — a model typo would silently truncate bytes and the artifact would render broken with no failure to point at.

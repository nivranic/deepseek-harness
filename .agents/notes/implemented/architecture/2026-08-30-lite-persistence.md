# Agent Note: Lite session persistence and artifact store

Status: implemented

English | [中文](2026-08-30-lite-persistence.zh.md)

## Problem

The Lite runtime could drive turns and fold state but forgot everything: no durable session journal to resume from (plan chapters 11/15 — journal and recovery are the state spine) and no artifact content channel, though the Behavior Spec already carried artifact references and status (chapter 56's rule: events carry references, content rides a separate channel).

## Decision

`LiteSession` is an event-sourced journal: an id plus the ordered `LiteEvent`s, replayed through `LiteFold` to derive state — the same fold the conformance fixtures pin, so persistence cannot drift from spec semantics. `LiteEvent` and its support types gained `Encodable` (decode existed), and `LiteFileSessionStore` persists one append-only JSON-lines file per session (`<id>.litejournal`, one encoded event per line, atomic replace on save); loading decodes line by line and returns the replayable session. `LiteFileArtifactStore` is the resource channel: one content file per artifact id (`<id>.artifact`), atomic writes, read and remove. Both are actors behind protocols so tests and future backends substitute freely.

## Consequences

A Lite session now survives restart by replay — save after each turn, load and fold on open — with zero projection storage to keep consistent, and artifact content stays out of the event stream by construction. The store tests cover journal round-trip with replay equivalence, deletion, and artifact content round-trip. Swift remains authored-not-compiled locally (standing macOS-lane caveat). Deliberately absent: snapshot compaction (journals grow with deltas; chapter 64 forbids premature optimization), attachment intake, and host upload/download endpoints — those land with the product surfaces that need them.

## Alternatives considered

Persisting folded state snapshots was rejected — a second representation to keep consistent; the journal plus a deterministic fold is the recovery model the plan names. SQLite was rejected for the skeleton — the file journal is human-readable, trivially atomic, and the protocol seam allows a database later without touching callers. Storing artifact bytes inside events was rejected outright — chapter 56's explicit rule.

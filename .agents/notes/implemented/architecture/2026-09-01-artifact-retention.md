# Agent Note: Artifact Byte Retention

Status: implemented

English | [中文](2026-09-01-artifact-retention.zh.md)

## Problem

Stored artifact bytes lived forever: `DSH_HOME/artifacts` grew without bound, and the artifact README carried that as a known limitation. Sessions are never deleted in this product (the persistence seam has no delete face; `session/disposed` is an observe-only in-memory event), so no reference-loss trigger exists to hang garbage collection on.

## Decision

Retention is an opt-in age window on the local backend. `LocalArtifactStore` gains a `retentionDays` config field — a positive whole number of days a stored artifact may age, validated at plugin load (bad values fail loud); omitted keeps every artifact forever, matching the "a first-class output file the user keeps" contract. When configured, the constructor registers one sweep at boot and then daily: `sweep(retentionDays)` walks `artifacts/`, stats each `<id>.artifact` file, deletes the ones whose bytes aged past the window, and returns the removed ids. Age is time since the bytes were written — reads never refresh it — and the sweep is best-effort per file, logging and skipping unreadable entries. A journal reference outliving its swept bytes is not a new failure mode: `ARTIFACT_CONTENT_MISSING` on the wire and `artifact_read`'s loud not-stored error already model it.

The `ArtifactStore` seam stays put/get/remove — retention is provider policy over files the local backend owns, and memory or remote backends may never want it. Reference-aware collection (delete only what no session log cites) was consciously not built: with no session deletion it would collect nothing, and it would not stop the unbounded growth the limitation names.

## Consequences

Deployments can bound artifact disk usage with one cordis.yml line; the default composition is byte-for-byte unchanged. The sweep cadence (boot plus daily, unref'd timer) is fixed — only the window is configurable. Age-based deletion can remove an artifact a long-lived session still references; that read fails loud by design, and the artifact's journal rows (kind, title, format, status) survive the bytes. Remaining adjacent deferral: content-addressed deduplication (identical bytes still store twice).

## Alternatives considered

Default-on retention was rejected — silently deleting user files after N days contradicts the artifact contract; off-by-default keeps the shipped behavior identical. Referencing-aware sweeping was rejected as vacuous today (no session deletion collects references) and ineffective against growth. Refreshing age on read (access-based eviction) was rejected — artifacts are kept files, not a cache, and mtime-refreshing inside `get` would make retention behavior depend on read patterns the journal cannot explain.

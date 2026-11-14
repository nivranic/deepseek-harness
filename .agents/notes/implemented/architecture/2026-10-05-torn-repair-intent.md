# Agent Note: A crash-durable repair intent closes the torn-tail rewrite window

Status: implemented

English | [中文](2026-10-05-torn-repair-intent.zh.md)

## Problem

A torn final Zstandard frame in a JSONL session log carries complete decoded records that cannot be kept physically: the frame's bytes are structurally incomplete, so the write path must truncate the whole frame and durably rewrite the recovered records before its first new batch. That repair was a two-step sequence — truncate (fsynced), then rewrite (fsynced) — with a crash window between them: a crash after the truncation committed removed the only physical trace of the recovered records, and the next open found a clean, shorter log with nothing to recover, silently dropping events that a prior run had already served to readers. The raw (uncompressed) path has no such window because its truncation point is the last complete line boundary and holds nothing recoverable. This was recorded as the remaining §46 truncation-window item after the crash-durability generation landed.

## Decision

An immutable repair intent beside the log preserves recovered records before destructive truncation. The JSONL backend writes and fsyncs an owner-only temporary file, then publishes `<log>.repair-intent` without replacement using its existing POSIX link/directory-sync or Windows write-through primitive. The generic atomic-write helper supplies no crash-durability guarantee and does not own this operation. A retry reuses a matching intent, including one retained by an older writer; records are durably rewritten before intent removal and before a new batch is accepted.

Reads reconcile both complete primary records and any recoverable torn-frame prefix with the intent. Overlapping records must agree, sequence gaps reject, and the owning format codec validates the merged records. The intent retains records missing from a second torn rewrite; it is never replaced with that shorter recovered prefix. Read caches, metadata revisions, and historical child-catalog witnesses include the recovery file's identity. A read open overlapping repair retries once against coherent files; an established handle reports the source change. Ordinary append-only churn retains its bounded-prefix behavior.

Recovery documents retain version one and follow the physical log's generation suffix. Historical V3 intents are reconciled through the released V3 codec before adjacent migration consumes the records. Publication rechecks both source identities and retains both historical files. Current V4 child recovery also contributes to a historical parent's catalog preparation; a changed child intent invalidates that preparation.

## Alternatives considered

Rewriting the whole log as one atomic generation replacement would also close the window but rewrites unbounded prefixes on every repair; the sidecar intent repairs in place at O(recovered) write cost. Truncating to the last complete record inside the torn frame is impossible by construction: the frame is one compressed unit and its interior byte boundaries do not exist on disk. Accepting the window and documenting it was the status quo this note replaces — §46 forbids silent drops.

## Consequences

Failure before recovered records become durable leaves the intent available to a fresh backend. Failure during intent removal prevents the new batch but does not duplicate already rewritten records on retry. Read-only recovery leaves both files unchanged. A session that never mutates again keeps its idempotent recovery record. The remaining §46 decisions about derived SQLite index resets and version-mismatch refusal are independent of this repair.

The [SDK resume snapshot](../../../../snapshots/sdk/sdk.snapshot.ts) runs the shipped profile in two processes. Its Zstandard recovery variant resumes with the first turn's completed tail held only in an intent, checks that the durable prefix survives and the intent is removed, and compares the continued transcript and SDK output with the ordinary resume recording.

## Open follow-ups

session-query-sqlite's derived-index reset and storage-sqlite's version-mismatch refusal remain the recorded §46 opens; neither loses a sole copy today, but their adjacent-generation conformance is still undecided.

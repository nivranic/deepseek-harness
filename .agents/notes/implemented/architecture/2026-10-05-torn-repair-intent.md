# Agent Note: A crash-durable repair intent closes the torn-tail rewrite window

Status: implemented

English | [中文](2026-10-05-torn-repair-intent.zh.md)

## Problem

A torn final Zstandard frame in a JSONL session log carries complete decoded records that cannot be kept physically: the frame's bytes are structurally incomplete, so the write path must truncate the whole frame and durably rewrite the recovered records before its first new batch. That repair was a two-step sequence — truncate (fsynced), then rewrite (fsynced) — with a crash window between them: a crash after the truncation committed removed the only physical trace of the recovered records, and the next open found a clean, shorter log with nothing to recover, silently dropping events that a prior run had already served to readers. The raw (uncompressed) path has no such window because its truncation point is the last complete line boundary and holds nothing recoverable. This was recorded as the remaining §46 truncation-window item after the crash-durability generation landed.

## Decision

Close the window with a two-phase repair intent beside the log. When a write handle consumes a torn tail whose recovery is non-empty, `truncateTornTail` first records the recovered events in `<log>.repair-intent` through `dsh-atomic-write`'s `writeFileAtomic` (fresh owner-only inode, fsynced file and POSIX directory) and only then truncates; the handle's mutation sequence rewrites the recovered records durably and discards the intent afterwards (unlink + directory fsync on POSIX). On open, the zstd decode reconciles the physical log with any surviving intent: a torn frame still on disk stays authoritative (the intent is the same run's duplicate record), while a clean log takes the intent's records that the log does not already contain — compared by seq, so a rewrite that itself crashed partway re-appends only the missing tail — and a mismatched session id in an intent rejects as corruption. `fsyncDirectory` is now exported from `dsh-atomic-write` for the discard step. The intent name rides the log path suffix, so generation discovery, the stable-read loop, and the revision-keyed memo (invalidated on every truncate/discard, and guarded cross-process by the log-revision probe) never observe it as session state.

## Alternatives considered

Rewriting the whole log as one atomic generation replacement would also close the window but rewrites unbounded prefixes on every repair; the sidecar intent repairs in place at O(recovered) cost. Truncating to the last complete record inside the torn frame is impossible by construction: the frame is one compressed unit and its interior byte boundaries do not exist on disk. Accepting the window and documenting it was the status quo this note replaces — §46 forbids silent drops.

## Consequences

Every crash point in the repair sequence now converges: after intent-write, after truncate, after rewrite, after discard, the next open recovers the same complete event set (six layout tests pin this, including the duplicate-intent, stale-intent, partial-rewrite, and foreign-id rejection cases). Reads during the window observe the recovered records via the intent, matching what the previous run served. A session that never mutates again keeps a harmless idempotent intent file beside its log. The remaining §46 open items (session-query-sqlite's in-place derived-table reset and storage-sqlite's refuse-on-version-mismatch) are unchanged and still await their own ruling.

## Open follow-ups

session-query-sqlite's derived-index reset and storage-sqlite's version-mismatch refusal remain the recorded §46 opens; neither loses a sole copy today, but their adjacent-generation conformance is still undecided.

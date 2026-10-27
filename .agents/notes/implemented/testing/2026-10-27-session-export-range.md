# Agent Note: Deterministic session-export archives answer HTTP range resumes

Status: implemented

English | [中文](2026-10-27-session-export-range.zh.md)

## Problem

`GET /api/session.export` streamed each request as a fresh ZIP whose fflate entries carried `Date.now()` DOS timestamps: two exports of one session differed byte-for-byte, the route advertised no `Accept-Ranges`, answered no `Range`, and reported no length, so an interrupted browser download restarted from zero and any future resume would splice mismatched halves into a corrupt archive. §35's edge matrix had pinned the workspace read side (fixed-window transfer engine in the document preview, `readBytes` byte window) while the store-side read path through the export endpoint stayed unserved.

## Decision

Two layers. `archive.ts` exports `SESSION_LOG_ZIP_MTIME` (2000-01-01T00:00:00Z, inside the DOS date domain) and stamps every entry after construction — fflate 0.8.3's `ZipDeflate` ignores an mtime in its options (`f.mtime==null?Date.now():f.mtime` runs on the object handed to `add`), so determinism requires assigning `entry.mtime` between construction and `archive.add`, a recipe verified byte-identical across a 1.3-second gap before landing. The route advertises `Accept-Ranges: bytes` on every success; a plain GET keeps today's single-generation streaming with no `Content-Length`; a `HEAD` measures one generation and reports its exact `Content-Length` with a null body; a GET with one well-formed `bytes=N-`/`bytes=N-M` range measures once, then answers `206` with a sliced second generation — clamping a past-end last byte to `L-1`, answering `416` with `bytes */L` when the start is at or past the end, and ignoring suffix ranges, multi-ranges, other units, and reversed ends per HTTP (served as a plain 200). Parsing and slicing are pure helpers (`parseRangeRequest`, `sliceByteRange`); `HEAD` ignores `Range` because HTTP requires ignoring it for any method other than GET.

## Alternatives considered

Buffering the whole archive to serve exact lengths in one pass was rejected — it breaks the bounded-memory streaming invariant (the host holds at most one descendant log, one image, and one file chunk beyond the root). Measuring on every request was rejected after it broke the route's existing behavioral suite in review: hanging-fixture cancellation tests driven through `downloads.sessionLog` deadlocked inside the measuring pass (the Response never materializes while a descendant read hangs), flush and attachment-read effects doubled, and mid-stream failures moved from a rejecting 200 body to an early 500 — measuring only range and HEAD requests confines the second generation to resume traffic. Shipping chunked 200 responses without `Accept-Ranges` was rejected because resume was the ledger item itself.

## Consequences

An interrupted export download can continue from the bytes it already holds, and the served halves always come from byte-identical generations, so a splice cannot mismatch. Only resume requests and `HEAD` pay a second generation; ordinary downloads stream exactly as before, and the ten existing route-behavior tests (flush ordering, pull-capacity pacing, reader-cancel abort propagation, mid-stream failure surfacing, read-effect counts) keep their semantics unchanged. The route spec pins the new surface instead: determinism (two exports byte-equal, DOS date/time fields equal the fixed timestamp through fflate's own local-time encoding), 206 slices (`bytes=5-`, `bytes=0-`, `bytes=0-9` spliced with `bytes=10-` back into the whole archive, past-end clamp, deep-skip tail), `416` with `bytes */L`, the ignored forms, `HEAD` length, and a range request's mid-generation 500. §35's partial-download/range edge now has both sides pinned — the workspace windows and the export route. The browser dialog still hands the URL to the download manager and does not orchestrate range resumes itself; that stays as today's behavior.

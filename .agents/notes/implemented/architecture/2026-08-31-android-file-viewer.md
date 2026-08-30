# Agent Note: The Android file viewer with paged reads

Status: implemented

English | [中文](2026-08-31-android-file-viewer.zh.md)

## Problem

The files tab could list a workspace tree but not open anything: `workspaceFiles/read` had no Kotlin consumer, and the Swift viewer's paging semantics — a `file-too-large` refusal means "give me a bounded page", pages count UTF-16 units — existed only on Apple.

## Decision

`FilesModel` grows the read surface: `readFile` asks unbounded first, catches a `file-too-large` refusal, and retries from offset 0 with one 65536-unit page; `loadMore` fetches the next page after the loaded prefix and appends. Kotlin's `String.length` counts UTF-16 code units — exactly the wire's unit — so offsets and limits count what the host counts with no conversion. `OpenTextFile` carries path, media type, text, loaded/total units, and `hasMore` as StateFlows; refusals map to their Chinese reasons (binary, not-found, outside-root, not-regular). The files tab renders a viewer card under the breadcrumb row with 查看 on every non-directory entry, 关闭 to dismiss, and 加载更多 while pages remain.

## Consequences

The lane is green with the paging sequence pinned by FakeWire tests — refusal, page one (65536 units, truncated), page two appending the tail — asserting the exact offset/limit arguments at each hop, plus the binary-refusal message. FakeWire gained per-method sequential answers, the double the paging case needed. The viewer is text-only by design; Diff and artifact viewers are the follow-on polish the plan schedules.

## Alternatives considered

Always paging from the first read was rejected — the unbounded read serves small files in one round trip, and the retry mirrors the host's contract exactly. Counting grapheme clusters was rejected before it started — the wire speaks UTF-16, and the Swift side already learned that lesson on this same seam.

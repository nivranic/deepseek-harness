---
kind: upgrade-guide
description: "Native Session follow requests use complete opening snapshots instead of a wire resume cursor."
---

# Native follow requests use complete openings

English | [中文](guide.zh.md)

## Change

`session/follow` accepts the Session address and optional window options, without `fromSeq`. Every new stream starts with a complete bounded snapshot. Kotlin and Swift `NativeFollowResume.request` now accept only the address and page size; `withResumeCursor` is removed.

The Android journal keeps its last sequence locally to validate overlap with retained records. Matching overlap preserves older loaded history; a gap replaces the window with the authoritative opening. Contradictions fail visibly without publishing a partial merge. Encrypted history remains readable across this change.

## Migration

1. Remove `fromSeq` from follow requests and remove the cursor argument from `NativeFollowResume.request` calls. Retain the cursor together with its records only for local reconciliation.
2. Accept complete opening snapshots on every reconnect. Compare overlapping records before retaining an older prefix; replace uncovered history and stop on contradictions.
3. Use `one-shot`, `continuable`, or `unknown` for a subagent address's `mode`. `timeline` is not an accepted mode.
4. Run the shared Kotlin/Swift request fixtures and the Host native-follow contract scenario. Validate process-restart and carrier-loss scenarios on an authorized installation before claiming device acceptance.

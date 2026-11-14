# Agent Note: Manual saved-Host reordering on the section 28 roster

Status: implemented

English | [中文](2026-10-02-hosts-roster-reorder.zh.md)

## Problem

The §28 saved-Host roster sorted strictly most-recent-first with no client arrangement. A roster is a pinboard, not a log: the Host a user reaches for first is not always the one connected most recently. The rename note left manual reordering as deferred work ("conflicts with the most-recent-first invariant").

## Decision

- `SavedHost` gains an optional `order`: a client-chosen position that overrides recency until moved away, surviving reconnects exactly like `customName`. `sortRows` orders by `order` first (`order ?? +Infinity`), recency descending within and after the ordered block.
- `SavedHostsStore.moveHost(hostId, direction)` swaps the row with its neighbor, then stamps an explicit `order` on every row of the presented list — one move puts the whole roster into manual mode, so the arrangement is total and stable instead of partially ordered. Boundary and unknown moves change nothing, notify nobody, and return `false`.
- `record()` keeps `order` exactly like `customName`: descriptor facts refresh from the new generation while the row keeps its manual position; a never-moved newcomer lands after the ordered block by recency. `rename()` carries `order` across its in-place rewrite.
- `parseRow` validates `order` as a finite number when present, so pre-reorder persisted rows parse unchanged and a corrupt value drops with its row.
- `ConnectionHandle.moveSavedHost(hostId, direction)` mirrors `renameSavedHost`: a roster seam with no connection effect. Each row gains Move up / Move down actions (`data-host-move-up` / `data-host-move-down`), disabled at the first/last position; the section passes `first`/`last` from the map index.
- Proof: the unit suites cover store semantics (adjacent swap with full stamping, persistence across store lifetimes, boundary/unknown silence, arrangement surviving refreshes/renames/unordered arrivals, parse admission), section presentation (boundary buttons disabled, click reorders through the injected action, rerender from the published roster), and plugin wiring into the persisted roster. `hosts-settings.e2e.ts` extends the real-browser lane: Move up puts the external Host ahead with boundary buttons disabled and `"order"` stamps in `dsh-saved-hosts.v1`; Move down restores the recency order; the golden gains the Reorder line.

## Alternatives considered

- **Drag-and-drop:** pointer-only, heavier to make keyboard- and switch-accessible, and more than the section needs; adjacent moves compose into any arrangement.
- **Stamping only the swapped pair:** leaves the roster partially ordered, so later interleavings with recency-sorted rows are ambiguous; one move explicitizes the whole list, matching the all-rows-observable store.
- **Moving a row to the front on reconnect (record):** would silently destroy the arrangement; `record` preserves `order` for the same reason it preserves `customName`.

## Consequences

- The first manual move fixes the position of every row; rows added afterwards sort after the block by recency until the next move re-stamps.
- The cordis inspect catalog (`dsh-cordis-client-runner`) regenerated and carries `moveSavedHost`, `moveHost`, and `SavedHost.order`; the ui-settings-hosts README limitation entry is rewritten.

## Open work

- The arrangement lives in browser localStorage per profile; no cross-device or cross-carrier sync.
- The roster cap stays 8, so stamps remain dense; no sparse-order compaction is needed.

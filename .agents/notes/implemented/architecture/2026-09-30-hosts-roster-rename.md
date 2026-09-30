# Agent Note: Local saved-Host renaming on the section 28 roster

Status: implemented

English | [中文](2026-09-30-hosts-roster-rename.zh.md)

## Problem

The §28 saved-Host roster carried descriptor identity facts with no local editing beyond Forget. Two rows whose descriptors share a display name were indistinguishable in the settings section, and a user's own vocabulary for a Host ("Desk", "Work laptop") had no home; the ui-settings-hosts README listed "no roster editing beyond Forget" as deferred work.

## Decision

- `SavedHost` gains an optional `customName`: a client-chosen display override. One `hostDisplayName(row)` helper owns the presentation precedence `customName ?? displayName ?? hostId`, shared by the row title and the switch notice.
- `SavedHostsStore.rename(hostId, customName)` sets or clears the override in place. Order never moves — recency is a connection fact, not a naming fact; an absent id or a no-op rename changes nothing and notifies nobody; every real change persists and notifies subscribers exactly like `record`/`remove`. `undefined` returns the row to descriptor facts.
- `record()` keeps the override alive across reconnects: descriptor facts (`displayName`, `platform`, `origin`, `lastConnectedAt`) refresh from the new generation while the existing `customName` is carried onto the refreshed row.
- `parseRow` validates `customName` as a string when present, so pre-rename persisted rows parse unchanged and a corrupt value drops with its row, matching every other field's durable-boundary rule.
- `ConnectionHandle.renameSavedHost(hostId, customName)` mirrors `forgetSavedHost`: a roster seam with no connection effect. The Hosts section follows the devices' inline rename pattern — draft seeded from the presented name, empty drafts rejected with a row-level alert, saving trims, Enter saves — and a `Reset name` action appears only once a custom name exists.
- Proof: the unit suites cover store semantics (in-place set/clear, no-op silence, reconnect preservation, parse admission), section presentation (empty rejection, notice name, reset wiring, reset hidden without a custom name), plugin wiring into the persisted roster, and subscription-driven rerender on an external rename. `hosts-settings.e2e.ts` extends the real-browser lane: empty draft rejected in the shipped section, `  Desk  ` persists trimmed into `dsh-saved-hosts.v1`, reset returns the pre-rename presented name; the golden gains the Rename line.

## Alternatives considered

- **Manual row reordering:** conflicts with the most-recent-first invariant the roster documents; still deferred.
- **Empty save clears the override:** a typo would silently discard a chosen name; rejecting empty drafts matches the devices precedent, and the separate reset action makes clearing explicit and reversible.
- **Renaming the descriptor on the Host:** the descriptor name belongs to the Host deployment and a client-side override needs no Host round-trip; it also works for bookmarks whose Host is not currently reachable.

## Consequences

- Saved Hosts are locally nameable; the choice survives reconnects, page reloads, and later descriptor-side renames of the same Host.
- The cordis inspect catalog (`dsh-cordis-client-runner`) regenerated and carries the new method contracts; both packages' READMEs updated, and the stale "no roster editing" limitation entry is replaced.

## Open work

- The override lives in browser localStorage per profile; no cross-device or cross-carrier sync.
- No manual reordering; sorting stays most-recent-first by design.

# Agent Note: fork and command execute receipts become durable session facts

Status: implemented

English | [中文](2026-10-08-durable-mutation-receipts.zh.md)

## Problem

The clientMutationId settlement (two prior increments) kept receipts in Host-process maps, so a retransmission that reached a restarted Host minted a second child session or re-ran the handler. The prompt lane's receipts survive restarts because they are session events; the open design ruling named exactly this durable home for fork and execute.

## Decision

Receipts are now session facts and the in-process maps are gone. Execute: `command/run` carries the id as an audit trail, and `command/done` carries it exactly when the settled execution came through the settle path — the done-with-id IS the receipt; thrown and aborted settlements write no id, so their resends re-run, and a crashed dangling run is never a receipt. The resend check consults a session-projection unit (state keyed per session, bounded at 1024 with oldest eviction, hydrated from the log for cold sessions) and replays the recorded commandId and result without re-entering the handler or appending events. Fork: a new log-only `session/forked` event on the source session carries `{ clientMutationId, childSessionId }` — the child id is what a resend replays — appended after the child is published; fork now resolves the agent first (the rename precedent) because appending to a cold source requires a live session. Receipt keys are per-session: scans read only a session's own events, so a fork child's inherited ancestor receipts never match.

## Alternatives considered

Keeping the process map as a fast path in front of the durable fact was rejected — one fact, one home; the two stores could disagree across the restart boundary that is exactly the case the durable receipt exists for. `ignorable`-marking the new event for old-build compatibility was rejected: `Session.append` has no such parameter, and the pre-release stance sanctions fail-closed logs. A child-side receipt home lost on lookup (a resend knows the source and the id, not the child).

## Consequences

The persistence catalog, frozen v0 dispositions, payload validator, and their fixtures follow the type (the gen-30 convention face); session-format family suites stay green (801 tests). SDK snapshots needed no refresh: no recorded scenario submits an id, so no event in any expected output carries the new member — the optional member is absent by construction, and the claim is absence-of-drift, verified against the suite's unchanged expected outputs in CI. Android and Apple link contracts enumerate only a remote-projection subset (command events are not projected there), so no native mirror changed.

## Open follow-ups

The multi-version interoperability matrix stays open as before; a future release may pin receipt retention beyond the 1024-entry replay window as a product decision.

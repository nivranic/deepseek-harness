# Agent Note: Lite handoff turns journal as themselves — no fabricated completion, no sticky pending handoff

Status: implemented

English | [中文](2026-10-17-lite-handoff-defects.zh.md)

## Problem

Two named defects from the journal-resume generation's follow-up list sat in the handoff path. First, a handoff turn journaled a fabricated completion: the loop returns after the handoff marker with no terminal event, so `send()`'s residual `else` arm recorded a `message/completed` whose text came from `conversation.lastOrNull()` — the user's own prompt row, restated as the assistant's answer — and since resume landed, that fabricated reply replayed across relaunches. Second, the fold set `pendingHandoff` on `handoff/requested` and never cleared it: the live fold carried the flag for the rest of the process, the next normal turn journaled `handoff/requested` again instead of `turn/completed` (which then never returned to the journal), and every relaunch replayed the sticky flag. Adjacent, the banner read a parallel `lastHandoff` field — set once, never cleared within a process, lost across relaunch even when the journal ended at the marker — a duplicated UI state machine of exactly the shape section 72 lists as deletable debt.

## Decision

The fold clears `pendingHandoff` when the next `prompt/accepted` arrives: a new turn supersedes the last one's pending handoff, so the flag holds exactly from the marker to the next accepted prompt. `send()`'s discriminant gains a first arm on that per-turn flag — a handoff turn journals nothing beyond its own marker pair, because the tail block already records `handoff/requested` and, correctly, not `turn/completed`; the journal for a handoff turn is exactly `prompt/accepted` → `handoff/requested`, matching the handoff conformance fixture's fold. The banner renders from the state cut's `pendingHandoff` and the `lastHandoff` field is deleted: one source of truth, live from the driver fold during the turn, persistent through the seeded journal fold after a relaunch that ends at the marker, cleared when the next turn starts.

## Alternatives considered

Exposing the driver's local handed-off marker as `send()`'s discriminant was rejected: the fold's flag is per-turn reliable once supersession lands, and the fold is the plane the journal replays. Clearing the flag on `message/completed` or `turn/completed` was rejected — a handoff turn emits neither; the supersession point is the next prompt, exactly what the fixture's event sequence fixes. Seeding `lastHandoff` at construction instead of deleting it was rejected: two states to keep aligned, and the field would still need its own clearing rule — reading the fold is strictly simpler and settles both directions at once. A new journal tag was rejected: the sixteen-tag closed set stays; the marker pair already carries the turn exactly. A driver-side terminal event after the marker was rejected: the loop contract pins stopping at the marker — the turn did not complete, it moved.

## Consequences

A handoff turn now replays as itself: the user row plus the pending-handoff banner, no assistant echo, across relaunches too. `turn/completed` returns to the journal after a handoff turn — the corruption where every later turn re-marked `handoff/requested` is gone. The banner agrees with the fold in both directions: it clears when the next turn starts and survives a relaunch onto a journal ending at the marker. One arm of the same fabrication family remains, named rather than silently kept: a `turn/cancelled` turn would still fall to the `else` arm and journal a delivered prefix as a plain completion — unreachable today because the ViewModel exposes no cancel path.

## Open follow-ups

The `turn/cancelled` fabrication arm once a cancel path exists; the TypeScript and Swift sibling folds (main repository) carry the same set-only `pendingHandoff` semantic and their generated fixture sets want the handoff-then-next-prompt case mirrored; seeding the live driver state to smooth the first post-resume turn; tool-descriptors packaging with the HOST_DECLARED name domain, where local-name alignment becomes load-bearing; the RelayClient migration or retirement; the support-export facts projection; the approval ask tier; attribution headers; the section 54 network matrix.

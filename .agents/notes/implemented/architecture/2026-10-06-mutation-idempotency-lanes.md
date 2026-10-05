# Agent Note: Mutation-retry settlement is pinned per write lane

Status: implemented

English | [中文](2026-10-06-mutation-idempotency-lanes.zh.md)

## Problem

Section 17 asks state-changing requests to carry a `clientMutationId` so a Host can recognize a retransmitted request after a network retry. A file-by-file survey of every mutating surface found no general `clientMutationId` field anywhere; recognition is implemented per mechanism — requestId/rpcId receipts (session prompt's triple check, subagent prompt receipts surviving restarts), revision compare-and-set (renameAt, goal, interaction replies), turn-targeted cancellation (cancelTurn, interruptTurnByParent), single-use pairing codes and nonce replay floors (device-trust), and first-answer-wins (interaction). Twenty of twenty-seven surveyed lanes already assert their retry settlement directly. Seven did not: two carry no idempotency anchor at all (session fork mints a fresh child id per call; commands execute mints a fresh command id per call, so a retry runs the handler twice), and five more settle sensibly (accepted no-op, last-wins, stable not-found) without a lane test pinning that behavior.

## Decision

Pin every lane's present retry settlement with a direct test instead of inventing protocol fields. The fork and command-execute tests assert the retry side effect explicitly — a second independent child session, a second command event pair — with in-test comments naming the open design ruling: adopting client-mutation identity for those two lanes (returning the existing child, executing once) is a product decision that would change the wire surface, not a test gap to paper over. The remaining five tests pin the existing semantics: a repeated cancel accepts without a second turn settlement, a repeated unconditional rename appends two title events with the later seq winning, a repeated model selection settles once for the next assembly, a repeated device rename lands on the last value without touching grants, and repeated workspace delete/archive map to the same stable failure the unknown-id path reports.

## Alternatives considered

Adding an optional requestId to fork and command execute now, mirroring the prompt lane's receipt pattern, would satisfy §17's letter but commits a wire-surface and persistence decision (where the fork receipt lives, what a retry returns) that the specification does not pin; recording the open ruling and pinning today's behavior keeps the seam honest without pre-empting it. Skipping the weak-lane tests because the semantics are "obvious from code" was rejected — the survey itself found the settlement logic spread across five mechanisms, and unpinned behavior drifts.

## Consequences

Every §17 write lane now has a direct settlement assertion; the traceability remaining text records fork and command-execute mutation identity as the open design ruling. A future adoption of client-mutation identity for those lanes must update these pins in the same change, which is exactly when the review conversation should happen. No production code changed.

## Open follow-ups

The fork/execute clientMutationId adoption ruling (wire surface, receipt persistence, retry return shape) remains open; the multi-version interoperability classes stay open as before.

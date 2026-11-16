# Agent Note: Test baselines track the attachment admission and carrier-exhaustion contracts

Status: implemented

English | [中文](2026-10-07-baseline-red-repair.zh.md)

## Problem

Two test baselines had drifted from the behavior their packages actually ship, and both were red on a clean HEAD long enough to be carried as open channels across generation reports. (1) The command-attachment cases in `packages/interaction/commands/tests/commands.spec.ts` run the real base-class batch admission through a store double that delegates `validateImageBatch` and `saveImages` to `AttachmentStore.prototype`; when the aggregate image limits landed, the totals check became its own base method, the double never gained that delegation, and all four admission cases failed with `TypeError: this.validateImageTotals is not a function` instead of exercising the real validation. (2) `packages/api/workspace-controller/tests/transport.client.spec.ts` still expected exhausted logical-stream carrier retries to surface as `gateway/internal`, while the gateway has mapped `RemoteStreamCarrierError` to `gateway/transport-interrupted` (with `{ stream }`) since the carrier-union change and its README documents that contract — exactly the §45 principle that every client presents the same semantics for the same error.

## Decision

1. The store double gains the missing delegation: `validateImageTotals` joins its two sibling delegations with the same prototype-cast idiom, so the double's limits feed the real base method and the four cases assert real admission behavior again (mixed batch passes 2 images × 4 bytes; the third image trips the documented count-limit text).
2. The transport spec's expectation and test name change to the documented contract: exhausted carrier retries publish `gateway/transport-interrupted`. Tests describe behavior, and the authority here is the gateway's code vocabulary plus its README; §45's same-semantics principle covers the workspace client's baseline.

## Alternatives considered

- **Rebuilding the double via `Object.create(AttachmentStore.prototype)`**: rejected — it would reshape the whole double for one missing member; the delegation idiom already exists in the file for exactly this purpose.
- **Reverting the gateway mapping to `gateway/internal`**: rejected — the error vocabulary, the README contract, and the retry semantics name carrier exhaustion `gateway/transport-interrupted`; aligning the stale spec is the direction §45 states.

## Consequences

The two files go from five red to 73/73 green with zero production-code changes: the repair is entirely baseline truthing. §45's ledger entry records the workspace-client alignment (remaining sentence plus the transport spec as evidence). The generation also retires the two oldest standing baseline-red entries from every recent generation's open-channel list.

## Open follow-ups

- The loader-composition e2e baseline failure keeps its own channel (a missing consent env point plus an unlocated Windows `.sessions` behavior) and is untouched here.
- The file-upload `admitEncodedImages` classification ruling and the client-domain-graph layering baseline stay open.

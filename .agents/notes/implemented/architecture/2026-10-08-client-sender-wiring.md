# Agent Note: fork and command execute senders mint clientMutationId per intent

Status: implemented

English | [中文](2026-10-08-client-sender-wiring.zh.md)

## Problem

The clientMutationId adoption (previous increment) landed the wire field and Host receipts first, server-side; no client minted the id, so production traffic could not use the retransmission settlement. Section 17's semantics need the client side to bind one id to one user intent and reuse it across retries of that intent.

## Decision

Both client senders keep a per-intent runtime memo. `ui-commands`'s `execute` exit mints an id per submission and reuses it when the identical draft (same line, item-by-item equal attachments) is resubmitted; changed content, or a settled execution, clears or replaces the memo — the settle rule clears on any returned `CommandExecution`, including handler-error settlements, which is exactly the class the Host records. `ClientSessions`'s `fork` exit keys its memo by `(sessionId, atSeq)`: a failed fork keeps the entry (a resend of the same anchor reuses the id), a successful one clears it, and the entry is written before the await so concurrent same-anchor calls share one id. The safety property that makes aggressive id reuse correct: the Host records receipts only on settled successes, so a genuinely failed intent's id re-runs fresh on the Host while a lost-response intent's resend returns the first settlement. Web packages mint the uuid through `@deepseek-ai/dsh-util-crypto` — repo lint forbids `crypto.randomUUID` there because plain-HTTP LAN pages (non-secure contexts) do not provide it.

## Alternatives considered

Minting per call without a memo would defeat the purpose — a user's resubmission after a lost response would carry a fresh id and mint a second child or second execution. Minting in the typed manager layer for commands was rejected: the submission intent (draft content) lives in the composer service, which is the only place that can judge "identical draft". A durable client-side id store was not taken — the memo is runtime state, and crash-restart resubmissions start a new intent by design.

## Consequences

Both §17 write lanes now have end-to-end retransmission settlement: client intent identity, wire field, Host process receipt. The generated client projections needed no regeneration (the request interfaces flow from the source types the previous increment widened). Android callers do not invoke these lanes directly (no Kotlin execute surface exists), so no native mirror changed.

## Open follow-ups

Durable restart-surviving receipts (needs new SessionEventMap vocabulary with the full SDK-projection ceremony) remains the open §17 design ruling; the multi-version interoperability matrix stays open as before.

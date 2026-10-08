# Agent Note: fork and command execute adopt clientMutationId receipts

Status: implemented

English | [中文](2026-10-08-client-mutation-id-adoption.zh.md)

## Problem

Section 17 asks state-changing requests to carry a `clientMutationId` so a Host can recognize a retransmitted request after a network retry. The mutation-idempotency-lanes survey found 27 write lanes; 25 settle through five existing mechanisms, while session fork and command execute mint a fresh identity per call, so a retry ran the whole command again — a second independent child session, a second handler execution with a second command event pair. The survey recorded the adoption semantics as an open design ruling and pinned the then-current behavior with direct tests.

## Decision

The ruling is adopted for both lanes as an optional client-minted identity plus a Host-process receipt registry. `SessionForkRequest` gains `clientMutationId?: ClientMutationId` and `commands.execute` gains the same field on a new `CommandExecutionRequest` object (`(agent, request, signal)` — the request-object shape every session-controller `@Remote` method already uses, and the shape the typert analyzer's cancellation-signal-final rule requires). The id is branded, validated at the wire boundary (non-empty, no leading or trailing whitespace, at most 128 characters; `gateway/bad-request` on fork, `TypeError` on execute per each package's boundary convention), and consulted before any side effect: a resend whose id is already settled in this Host process returns the first settlement verbatim — the same child `SessionForkValue` without re-observing the source or creating a session, the same `CommandExecution` with its original commandId and result without re-entering the handler or appending lifecycle events. Receipt registries are FIFO-bounded at 1024 entries; an evicted id re-runs as a fresh request. Fork records only after the child session is fully created and its workspace attached; execute records on the settled-result path only — admission errors are settled executions and are recorded, while thrown handlers and unresolved syntax record nothing, so failed mutations stay retryable.

## Alternatives considered

Durable restart-surviving receipts were deliberately deferred: the prompt lane's receipts survive restarts because they are session events, whereas durable homes for fork and execute would need new SessionEventMap vocabulary (a fork-receipt log event or command-run payload growth) with the full format-catalog and SDK-projection ceremony — a structural decision this adoption does not pre-empt. An explicit-undefined positional slot before the signal was rejected in favor of the request-object convention.

## Consequences

A retransmission that reaches the same live Host process is now idempotent on both lanes; the mutation-idempotency-lanes pinning tests were updated in the same change — retries without an id still mint second effects, since adoption applies only to id-carrying requests. Client senders do not yet mint the id: the wire field and Host receipts landed first (the same server-first order device admission took), and client wiring is a follow-up.

## Open follow-ups

Durable restart-surviving receipts for both lanes; client-side sender wiring; the multi-version interoperability matrix stays open as before.

# Agent Note: Lite turns continue over their own tool output

Status: implemented

English | [中文](2026-10-21-in-turn-tool-round-continuation.zh.md)

## Problem

Gen-63 closed the cross-turn half of the refeed loop, but a turn still ended the moment its stream did: `finish_reason` never entered the Lite vocabulary at all — the line parser read only `choices[0].delta`, so the terminal chunk carrying `finish_reason` over an empty delta was dropped whole — and `drive()` unconditionally landed `message/completed` + `turn/completed` after `collect`. A model that called `calculator` needed the user to send another message before it could see the result and continue; every tool chain cost one manual prompt per hop.

## Decision

Close the loop inside the turn. `LiteStreamChunk` gains `Finish(reason: String?)`; the line parser reads `choices[0].finish_reason` before the delta requirement drops a piece, and the provider emits the captured reason after `[DONE]` and after the assembled tool calls flush — the host `translate.ts` delayed-finish form, with a wire that never stated a reason finishing `Finish(null)` rather than a guessed one, and the `STREAM_CLOSED` truncation guard unchanged. `drive()` replaces its unconditional terminus with a round loop: each round that ends `finish === "tool_calls"` without a handoff lands its own `message/completed` (a text-less tool round keeps its empty assistant row — the host's never-drop projection of an assistant message), records its tool-row boundary, and re-requests with a history that now includes the live turn's completed rounds; a non-`tool_calls` finish or `MAX_LITE_ROUNDS_PER_TURN = 8` requests close the turn fail-soft — the last round's assistant row and the terminal events still land, the event stream is never truncated. The cap is a fixed loop-safety invariant (typical chains resolve within three requests; eight doubles that headroom), not a deployment tunable. The history domain reshapes around rounds: `LiteTurnRecord(userText, rounds)` where each `LiteTurnRound` is one model response — reply text, tool calls, per-id results — so the export splits turns and rounds through per-round tool-row cursors, and `wireMessages()` replays rounds in the host serializer's interleaved order (tool round = one assistant row holding its calls plus one `role:"tool"` row per id in call order; text round = one plain assistant row; a round with neither rides nothing, matching the host's empty-assistant projection). A new `multi-round-tool-turn.json` conformance fixture pins the fold shape — two assistant rows in one turn's conversation — with `LiteFold.kt` and `LiteChat.kt` untouched: journal accounting keeps exactly one turn-outcome event per turn, chapter 64 standing.

## Alternatives considered

Reusing the prompt-keyed script channel for follow-ups without a test seam was rejected — same-turn re-requests share the prompt, so the scripted provider gained an optional `followUps` list (default-preserving) purely to keep per-round assertions honest. Counting the cap in executed tool calls rather than model requests was rejected: requests are the cost unit on a metered endpoint, and the request bound is the tighter invariant. Carrying a zero-round live turn into the continuing request's history was rejected — it duplicates the prompt row (the request already carries it), so the export keeps the old first-round drop semantics. Elevating the cap to a `Config` field was rejected: it is a safety invariant against runaway loops, not a deployment-varying choice.

## Consequences

A Lite conversation now runs real tool chains end to end: the model calls a tool, sees its result, and continues within the same turn — up to eight requests — with the wire form field-aligned to the host serializer's interleaved rows. Restart still loses the tool context (chapter 64 fidelity — the recorded cost). The `role:"tool"` interleaved re-request rows are exercised against the embedded HTTP server in JVM tests, including a driver-over-real-provider two-request integration; real-model acceptance of the multi-round request shape stays e2e territory. Core JVM tests: 572 -> 579.

## Open follow-ups

Journal persistence of tool rows (a chapter-64 decision, untouched here); the remaining three executors (`url_fetch` with its endpoint policy — §54 measured not to block it, `image_inspect`/`attachment_read` without intake producers); the paired-host catalog pull's real-Host e2e; catalog hot-refresh UI stay open from gen-64's ledger.

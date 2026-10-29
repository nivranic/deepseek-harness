# Agent Note: Lite tool-call fragment assembly

Status: implemented

English | [中文](2026-08-30-lite-tool-call-assembly.zh.md)

## Problem

OpenAI-compatible streams deliver one tool call as many deltas: the first names the slot (`index`, `id`, function `name`), later deltas append `arguments` fragments, and parallel calls interleave by index. The Lite parser recognized only whole-call deltas, so real fragmenting providers silently dropped every argument continuation — the loop would dispatch a call whose arguments were empty or partial. The provider skeleton documented this as deferred.

## Decision

`LiteStreamLineParser.parsePiece` now returns the line's kind — text, reasoning, or raw `toolCallEntries` — instead of prematurely shaping tool deltas. `LiteToolCallAssembler`, a pure value type, owns the cross-line state: slots keyed by wire index, `id`/`name` captured on first sight, argument fragments concatenated, absent ids defaulted to `tool-<index>`. `LiteHTTPProvider` feeds every entry in and flushes the assembled calls in index order once the stream ends — the moment an OpenAI-compatible tool-call burst is complete; a slot that never received a name is dropped rather than dispatched half-formed. Whole-call deltas (the skeleton case) flow through the same path and flush unchanged, so there is one tool-call pipeline, not two.

## Consequences

The loop sees only dispatchable whole calls from any OpenAI-compatible provider. Text and reasoning keep their per-line emission; tool calls intentionally wait for stream end, which for chat-completions semantics is undetectably later (calls end the message). A dropped connection mid-assembly loses the partial call by design — the fold's network-partial semantics cover streamed text, and dispatching a half-received call would be worse. Tests cover SSE/NDJSON piece parsing, three-fragment single-call assembly with flush draining, and parallel indices flushing in index order with default ids and a nameless slot dropped.

## Alternatives considered

Emitting each slot as soon as a *later* index appears was rejected — interleaving order is not a completion signal and single-call streams would never emit. Extending `LiteStreamChunk` with a fragment case was rejected — the loop vocabulary stays whole-call; assembly is a provider-side decoding concern.

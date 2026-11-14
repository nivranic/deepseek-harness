# Agent Note: Lite tool results ride the next model request

Status: implemented

English | [中文](2026-10-18-lite-tool-result-history.zh.md)

## Problem

Gen-62 landed the first on-device tool executors, but the loop was half-closed: the model could issue a `calculator` or `artifact_create` call, the driver executed it and folded an honest `tool/result` — and the very next request carried only the system row and the new prompt. The model never saw its own tool output, so every later turn answered blind. The durable journal was no help and deliberately so: chapter 64's turn-outcome fidelity rule keeps tool rows out of the journal entirely, which also means a relaunch loses the tool context (the fold is process memory).

## Decision

Feed the model from the live fold. `LiteProviding.stream` gains a typed `history: List<LiteTurnRecord>` parameter (defaulting to `emptyList()` beside the existing `system = null`, so bare provider calls stay byte-identical); each `LiteTurnRecord` is one completed turn — the accepted prompt, the reply text (null when the turn ended without one), the turn's tool calls, and each call id's result text, a failure's reason riding exactly like a success's output. The driver snapshots the fold between `prompt/accepted` and the stream call (the fold's last conversation row is this turn's user row and no tool row of this turn exists yet, so a per-turn tool-row cursor — the fold's count at each accepted prompt — splits the chronological tool rows at exact turn edges). `LiteHTTPProvider` expands each record into the host provider's wire line form (`llm-deepseek` serialize.ts): the user row verbatim; a turn with calls emits the assistant row holding `tool_calls` with `""` content for a text-less reply, then one `{"role":"tool","tool_call_id",content}` row per call in call order, an empty result text falling to `'(no output)'`; a turn with neither reply text nor calls keeps its user row only, matching the host's empty-assistant projection rule. Journal accounting is untouched — chapter 64 stands.

## Alternatives considered

Persisting tool rows into the journal would make the refeed survive relaunches, but chapter 64 is a Behavior-Spec decision (turn-outcome fidelity) that this change must not relitigate; it stays a recorded follow-up. In-turn multi-step continuation (a `finish_reason === "tool_calls"` branch that re-requests inside the same turn) was deferred: it needs drive-loop re-entry and a Behavior-Spec vocabulary extension for multiple assistant messages per turn, a larger surface than the cross-turn gap it would also solve. Deriving history from the journal instead of the fold was rejected for the same chapter-64 reason — the fold already holds the paired rows the export needs.

## Consequences

A Lite conversation can now use its on-device tools across turns: turn two's request carries turn one's call and result verbatim, including failed or permission-denied calls (every issued tool_call id gets an answer row, as the OpenAI wire requires). Process restart still drops the tool context — the fold is memory — and that is honestly the recorded cost of chapter 64 fidelity. The `role:"tool"`/`tool_call_id` request rows are the first of their kind on the Android face, aligned field-by-field with the host serializer. Core JVM tests: 559 -> 564.

## Open follow-ups

In-turn multi-step continuation (finish_reason branch plus Behavior-Spec vocabulary for multi-message turns); journal persistence of tool rows as a chapter-64 decision; real-model acceptance of the history-bearing request shape (keyless tests pin the wire form against the embedded server; a live API round is e2e territory); the paired-host catalog pull channel and the remaining three executors stay open from gen-62's ledger.

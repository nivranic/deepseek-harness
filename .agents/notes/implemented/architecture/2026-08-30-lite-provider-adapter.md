# Agent Note: Lite real-provider adapter skeleton

Status: implemented

English | [中文](2026-08-30-lite-provider-adapter.zh.md)

## Problem

The Lite loop drove only scripted providers; Phase 3 needed the real seam — a streaming chat-completion client that decodes provider bytes into Lite chunks and reports failures in the Behavior Spec's own vocabulary (`network/error` kinds, `provider/error` codes) so the fold records exactly what the spec names.

## Decision

`LiteHTTPProvider` (an actor over `LiteProviding`) posts one OpenAI-compatible streaming completion per prompt and turns `URLSession.bytes` lines into chunks via `LiteStreamLineParser` — a pure function accepting both SSE (`data: {…}`, `[DONE]`, comments) and bare NDJSON, decoding the chat delta shape (`reasoning_content` → reasoning, `content` → text, a whole `tool_calls` entry → a tool call). `LiteTransportError` classifies failures: `URLError` codes map to the spec's network kinds (timed-out → timeout, unreachable family → unreachable, lost/not-allowed → dropped), non-2xx responses become `provider` codes (`HTTP_<status>`). The loop driver's catch now folds the classified error into the matching event — `.network` → `network/error`, `.provider` → `provider/error` — instead of flattening every failure into a generic provider error.

## Consequences

A real endpoint plugs into the loop unchanged; the fold's terminal outcomes now distinguish transport loss (partial kept for resume) from provider refusal (stream cleared) exactly as the spec's scenarios describe, and the driver tests pin that mapping with throwing providers. Parsing is unit-tested over SSE and NDJSON forms without networking; the HTTP path itself needs a macOS lane to compile-run (standing caveat). Deliberately deferred: fragmented tool-call argument accumulation across deltas (this skeleton serves whole-call deltas — noted in the adapter), assistant/system history assembly, and retry/backoff policy, all of which arrive with the product surface that exercises them.

## Alternatives considered

Mapping every failure to `provider/error` was rejected — the spec keeps the two failure families apart because their recovery differs (resume versus retry), and the driver is where that distinction lands. A full streaming SDK was rejected — one request shape, one line parser, and a pure function keep the seam reviewable and keyless-testable. Parsing tool-call fragments now was rejected — the mock and the spec's scenarios carry whole calls; fragment assembly is a provider-behavior concern to add with real-stream recordings.

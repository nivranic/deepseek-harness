# Agent Note: The Android Lite HTTP Provider

Status: implemented

English | [中文](2026-08-31-android-lite-http-provider.zh.md)

## Problem

The Android Lite runtime could drive turns only over the scripted provider: nothing spoke the OpenAI-compatible streaming protocol, so an on-device model call — the point of the embedded runtime — had no real seam.

## Decision

`LiteHTTPProvider.kt` mirrors Apple's provider stack over the JDK `HttpClient`. `LiteStreamLineParser` is a pure line decode: SSE `data:` payloads, bare NDJSON, blank and comment lines, and the `[DONE]` terminator all reduce to a `Text`, `Reasoning`, or raw `ToolCallEntries` piece — reading `reasoning_content` before `content` before `tool_calls`, exactly the delta shape DeepSeek serves. `LiteToolCallAssembler` slots fragments by wire `index`, synthesizes `tool-<index>` ids when the first delta carries none, appends argument fragments, fills a name only into an empty slot, and flushes in index order at stream end — dropping slots that never received a name rather than dispatching them half-formed. The provider posts `{model, stream, messages}` with the bearer header, refuses non-2xx as `Provider("HTTP_<status>")`, streams the body line by line into chunks plus assembled calls, and maps transport failures by URLError semantics: `HttpTimeoutException`/`SocketTimeoutException` → `timeout`, `UnknownHostException`/`ConnectException` → `unreachable`, everything else → `dropped` — both at connect time and mid-stream.

## Consequences

`LiteStreamParsingTest` pins the pure surface: SSE and bare-NDJSON deltas, every non-payload line kind, fragment assembly across indices with exact argument concatenation and flush-in-index-order, slot retirement after flush, synthesized ids, and the dropped nameless slot; the transport classifier is pinned with constructed exceptions per kind. `LiteHTTPProviderTest` closes the loop against a real local `HttpServer`: a scripted SSE response (reasoning + text + a tool call split across two deltas + `[DONE]` + a keep-alive comment) streams as the exact four chunks while the handler observes the path, bearer header, model, and prompt on the request; a 429 refusal throws `HTTP_429`; a connection to a port nothing listens on throws `Network("unreachable")`. The Android lane verified green. A deliberately live streaming StateFlow projection of the chat surface remains deferred — it matters once this provider feeds the UI in anger.

## Alternatives considered

OkHttp for the transport was rejected — the core module stays pure JVM on the JDK stack (the same choice `LinkWire` made), and the app layer already owns its OkHttp decision for pinning. Parsing via generated contract models was rejected — the provider consumes a third-party wire shape the contract table does not own; a local JsonElement decode keeps that boundary explicit.

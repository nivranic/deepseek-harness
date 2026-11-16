# Agent Note: Lite speaks OkHttp on-device and its entry configures the provider

Status: implemented

English | [中文](2026-10-16-lite-http-okhttp-config-face.zh.md)

## Problem

Two gaps kept the standalone Lite runtime unusable on a device. First, `LiteHTTPProvider` still streamed over `java.net.http`, a package Android runtimes do not carry: the previous generation's lazy-acquisition fix only made construction safe, and `classifyTransportFailure` still referenced the `HttpTimeoutException` class literal, so the first on-device use of the provider fails with `NoClassDefFoundError`. Second, the shell injected empty endpoint, API key, and model strings, so `LiteEntry`'s empty state never cleared — no configured endpoint ever reached the provider. Beside those blockers, the request face trailed the host provider in three ways: no `accept: text/event-stream` header, no truncation verdict when the stream ends before `[DONE]` (the host SSE reader raises `STREAM_CLOSED`), and timeout classification keyed on JDK-only exception types.

## Decision

`LiteHTTPProvider` now speaks OkHttp — the stack `:core` already ships and uses (`LinkClient`, `NativeGatewayClient`). The client carries the Link stream-transport timeouts (connect 10s, write 30s, read and call disabled so an idle long-lived stream outlives any fixed bound), the request gains the SSE accept header beside Bearer and JSON content type, and the read loop follows the Link line-loop skeleton. Failure classification keeps its three-way vocabulary while dropping every JDK-only type: every OkHttp timeout flavor raises `SocketTimeoutException` and reads as `timeout`, name-resolution and connection refusals read as `unreachable`, everything else as `dropped`. A stream that reaches EOF without `[DONE]` now raises `LiteTransportError.Provider("STREAM_CLOSED")` — the host's code literal — and the tool-call assembler never flushes on that path: a truncated stream's half-assembled calls are not dispatched.

The configuration face closes the second gap. `LiteConfig` (endpoint, API key, model) persists through `LiteFileConfigStore`: the whole file is sealed through the `link.CredentialsCipher` seam (the app injects `AndroidKeystoreCipher("dsh-lite-config")`, JVM tests the plain cipher — the `LinkCredentials` construction form), written through the atomic temp-and-rename helper. An absent file reads as unconfigured — a legal first-run state — while a malformed or undecryptable file fails loud, never a silent null. `validateLiteEndpoint` enforces HTTPS, a non-empty host, and no userinfo while allowing a full path, the pairing origin rule minus its origin-only restriction. In `LiteEntry`, an injected store drives the face: unconfigured shows the blocked empty state plus a three-field form whose save button gates on all three fields and a passing endpoint check (the PairingScreen gate shape); configured shows the chat with a "修改配置" entry that swaps in a prefilled form; each save bumps a revision that reloads from disk into a fresh assembly. A load failure gets its own error line — it never reads as unconfigured.

## Alternatives considered

DataStore or SharedPreferences were rejected: the app persists everything as files, and the atomic file write is the standing precedent. Field-level encryption of only the API key was rejected: the file-store precedent seals whole files (`native-hosts.enc`), and the injected-cipher form stays the same either way. Keeping the JDK client behind reflection guards was rejected: the class literal poisons loading itself, and reflection would hide the poison rather than remove it. Attribution headers (`x-deepseek-harness-*`) stay off: those identify the host harness to the provider, a different product face from the companion; the minimal alignment is Bearer, content type, and accept. A network security config admitting cleartext endpoints was rejected: HTTPS-only matches the pairing origin rule, and the JVM test stubs never cross the Android network stack. Migrating `RelayClient` in the same change was rejected: it shares the JDK-client defect but has no production call site today, so it stays a named follow-up rather than untested drift.

## Consequences

The Lite runtime is closed end to end on-device: configure, persist under the Keystore seal, relaunch into an assembled chat, and stream over a stack Android carries. Truncation semantics now match the host — a stream cut before `[DONE]` is an error whose partial tool calls stay unflushed — and every failure classification rests on exception types present on both platforms. `:core`'s production paths no longer touch `java.net.http` (the dormant `RelayClient` is the named remainder). The connected chain on emulator-5554 passes three cases including the save-seal-reload-assemble walk through the real Keystore cipher. One visible behavior change: the save button's disabled state is the validation feedback, with no separate error line — the PairingScreen form.

## Open follow-ups

Migrating or retiring the dormant `RelayClient` off `java.net.http`; the attribution-header decision; the preset selection face; bundling tool declarations for a Host-declared name domain; journal resume for assembled sessions; projecting the session facts into the support export under the no-secrets rule; the approval ask tier; and on-device verification across the section 54 network matrix.

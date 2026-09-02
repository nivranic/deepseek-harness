# Agent Note: The Kotlin wire client half

Status: implemented

English | [中文](2026-08-30-android-wire-client.zh.md)

## Problem

The Android core could fold fixtures but not speak the link: no envelopes, no signing, no pinning, no HTTP. The Swift `SharedAppleRemoteCore` defines the wire half a Kotlin companion must mirror before any Compose surface can pair with a host.

## Decision

`apps/android/core` implements the mirror with JDK crypto, OkHttp, and kotlinx JSON. `LinkWire` carries the pass-through `WireValue` plus canonical unary `payload.args`, echoed rpcId/result parsing, and NDJSON stream frames; stream requests use their own top-level `args`. `LinkSigning` mirrors the four-line signing input, lowercase SHA-256 hex, and Ed25519 through `java.security`. `LinkPinning` fingerprints the leaf SPKI DER and supplies the trust manager and hostname verifier installed on the Link transport before any call runs; the QR-authenticated SPKI, not a public-CA DNS identity, names the private Host. `LinkClient` accepts pairing only when the payload endpoint and pin own that client, maps successful omitted values to void, and surfaces structured failures. Tests run against local HTTP and generated HTTPS servers, including a wrong-pin assertion that the handler receives no request bytes.

The Compose runtime exposes one stable `SwitchableWireDriving` handle to all models and replaces only its delegate after restore or fresh pairing. Session follow retries after carrier loss and replaces its fold from the next authoritative snapshot. The interaction model clears the previous generation identity, waits for Host `ready.clientId`, reads waterfall fields from `request`, removes cancel frames, sends `outcome`, and retries the stream with a bounded delay. The [Android Link transport and stream ownership](2026-09-02-android-link-transport-and-stream-ownership.md) decision registers each network call before execution, retires replaced clients, serializes model stream generations, and makes awaited teardown join every active or pending stream job.

## Consequences

The Android lane owns the Kotlin/JUnit and app-assembly evidence on JDK 17 with Gradle 8.14. It also runs the standalone Kotlin driver against the shipped base plus desktop Host composition and rejects any missing step in the shared pair-through-revoke corpus. This Windows host has JDK 17 but no Gradle or Android SDK, so the local native run remains `NOT_EXECUTED/HOST_ENVIRONMENT`. Generated fixtures, TypeScript contract checks, and source inspection do not substitute for the lane: G1-ANDROID closes only after the native suites and the uploaded real Host-to-Kotlin result pass.

## Alternatives considered

BouncyCastle was rejected because the JDK provider signs and verifies Ed25519 natively. `HttpURLConnection` was rejected for the Link transport because it cannot expose one reliable cancellation owner across DNS, connect, request write, response headers, and response-body reads; the [transport ownership decision](2026-09-02-android-link-transport-and-stream-ownership.md) records the replacement and its narrower alternatives.

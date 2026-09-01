# Agent Note: The Kotlin wire client half

Status: implemented

English | [中文](2026-08-30-android-wire-client.zh.md)

## Problem

The Android core could fold fixtures but not speak the link: no envelopes, no signing, no pinning, no HTTP. The Swift `SharedAppleRemoteCore` defines the wire half a Kotlin companion must mirror before any Compose surface can pair with a host.

## Decision

`apps/android/core` implements the mirror with JDK crypto, URL connections, and kotlinx JSON. `LinkWire` carries the pass-through `WireValue` plus canonical unary `payload.args`, echoed rpcId/result parsing, and NDJSON stream frames; stream requests use their own top-level `args`. `LinkSigning` mirrors the four-line signing input, lowercase SHA-256 hex, and Ed25519 through `java.security`. `LinkPinning` fingerprints the leaf SPKI DER and supplies the trust manager and hostname verifier installed on every HTTPS connection before an output stream opens; the QR-authenticated SPKI, not a public-CA DNS identity, names the private Host. `LinkClient` accepts pairing only when the payload endpoint and pin own that client, maps successful omitted values to void, and surfaces structured failures. Tests run against local HTTP and generated HTTPS servers, including a wrong-pin assertion that the handler receives no request bytes.

The Compose runtime exposes one stable `SwitchableWireDriving` handle to all models and replaces only its delegate after restore or fresh pairing. Session follow retries after carrier loss and replaces its fold from the next authoritative snapshot. The interaction model clears the previous generation identity, waits for Host `ready.clientId`, reads waterfall fields from `request`, removes cancel frames, sends `outcome`, and retries the stream with a bounded delay.

## Consequences

The Android lane owns the Kotlin/JUnit and app-assembly evidence on JDK 17 with Gradle 8.14. This Windows host has JDK 17 but no Gradle or Android SDK, and official Gradle distribution downloads were reset, so the current local run remains `NOT_EXECUTED/HOST_ENVIRONMENT`. Generated fixtures, TypeScript contract checks, and source inspection do not substitute for the lane: right-pin, wrong-pin, stable fresh-pair replacement, canonical envelope, Remote Event, and reconnect tests must all execute there before G1-ANDROID closes. Real Host-to-Kotlin acceptance remains a separate Gate 1 blocker.

## Alternatives considered

BouncyCastle was rejected because the JDK provider signs and verifies Ed25519 natively. OkHttp remains unnecessary for this slice: `HttpsURLConnection` exposes per-connection socket factories and hostname verifiers, allowing the pure-JVM module to enforce the private Host pin without a second HTTP dependency.

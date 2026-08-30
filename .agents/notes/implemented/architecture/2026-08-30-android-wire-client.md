# Agent Note: The Kotlin wire client half

Status: implemented

English | [中文](2026-08-30-android-wire-client.zh.md)

## Problem

The Android core could fold fixtures but not speak the link: no envelopes, no signing, no pinning, no HTTP. The Swift `SharedAppleRemoteCore` defines the wire half a Kotlin companion must mirror before any Compose surface can pair with a host.

## Decision

`apps/android/core` gains the mirror over the JDK stack alone — no external crypto or HTTP dependencies. `LinkWire` carries the pass-through `WireValue` (round-tripping through JsonElement trees, integral numbers as bare integers) plus the three envelope forms: the `client-request` unary envelope, the `{ok, value|error}` result, and the NDJSON stream frame. `LinkSigning` mirrors the canonical four-line signing input, lowercase SHA-256 hex, and Ed25519 through `java.security` — the raw private key wrapped in its PKCS#8 prefix, the SPKI framing byte-identical to the JDK's own `publicKey.encoded`, with a verify for tests. `LinkPinning` fingerprints a leaf certificate's SPKI DER (the JDK hands the DER over directly, so no per-curve framing); wiring it into a TLS handshake rides the app module's OkHttp stack, and the object is the verification both share. `LinkClient` pairs (fresh JDK Ed25519 pair, SPKI in the body), describes, calls `/api` unaries with the three credential headers over a fresh epoch-millis signature, and flows NDJSON streams where a failure frame completes with `Refused`. Tests run against a real local `com.sun.net.httpserver.HttpServer` — pair persists an identity, signed calls carry verifiable headers, business refusals surface their code, streams yield values until the failure frame — plus a pinned fingerprint checked against a committed Ed25519 certificate fixture.

## Consequences

All 18 core tests are green on the lane, covering the conformance fold, the vocabulary, the tokens, the wire envelopes, signing vectors, pinning, and the full client round trips. The Compose app module can now build pairing and the six-tab surface on a working client. The lane also caught two Kotlin facts: `kotlinx.serialization.json.serializer` does not resolve as an import (the reified `encodeToString` finds the serializer itself), and the pinning mismatch report names `presented` and `pinned` — the test initially asserted them swapped.

## Alternatives considered

BouncyCastle was rejected — the JDK provider signs and verifies Ed25519 natively. OkHttp now was rejected — the pure-JVM module stays framework-free; the app module owns the TLS stack where pinning actually attaches.

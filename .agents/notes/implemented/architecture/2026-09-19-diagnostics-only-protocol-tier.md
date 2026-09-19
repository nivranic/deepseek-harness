# Agent Note: Diagnostics-only protocol tier for two-generation-old Clients

Status: implemented

English | [中文](2026-09-19-diagnostics-only-protocol-tier.zh.md)

## Problem

Specification section 14 requires a formal compatibility matrix: an N-2 Client against an N Host gets "Diagnostics only". The Gateway negotiated codecs 1 and 2 and rejected every other explicit version with `gateway/protocol-unsupported`, so a Client two generations behind was conflated with an unknown future version — both got "reject and upgrade", and no diagnostics admission existed at all.

## Current upstream boundary

`decodeRemoteRequest` in `packages/api/gateway/src/protocol.ts` selected the wire codec from an explicit `apiProtocolVersion` of 1 or 2 (absent metadata means the frozen protocol 1). `host/negotiate` picks the highest shared codec from positive integer offers. There is no notion of an admitted-but-degraded tier.

## Decision

`apiProtocolVersion: 0` becomes the explicit diagnostics-only announcement: the request rides the frozen protocol-1 codec (`LEGACY_DISCOVERY_PROTOCOL_VERSION`) and `decodeRemoteRequest` returns `diagnosticsOnly: true` alongside the codec. Gateway admission enforces the tier on both dispatch paths: only the read-only Host discovery endpoints (`host/describe`, `host/negotiate`, the fixed `DIAGNOSTICS_ONLY_ENDPOINTS` set) pass; business RPC, streams, and event-result settlement reject with `gateway/protocol-unsupported` carrying the same endpoint and `supportedApiProtocolVersions` details, so Clients present the ordinary `incompatible` upgrade guidance. Unknown versions (3, -1, 1.5, non-numbers) reject exactly as before — "Unknown → Reject + upgrade" stays distinct from "N-2 → Diagnostics only".

## Alternatives considered

A dedicated failure code for tier rejection was rejected: it would ripple through the sealed Remote failure envelope schema, the Kotlin and Swift mirrors, and every projection for no Client-visible gain — the existing compatibility class already maps to the `incompatible` connection state. Admitting the tier through `host/negotiate` offers was rejected: negotiate selects a full codec, and a diagnostics-only Client negotiating itself into one would invert the matrix row. Making the endpoint set configurable was rejected: the tier boundary is a protocol invariant of section 14, not a deployment choice.

## Contract

`decodeRemoteRequest(endpoint, payload)` returns `{ version, payload, diagnosticsOnly }`; version remains the wire codec and is 1 for the diagnostics tier. `DIAGNOSTICS_ONLY_PROTOCOL_VERSION` is 0 and `DIAGNOSTICS_ONLY_ENDPOINTS` is `host/describe` plus `host/negotiate`. Both `dispatchRpc` and `openWireStream` reject tier requests outside that set before any business effect. `host/negotiate` keeps requiring positive distinct integer offers.

## Persistence

None; protocol selection is per-request and leaves no stored state.

## Security

Tier admission grants no authorization: the admitted endpoints are the read-only Host discovery namespace, and request metadata was never authorization. A tier request to any other endpoint fails before dispatch, so no tool side effect or interaction settlement can run.

## Compatibility

Codec 1 and 2 negotiation, absent-metadata behavior, and unknown-version rejection are unchanged; the only observable change is that explicit 0 no longer throws at decode. The failure code, details shape, and connection-state mapping are untouched, so the envelope schema and the Kotlin/Swift mirrors stay byte-identical.

## Failure handling

A tier request beyond Host discovery fails with `gateway/protocol-unsupported` and the message "Remote request API protocol is limited to diagnostics on this Host; update the application before reconnecting". `host/negotiate` from a tier Client still validates offers as positive integers, so `[0]` offers fail as invalid arguments rather than negotiating.

## Testing

Gateway suite 432/432 (11 files): protocol decode admits 0 on the legacy codec with the clean-envelope stripping rules, malformed 0-envelopes stay raw, unknown versions reject; RPC admission rejects tier requests to business and event-result endpoints with the limited-diagnostics message while a tier `host/describe` reaches method dispatch; stream admission rejects tier opens of `$events` and business streams with the same tier message. Host description suite 9/9 unchanged.

## Rollout

Source and tests only; no configuration, wire format, or schema change.

## Rollback

Revert the tier branch in `decodeRemoteRequest` and the two admission checks; explicit 0 rejects as an unknown version again.

## Consequences

The section 14 matrix is now enforced row by row: N/N full, N/N-1 negotiated, N-2 diagnostics-only through Host discovery, unknown rejected with upgrade guidance. A frozen Client can always read Host facts to tell its user why business features are unavailable.

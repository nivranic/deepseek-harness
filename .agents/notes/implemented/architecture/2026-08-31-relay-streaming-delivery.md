# Agent Note: Relay Streaming Delivery

Status: implemented

English | [中文](2026-08-31-relay-streaming-delivery.zh.md)

## Problem

The rendezvous foundation delivered by drain-poll only: a device had to ask repeatedly to learn anything arrived, and the deployed shell had never been executed (its handler wrote responses onto the request object — every call would have thrown). Chapter 68 keeps the relay as forwarding only, so the growth step had to add delivery, not authority.

## Decision

Poll delivery grows into streaming delivery over the same HTTP vocabulary, symmetric on all three sides. `GET /relay/stream?token=…` answers `application/x-ndjson`: connect flushes the device's pending queue as its first lines, then the connection stays open and every live publish arrives as one line. A device with an open stream receives envelopes live and keeps nothing queued — publish writes to open streams instead of the offline queue, so poll and stream never double-deliver; an unknown token gets the definitive empty answer poll gives (headers, zero lines, clean close). The shell (`apps/relay/server.mjs`) carries the semantics and is now locally smoke-verified end-to-end (offline queue → connect-flush → live push → empty poll afterwards), with the request/response object bug fixed. The device cores consume it symmetrically: Android `RelayClient.stream(token)` returns a `Flow<RelayEnvelope>` (response-head timeout only, the body stays unbounded); Apple gains the full `RelayClient` (register/publish/poll/stream over URLSession, `RelayEnvelope`/`RelayDevice` now Codable) with `stream(token)` as an `AsyncThrowingStream` over `bytes.lines`. Both lanes prove the consumer against a real local socket server — Android its JDK `HttpServer` (chunked, held open between scripted lines), Apple a minimal hand-written HTTP/1.1 server over `NWListener` (the first real-socket test in the Apple tree; URLProtocol stubs cannot deliver a body incrementally).

LAN-direct stays the primary transport; the stream is still the rendezvous path, not a `RelayTransport` in the link client.

## Consequences

A connected device now learns of a reference envelope the moment it is published, without polling; offline devices still drain by poll on reconnect. Remaining for the relay lane: presence subscriptions, TLS/Noise at the shell, and APNs/FCM delivery filling the push-token slot — the stream gives that delivery its live path.

## Alternatives considered

WebSocket for the stream was rejected — the pinned vocabulary is HTTP/NDJSON (the link carrier streams the same way), and a zero-dependency shell cannot carry a WebSocket handshake without vendoring a protocol. Queueing envelopes for streaming devices too (deliver-everywhere, dedupe on reconnect) was rejected — duplicate suppression would move the relay toward delivery authority it must not hold; live-or-queued is per-device and total.

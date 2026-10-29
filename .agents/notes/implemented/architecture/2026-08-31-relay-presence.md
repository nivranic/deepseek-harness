# Agent Note: Relay Presence From Open Streams

Status: implemented

English | [中文](2026-08-31-relay-presence.zh.md)

## Problem

Chapter 69 names presence among the rendezvous concerns, but nothing derived it: a device could not learn whether another device of the account was reachable, and the roster was blind to who holds a stream. The derivation source already exists — streaming delivery keeps one open connection per online device — so presence had to read that state, not invent a second channel.

## Decision

Presence is derived from open streams, never tracked separately: a device is online while it holds at least one stream open. The shell serves two faces over the same state. `GET /relay/presence?accountId=…` answers the account roster `[{deviceId, platform, online}]` in registration order; an unknown account lists nothing. When a device's first stream opens (after the connect flush) or its last stream closes, every other open stream of the same account receives one line `{"type":"presence","deviceId":…,"online":…}`. Stream lines stay bare reference envelopes otherwise — the `type: presence` key is the only discriminator, so envelope decoding is unchanged on poll and stream. Presence lines are ephemeral by design: never queued for offline devices, which read the roster instead — the relay keeps no presence history and holds no authority. Both clients consume symmetrically: `RelayStreamEvent` (envelope | presence) is the stream element on Android (`Flow`) and Apple (`AsyncThrowingStream`), and `RelayPresence` decodes the roster on both. A presence line without a `deviceId` fails loud at the wire boundary on both sides.

The shell is locally smoke-verified end-to-end: roster flips as streams open, same-account streams receive the online/offline pair on connect/close, the account next door stays isolated. Both lanes prove the clients against real local socket servers (Android its JDK `HttpServer`, Apple the NWListener HTTP server extended with raw-line and fixed-body scripts).

## Consequences

A connected device now sees its account's devices come and go live and can read the roster on demand; the push-delivery step can use the same online state to skip APNs/FCM for streamed devices. Remaining for the relay lane: Noise TLS at the shell, APNs/FCM delivery filling the push-token slot, and background wake.

## Alternatives considered

Queueing presence lines for offline devices (deliver-everywhere semantics) was rejected — presence is only meaningful live, and a queued "online" line on reconnect would be a lie. A separate presence-subscription endpoint was rejected — the stream a device already holds is the subscription; a second channel would duplicate connection state the rendezvous must keep minimal. Heartbeat-based liveness was rejected for now — an open TCP stream is the honest PoC signal; keepalive refinement belongs with TLS.

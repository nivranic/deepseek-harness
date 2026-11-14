# Agent Note: Host-side device carrier termination (§29)

Status: implemented

English | [中文](2026-10-02-gateway-device-termination.zh.md)

## Problem

The session-location-facts generation proved that a deterministic device-level outage was impossible with the lane toolset: removing the adb reverse is undetectable by an idle follow stream (no application keepalive reaches the WebSocket control layer), a same-Session reopen reuses the live stream, and even a fresh connect through the removed tunnel succeeded while the Host still held an ESTABLISHED socket pair. The verdict — a deterministic outage needs a Host-side stream-termination primitive — is the gap this increment closes: the Gateway had no host-plane management surface at all; the only per-device stream endings were trust-level (revocation), which is the wrong semantics for a connection outage.

## Decision

- `RemoteStreamMuxConnection` now exposes itself to the stream opener as a narrow `RemoteStreamConnectionHandle` whose single `terminate()` destroys the carrier socket without a close handshake — exactly the physics of a dead carrier, which is what a real outage looks like to the client.
- The Gateway binds a physical connection to a device when an admitted stream opens on it (business streams after `admitRpcDevice`, the `$events` stream after `admitDeviceClient`) and unbinds when its admitted streams end. Several admitted streams on one socket share one handle; a set-identity guard keeps a stale unbind from removing a replacement entry.
- `terminateDeviceConnections({deviceId})` is a public host-plane service method: it destroys every live carrier bound to the device and returns the count. Admission and grants are untouched — this is connection hygiene, not revocation; the client follows its own reconnect policy. A device holding no live connections terminates zero.
- The Android companion needs no code change: its existing connection-state machine already reads carrier loss as a transport interruption, enters the reconnecting state for the reconnect delay, and re-opens `session/follow` on the same admitted identity. The new acceptance lane drives the primitive on a real AVD (the location-facts lane's dual-scaffold providers-only structure) and proves the settled facts line leaves for the reconnecting state word, then returns unchanged after the follow stream re-opens.
- The location-facts lane's impossible-outage comment and golden are corrected to point at the primitive and the new lane.

## Alternatives considered

- **Reuse device revocation to end streams:** revocation is a durable trust-state change requiring re-pairing; an outage lane must not consume trust state, and §29 online state is a connection property, not a grant property.
- **Stream-level error frames instead of socket destruction:** a logical `error` frame leaves the physical carrier alive, which is precisely the half-open shape the previous generation showed is undetectable on the device side.
- **An application-level keepalive:** would detect half-open carriers over minutes, not produce a deterministic outage for a lane or an operator.

## Consequences

- The primitive is host-plane only: it is not a typed Remote method, needs no capability entry, and is not device-callable.
- WS-layer heartbeats remain the slow passive detector; the primitive is the active operator/lane instrument.
- The Gateway package README documents the surface in both languages.

## Open work

- Real-device qualification of the outage cycle (§34 hardware); an operator-facing surface (CLI/host UI) can adopt the method when one exists.

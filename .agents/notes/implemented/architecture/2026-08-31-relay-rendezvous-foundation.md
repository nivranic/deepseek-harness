# Agent Note: The Relay Rendezvous Foundation

Status: implemented

English | [中文](2026-08-31-relay-rendezvous-foundation.zh.md)

## Problem

Chapters 68/69 deferred the relay while every push-path dependency hung on it: APNs/FCM delivery and background wake need something to deliver through, and nothing registered devices or forwarded anything. The plan's constraint stands: the relay must be rendezvous and forwarding only — never a session database, workspace replica, or authority — with the Windows/macOS host keeping full session authority.

## Decision

The minimal foundation is the rendezvous semantics, pinned symmetrically in both app cores: `RelayRendezvous` (in-memory, single-account per 69.1) registers devices — identity plus the `pushToken` slot APNs/FCM delivery will fill — publishes one reference-only envelope to every device of the account, and drains by poll in arrival order; accounts are isolated and unknown tokens drain nothing. The envelope is the chapter-70 minimized vocabulary (`kind`, `sessionId`, `eventId?`, `turn?`), and each side bridges it onto its push type (`asPush()` / `pushFromRelayEnvelope`) — the concrete dependency link push delivery rides. Android additionally ships the HTTP consumer (`RelayClient`: register/publish/poll) proven against a real local server backed by the rendezvous core; Apple's client seam arrives with the deployed service, its bridge tested in CompanionUI. `apps/relay/server.mjs` is the self-hostable shell: a zero-dependency Node service mirroring the pinned protocol for real deployments, TLS terminating in front.

LAN-direct stays the primary transport; chapter 68's warning is honored in structure — this is the rendezvous vocabulary and forwarding skeleton, not a `RelayTransport` wired into the link client.

## Consequences

Both lanes verify symmetric rendezvous tests (registration and fan-out with drain-retires-queue, account isolation, unknown-token emptiness) plus the envelope-to-push bridge (three kinds bridging, an unknown kind bridging to nothing); Android's real-server loop proves the HTTP consumer end-to-end. What remains for the relay lane: WebSocket streaming, presence subscriptions, TLS/Noise at the shell, and the APNs/FCM delivery that fills the push-token slot.

## Alternatives considered

Building the relay as a workspace package with its own CI was rejected — the plan pins single-account, few-device rendezvous; a zero-dependency shell plus the two pinned protocol cores is the right size. Wiring a `FutureRelayTransport` into the link client now was rejected — chapter 68 says not to build relay transport early; the rendezvous vocabulary and the shell keep the seam open without pretending it is live.

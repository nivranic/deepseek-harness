# Agent Note: The Relay Rendezvous Foundation

Status: implemented

English | [中文](2026-08-31-relay-rendezvous-foundation.zh.md)

## Problem

Chapters 68/69 deferred the relay while every push-path dependency hung on it: APNs/FCM delivery and background wake need something to deliver through, and nothing registered devices or forwarded anything. The plan's constraint stands: the relay must be rendezvous and forwarding only — never a session database, workspace replica, or authority — with the Windows/macOS host keeping full session authority.

## Decision

The minimal foundation is the rendezvous semantics, pinned symmetrically in both app cores: `RelayRendezvous` (in-memory, single-account per 69.1) registers devices — identity plus the `pushToken` slot APNs/FCM delivery will fill — publishes one reference-only envelope to every device of the account, and drains by poll in arrival order; accounts are isolated and unknown tokens drain nothing. The envelope is the chapter-70 minimized vocabulary (`kind`, `sessionId`, `eventId?`, `turn?`), and each side bridges it onto its push type (`asPush()` / `pushFromRelayEnvelope`) — the concrete dependency link push delivery rides. Android additionally ships the HTTP consumer (`RelayClient`: register/publish/poll) proven against a real local server backed by the rendezvous core; Apple's client seam arrives with the deployed service, its bridge tested in CompanionUI. `apps/relay/server.mjs` is the self-hostable shell for real deployments. It is separately deployed infrastructure rather than a Harness application: it mounts no Cordis tree, owns no Session authority or business Gateway, and persists no Harness business state; its in-memory device, queue, stream, and Noise-session records are ephemeral. The [single dsh launcher](2026-08-22-single-dsh-application-launcher.md) owns that classification, and the [Relay Noise transport](2026-09-01-relay-noise-transport.md) owns its encrypted transport.

LAN-direct stays the primary transport; chapter 68's warning is honored in structure — this is the rendezvous vocabulary and forwarding skeleton, not a `RelayTransport` wired into the link client.

## Consequences

Both lanes verify symmetric rendezvous tests (registration and fan-out with drain-retires-queue, account isolation, unknown-token emptiness) plus the envelope-to-push bridge (three kinds bridging, an unknown kind bridging to nothing); Android's real-server loop proves the HTTP consumer end-to-end. The [streaming delivery](2026-08-31-relay-streaming-delivery.md), [presence](2026-08-31-relay-presence.md), and [Noise transport](2026-09-01-relay-noise-transport.md) decisions own those extensions. APNs/FCM delivery that fills the push-token slot remains outside this foundation.

## Alternatives considered

Building the relay as a workspace package with its own CI was rejected — the plan pins single-account, few-device rendezvous; a zero-dependency shell plus the two pinned protocol cores is the right size. Launching the shell through a `dsh` profile was rejected — the relay does not compose Harness services and must not acquire a Cordis application lifecycle, business Gateway, or Session authority merely to share a launcher. Wiring a `FutureRelayTransport` into the link client now was rejected — chapter 68 says not to build relay transport early; the rendezvous vocabulary and the shell keep the seam open without pretending it is live.

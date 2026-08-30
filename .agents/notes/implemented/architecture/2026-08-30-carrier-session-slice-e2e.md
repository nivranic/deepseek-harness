# Agent Note: Carrier-level session slice e2e

Status: implemented

English | [中文](2026-08-30-carrier-session-slice-e2e.zh.md)

## Problem

The Phase 1 notes deferred one acceptance item: proving the real session stack — the shipped SessionController and the Remote stream plane — reachable through the real TLS carrier, rather than through probe services bound to the carrier's test harness. Until that ran, "Native Access + Existing Gateway" was proven only against test-owned Remotes inside the carrier suite and against the desktop gateway without the carrier in the composition e2e.

## Decision

`apps/cli/tests/link-session-slice.e2e.ts` boots the shipped base + desktop composition with the link rows' durable state pinned into the test home, then walks the LLM-free acceptance core over the wire: the `remote` settings switch binds the real carrier through the live bridge; a real Ed25519 device pairs through the pairing ingress; the paired device calls `session/list` through the carrier's shared `/api` chain and receives the composition's real session rows; the `$events` Remote stream opens over NDJSON (asserted at the response headers, then torn down — a Remote stream never ends on its own); and an interaction answer signed by the just-paired controller is refused with `forbidden`/`approval-disabled` before dispatch, because the independent approval switch is off — the plan's "can prompt never means can approve" rule enforced at the allowlist, not by the business layer. Flipping the switch back unbinds the carrier.

## Consequences

The remote slice's session, follow, and approval-authorization acceptance now runs against the composition a user actually ships, and the test doubles as the conformance target the Apple and Kotlin companions' state machines are checked against — everything it asserts on the wire is exactly what `dsh-link-client` and `SharedAppleRemoteCore` implement. Prompt and cancel stay out by design: they need model turns, which ride the snapshot harness's replay machinery, not a composition boot; pulling that in is a separate decision about where replay profiles compose.

## Alternatives considered

Driving the same sequence from the Swift core's tests was rejected for this increment — no compile lane exists yet on this host or CI. Extending `desktop-composition.e2e.ts` instead of a new file was considered: the composition e2e asserts a cold-boot roster, and binding a real TLS listener plus pairing inside it would couple its boot-time assertions to carrier lifecycle noise; the slice owns its own boot with the two extra config pins instead.

# Agent Note: Device-trust revocations leave through the ops telemetry outlet under their own consent kind

Status: implemented

English | [中文](2026-10-06-device-trust-outlet.zh.md)

## Problem

Section 44's remaining non-session telemetry outlets land with their producers. The deviceTrust kind already had its local facts — every revocation updates the durable grants table and emits `deviceTrust/grantsRevoked` — but no egress: nothing left the process, and the consent record's `deviceTrustMetadata` switch had no producer to gate.

## Decision

1. **Producer side** (`packages/api/device-trust/src/index.ts`): `revokeDevice` and `revokeAllDevices` (only when a revocation actually happened — a no-op revoke-all mirrors the event condition and reports nothing) push one ops record — `channel:'ops'`, severity info, `attributes['telemetry.op']='device-trust-revocation'`, `body` carrying `revokedAt` and `deviceCount` — through an optional structured owner resolved at the revocation call via `ctx.get('sessionTelemetry')`. The record never carries device ids, fingerprints, roles, or key material: device ids are quasi-identifiers, and count plus time is the narrowest honest payload. Owner absent or the kind withheld: silent zero calls, zero exceptions, the revoke RPC's behavior unchanged.
2. **Consent timing**: unlike the crash recorder (a boot-once event that snapshots the owner at construction), revocations are runtime events — the owner is resolved at emit time, and the consent it exposes is the telemetry service's own construction-frozen field, so restart semantics hold without composition-order coupling.
3. **Outlet side** (`packages/session/session-telemetry-otel/src/index.ts`): the provider construction gate widens to `sessionTelemetry || crashDiagnostics || deviceTrustMetadata` (load-time validation — exporter.url above all — now reaches deviceTrust-only opt-ins); ops emission is created when either ops-producing kind is on (the per-class widening the crash generation announced); the fiber-teardown self-drain owns any non-session composition; `mode: DISABLED` remains the master breaker.
4. **Zero runtime dependency** (`device-trust/package.json`): `dsh-session-telemetry` is a type-only dev dependency; the producer's kind check is a local `deviceTrustMetadata === true` specialization with the authoritative `telemetryKindAllowed` named in its comment, mirroring the recorder precedent.
5. **Severity**: info, not the crash outlet's error — a revocation is a deliberate operator security action, not a fault.

## Alternatives considered

- **Emitting device ids**: rejected — quasi-identifiers; `deviceCount` plus `revokedAt` is the narrowest payload that still says what happened.
- **Extending to admission, pairing, or rename**: rejected for this slice — admission emits no cordis event today, and inventing one widens the seam for no §44 requirement; revocation is the security-relevant fact.
- **A construction-time owner snapshot like the recorder**: rejected — revocations are runtime events; the service registry is static once loaded, so the emit-time lookup is cheap and free of composition-order coupling while consent stays restart-scoped.
- **A cordis event as the transport**: rejected for now — zero runtime dependency and the lazy-get family keep the seam smaller, per the crash-outlet precedent.

## Consequences

A deployment that opts the deviceTrust kind in now reports revocations off-process through the ops scope, with url validation and the shutdown deadline applying as they do for session telemetry; the base bundle's consent comment names the kind's producer (still default-off). providerMetadata and relayMetadata stay pending their producers (relay blocked on §23; the provider attribution-headers semantics ruling deferred to that kind's outlet generation). In passing, the device-trust client leaf tsconfig is corrected to reference the two storage projects it imports — a pre-existing gap masked by stale tsbuildinfo, surfaced by this generation's `tsc -b`. The loader-composition e2e pre-existing baseline failure remains pinned as an open channel.

## Open follow-ups

- providerMetadata outlet and the attribution-headers semantics ruling (including the usage double-egress boundary with the sessionTelemetry kind).
- relayMetadata outlet (blocked on §23).
- A `DSH_TELEMETRY_CONSENT` setter for the loader-composition e2e (open channel above).
- §56 build-revision injection wiring.

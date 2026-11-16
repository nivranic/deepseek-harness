# Agent Note: Crash diagnostics leave through the ops telemetry outlet under their own consent kind

Status: implemented

English | [中文](2026-10-06-crash-diagnostics-outlet.zh.md)

## Problem

Section 44's four non-session telemetry outlets land with their producers. The crash kind already had its local source — the diagnostics recorder detects unclean shutdowns at boot and keeps a durable crash log — but no egress: nothing ever left the process, and the consent record's `crashDiagnostics` switch had no producer to gate. The telemetry seam's doc had promised dual instrumentation scopes (ledger and ops records in separate logger scopes) since its inception, but the OpenTelemetry backend built a single scope and dropped every direct record on the floor.

## Decision

A producer-push outlet with an optional structured owner, plus the outlet-side narrowings the seam had already promised:

1. **Producer side** (`packages/api/host-diagnostics/src/recorder.ts`): when boot detection finds an unclean-shutdown crash fact, the recorder pushes one ops record — `channel:'ops'`, severity error, `attributes['telemetry.op']='diagnostics-crash'` (the discriminator the coordinator's agent-error/shutdown ops precedent uses), `body` carrying the recoverable `pid`/`runStartedAt` fields — through an optional owner snapshotted once via `ctx.get('sessionTelemetry')` (the package's existing lazy-resolve family). Owner absent or the kind withheld: silently zero calls, zero exceptions — the §44 default is off, and unlike a user submitting feedback that goes nowhere, a withheld crash report is no perceptible loss, so no warning. Only the fact this boot detected is sent; history is never re-reported (re-sending would duplicate every crash once per boot, and marking facts reported would change the crash log's semantics). The runtime agent-error ring, which carries message text, stays local — smallest egress surface first.
2. **Outlet side** (`packages/session/session-telemetry-otel/src/index.ts`): the provider construction gate widens from `sessionTelemetry` alone to `sessionTelemetry || crashDiagnostics` (load-time validation — exporter.url above all — now reaches crash-only opt-ins); a dedicated `/ops` logger scope is added, honoring the seam's dual-scope promise; the direct-emit override narrows from dropping everything to dropping `channel:'ledger'` direct records while passing `channel:'ops'` records into the ops scope — and ops emission is itself created only when the crashDiagnostics kind is on, making the backend gate symmetric with the construction gate and with the producer's own check. In crash-only compositions no coordinator drains the provider, so a fiber-teardown effect calls `shutdown()` (bounded by the shutdown deadline, failures contained with a warning) — crash records must not die with the process. `mode: DISABLED` remains the master breaker: no SDK state, zero egress, consent still resolved. The feedback-withheld warning moves to the "sessionTelemetry off" branch, unchanged in meaning.
3. **Zero runtime dependency** (`host-diagnostics/package.json`): `dsh-session-telemetry` is a type-only dev dependency; the producer's kind check is a local `crashDiagnostics === true` specialization with the authoritative `telemetryKindAllowed` named in its comment — the emitted declaration surface carries no import of the telemetry package (verified on the built `lib/types/recorder.d.ts`).

## Alternatives considered

- **Reusing the capture coordinator**: rejected — `captureSession` is Session-bound and the deployed mode registers no listeners; the coordinator's own ops precedent (`relayAgentError`) delivers directly to the backend, which is exactly the channel adopted here.
- **A cordis event as the transport**: rejected for now — zero runtime dependency and the existing lazy-get family keep the seam smaller; an event declaration can replace the direct call later without changing either side's tests.
- **Re-reading settings at emission time**: rejected — `applies:'restart'` means the construction-time snapshot is the consent of record; mid-run toggles must not leak egress the user just turned off.
- **Egressing the error ring too**: rejected for this slice — messages are free text; crash facts (pid, timestamp) are the narrowest honest payload.

## Consequences

A deployment that opts the crash kind in now reports unclean shutdowns off-process through a dedicated ops scope, with the url validation and shutdown deadline applying as they do for session telemetry; the remaining three outlets stay pending their producers (relay blocked on §23; the provider attribution-headers semantics ruling deferred to that kind's outlet generation). The loader-composition e2e has a pre-existing baseline failure unrelated to this change (no `DSH_TELEMETRY_CONSENT` setter exists anywhere, and the Windows source-launch form does not materialize `.sessions`) — pinned as an open channel.

## Open follow-ups

- providerMetadata outlet and the attribution-headers semantics ruling.
- deviceTrustMetadata outlet.
- relayMetadata outlet (blocked on §23).
- A `DSH_TELEMETRY_CONSENT` setter for the loader-composition e2e (open channel above).
- §56 build-revision injection wiring.

# Agent Note: Loader-composition e2e turns green — consent point plus activation-order determinism

Status: implemented

English | [中文](2026-10-08-loader-composition-e2e.zh.md)

## Problem

The loader-composition e2e (`packages/session/session-telemetry-otel/tests/loader-composition.e2e.ts`, host config `vitest.e2e.config.ts`) sat red at 3-of-4 since its introduction, carried as an open channel across generation reports. Two causes, one known and one unlocated until now: (a) the fixture driver never set `DSH_TELEMETRY_CONSENT`, and the shipped headless profile gates every telemetry class behind `process.env.DSH_TELEMETRY_CONSENT === '1'` (`packages/bundle/base/cordis.patch.yml`), so the collector recorded nothing; (b) on win32 under the tsx source launch, the fixture's `.sessions` directory never materialized — the session silently never reached the jsonl backend.

## Decision

1. The driver fixture sets `DSH_TELEMETRY_CONSENT = '1'` — the e2e now exercises the consent gate the §44 runtime seam actually ships.
2. The missing-persistence root cause is a loader activation-order race, located with an in-subprocess timeline: same-group entries start concurrently (`vendor/loader/src/config/group.ts` `Promise.allSettled`), and under win32+tsx the agent-loop's config agent was created ~840ms before the session-persistence-jsonl backend activated. `createStoredSession` then saw `ctx.get('sessionPersistence') === undefined`, kept the session in memory, and the backend's event listeners no-op'd silently — a clean exit with zero writes. The fixture pins the order with the repository's existing row-level `inject` mechanism (`agent-loop` declares `inject: [sessionPersistence]`, the same pattern the shipped headless bundle uses for `headlessStartup`): the fiber stays PENDING until the backend activates. Production profiles are unaffected — their agents are created after boot through the registry factory, never racing the backend.

## Alternatives considered

- **Making the fixture await backend readiness explicitly (delay/retry in the driver)**: rejected — papers over the ordering with wall-clock hoping; the inject dependency states the requirement.
- **Changing `createStoredSession` to wait or re-resolve persistence later**: rejected — production never observes the race (registry-created agents), and softening the seam for a fixture's platform timing widens product behavior.
- **Pointing the fixture at an absolute session root**: irrelevant — nothing was written to any root; the handle never existed.

## Consequences

The e2e passes 4-of-4 and the package suite stays green (72/72). The `.sessions` overlay now materializes on win32+tsx, the telemetry captures assert with consent on, and §44's ledger closes its loader-composition sentence with the delivered narrative and the two fixture files as evidence. A sibling channel surfaced by the diagnosis stays open: `packages/context/time-context/tests/time-context.e2e.ts` uses the same `.sessions` overlay pattern and shows the same platform-timing red — same class, different package, left untouched here.

## Open follow-ups

- The time-context e2e same-class race (its own fixture needs the same inject pin or an equivalent deterministic order).
- Linux and built-lib launch forms of the loader composition were not re-verified locally (win32+src was the red host); CI covers the Linux leg.

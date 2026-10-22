# Agent Note: The live tool-catalog fetch has a real-Host e2e lane

Status: implemented

English | [中文](2026-10-22-live-catalog-e2e.zh.md)

- Date: 2026-10-22
- Class: testing
- Scope: `apps/web/tests` (`android-tool-catalog.e2e.ts`), `apps/android/core` (`NativeGatewayDriver.kt`, `LiteHostCatalogWatchTest.kt`)

## Problem

The tools plugin had served the §32 live catalog since its landing — the base bundle mounts the registry, `packages/core/tools/src/index.ts` registers the `tool.catalog.v1` capability, and the `@Remote list()` operation projects the global view — yet every existing e2e paired and negotiated without ever calling `tools/list`. The Kotlin client's strict parse, its per-negotiation cache, and the retain-last-success watch were proven only against controlled JVM TLS fixtures, so the host-side broadcast → Kotlin parse → cache → assertion loop had no end-to-end evidence.

## Decision

Close the loop as one owner-local scenario. `apps/web/tests/android-tool-catalog.e2e.ts` follows the `android-gateway.e2e.ts` template — real web scaffold over the native-remote overlay, the compiled production Kotlin driver, `deviceTrust.issuePairing('viewer')`, then the new `toolDescriptors` driver op. One composition fact shapes the scenario: the shipped Web composition parks every model-facing tool behind preset realms, so its global catalog serves an empty list; the scenario passes the scaffold's existing `cordisTools: true` insert, which gives the global view the shipped `cordis_*` tool ids to serve. The scenario asserts the fetched descriptors deep-equal `ctx.tools.list()`, that every fetched id carried by the generated `packages/core/tools/tool-descriptors.json` projection declares identical fields, and — through the `android-capability-presentation.e2e.ts` `vi.spyOn` technique on `typertGateway.invoke` — that exactly one `tools/list` request reaches the Host while a repeated op answers from the Kotlin client's cache. The driver op lives in `NativeGatewayDriver.kt` (test source set, ~15 lines): it re-serializes the parsed descriptors, keeping null and the list distinguishable. Three JVM tests complete the gen-64 watch-semantics gaps in `LiteHostCatalogWatchTest.kt`: a `CancellationException` from the wire propagates instead of becoming an observation, `WireDriving.toolDescriptors()`'s default answers null (the bundled-fallback path), and `SwitchableWireDriving` fetches through only the current delegate after `replace`.

## Alternatives considered

- Asserting against the plain Web composition's global catalog: honest but empty (tools sit behind preset realms), so it proves the pipe without proving the strict parse of real descriptors; the sanctioned Cordis insert serves shipped ids through the same shipped operation.
- A session-scoped catalog read: `tools/list` serves the global view only, so no Remote argument could reach a preset realm's tools.

## Consequences

- The scenario needs a Java 17 executable in `DSH_ANDROID_JAVA` and self-skips without it; CI never runs it (no such runner environment), matching the owner-local honesty of the neighboring Android e2e lanes. It stays keyless: no model round and no API key.
- `:core:test` grows from 605 to 608 tests (85 suites) with the three watch tests; the production source sets are untouched.
- The empty-global-catalog fact of the shipped Web composition is now recorded here; a future composition that mounts tools globally can drop the `cordisTools` insert and keep every other assertion.

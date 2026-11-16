# Agent Note: Per-kind telemetry consent joins the settings layer with five independent switches

Status: implemented

English | [中文](2026-10-06-telemetry-consent-settings.zh.md)

## Problem

Section 44 forbids a telemetry UI that hides the data kinds behind a single "Telemetry" master switch, and requires the five kinds to be distinguished (session telemetry / provider metadata / relay metadata / Device Trust metadata / crash diagnostics). Until now the per-kind consent lived only in the composition layer: the `Config.consent` five booleans of `dsh-session-telemetry-otel` (default all off), resolved once at plugin construction. There was no user layer and no UI of any kind — a client-tree-wide search found zero telemetry surfaces.

## Decision

Three deliveries:

1. **The `telemetry-consent` settings namespace**, registered by the `dsh-session-telemetry-otel` backend (today's only deployment entry and only consent consumer). The schema is five booleans `default(false)` with no master key; the vocabulary (`TELEMETRY_DATA_KINDS` tuple and `TELEMETRY_CONSENT_NAMESPACE`) is exported from `dsh-session-telemetry` as the single source of truth, and the schema is built by the registrant from the kind tuple so the Service Definition package does not gain a schemastery dependency. Registration carries the composition-layer `Config.consent` as `base` and declares `applies: 'restart'` honestly — the SDK pipeline gate stays at construction (rebuilding a `BatchLogRecordProcessor` mid-flight has undocumented shutdown/drain interactions, the same family of reasons flush() is not implemented), so a UI change takes effect at the next launch.
2. **Construction-time resolution order user > base > schema defaults** (the settings seam's native layering), with `scope.get()` funneled through `resolveTelemetryConsent` (fail-closed: an absent kind is off). When the settings service is not composed the backend lazily falls back to the composition layer (following the gateway `ctx.get('deviceTrust')` lazy-resolve precedent — an absent service is a legitimate composition, not a misconfiguration). `DISABLED` mode registers no namespace: a disabled backend has no live consent face, and the UI renders nothing for an absent namespace.
3. **The new package `dsh-client-ui-settings-telemetry`**: five independent `Switch` controls (`TELEMETRY_CONSENT_KINDS` pinned by `satisfies readonly TelemetryDataKind[]`) with no master switch anywhere (the test asserts exactly five controls in the tree); a missing namespace renders null (§13: UI appears only when the capability exists); writes go through the scope's latest-revision fence and serialized queue (no explicit `expectedRevision` — pinning the rendered revision would turn two quick toggles into a false conflict; conflicts surface as the host's re-read value plus an inline `role="alert"`); a read-only document disables every control with lock copy; the restart hint and the five per-kind descriptions are locale-owned in both languages. The web-app bundle's plugin row and dependency are registered.

## Alternatives considered

- **Runtime gate migration** (reading consent per capture, or rebuilding the SDK pipeline on change): rejected — the pipeline-rebuild interaction with shutdown drain is undocumented, and `applies: 'restart'` is the field the settings seam provides for exactly such an owner; declaring it honestly beats a risky migration.
- **Consent schema in the Service Definition package**: rejected — it would pull a schemastery runtime dependency into `dsh-session-telemetry`; exporting the kind tuple and letting the registrant build the schema keeps the coupling minimal with the vocabulary still single-sourced.
- **Explicit expectedRevision CAS in the UI**: rejected — the scope write path already fences on the newest mirror revision and serializes; an explicit revision number introduces false conflicts.
- **A master switch with collapsible sub-options**: forbidden verbatim by section 44.

## Consequences

Users can turn each telemetry kind on or off through the settings document (hot-reloaded document, effect at next launch); the composition-layer seed semantics are unchanged (`DSH_TELEMETRY_CONSENT=1` still seeds the base layer); deployments without the settings service behave exactly as before; the four non-session kinds' telemetry outlets still land with their producers — crash has its local recorder already and awaits its outlet; relayMetadata is blocked on §23; whether provider attribution headers count as telemetry is a ruling left to that kind's outlet generation.

## Open follow-ups

- crashDiagnostics outlet: the local recorder → OTel records + the `telemetryKindAllowed('crashDiagnostics')` gate.
- providerMetadata outlet and the attribution-headers semantics ruling.
- deviceTrustMetadata outlet.
- relayMetadata outlet (blocked on §23).
- §56 build-revision injection wiring.

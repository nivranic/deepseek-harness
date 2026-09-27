# Agent Note: Android support exports distinguish Native Gateway and legacy Link observations

Status: implemented

English | [中文](2026-09-27-android-native-gateway-diagnostics.zh.md)

## Problem

A support document cannot diagnose the current native connection if its only producer is the historical Link client. Reusing Link counters and protocol fields would also misrepresent HTTP callback ownership, shared mux subscriptions and API negotiation. Exporting a complete Host description would expose identities and arbitrary remote strings.

## Decision

`WireDriving` returns a sealed Native Gateway or legacy Link diagnostic variant. An absent owner is labeled `WireDriving` and unavailable. The direct Link library API remains separate. The support document keeps schema version 1: producer-labeled diagnostic sections gain a Native variant, while the scanner still admits immutable bytes without interpreting those sections. API protocol and durable Session versions remain independent fields.

The native snapshot reads local state under the existing lifecycle lock without requests, subscriptions or credential-store access. Its client-generation HTTP counters include pairing and negotiation, exclude mux traffic, saturate instead of overflowing, and finish only when owned callbacks settle. Registered logical subscriptions and retiring muxes have separate counts. Model-lifetime reconnect counters remain owned by each model.

Description refresh records query state and a fixed failure category. A failed refresh retains the last successful protocol observation; a retired client stays retired even when cancellation completes late. Pairing-time role and successful descriptions are labeled last-known: neither proves current permissions, Host health or continuing connectivity. Snapshot capture is independent of an explicitly requested refresh.

The exporter permits only typed roles, fixed failure categories, negotiated protocol facts and a client-owned capability allowlist. Unknown capability names, Host and device identities, display labels, product strings from the Host, endpoints, pins, credentials, payloads, paths and exception messages never enter these diagnostic sections. The application still requires the existing scanner's exact-byte approval before delivery.

The [transport decision](2026-09-25-native-remote-connection-source.md) retains ownership of TLS, admission and retirement. The [module migration decision](2026-09-19-android-core-app-migration.md) retains its independent build and scanner-admission rationale. Neither is superseded. Scanner source provenance and current release limitations are owned by the [Android README](../../../../apps/android/README.md#known-limitations-and-deferred-work).

## Alternatives considered

**Put native facts into Link fields.** Link request counts and protocol versions describe different operations. Explicit variants preserve their meanings and prevent two transport snapshots from being supplied simultaneously.

**Query the Host during export or dump its description.** A diagnostic read must remain available during transport failure and must not introduce requests. Full descriptions contain arbitrary remote strings and identities; a fixed projection gives up unknown capability detail to preserve the export's privacy rules.

## Consequences

Barrier-controlled HTTPS tests exercise pending callbacks, query cancellation, close with late completion, held mux subscriptions and quiescent retirement. Exact JSON expectations distinguish native, legacy and unavailable producers. Installed-app acceptance passes actual native observations through the bundled scanner, checks omission of private fields, and observes negotiation refusal/recovery and a test-owned logical follow interruption without business mutations. Physical devices, crash collection, full capability presentation and same-candidate scanner reproducibility remain separate qualification work.

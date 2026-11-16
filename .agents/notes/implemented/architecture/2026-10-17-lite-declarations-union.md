# Agent Note: Lite tool declarations ship as an APK-frozen union catalog

Status: implemented

English | [中文](2026-10-17-lite-declarations-union.zh.md)

## Problem

The permission gate's declared name domain had zero production data: `LiteToolCatalog.fromHostDescriptors` existed with no caller, and every production catalog was the hardcoded fallback table. The adjudicated blocker kept packaging deferred — the six bundled local names (`url_fetch`, `image_inspect`, `attachment_read`, `artifact_create`, `calculator`, `run_tests`) have no Host counterparts (four have none at all, one pair is a semantic mismatch), so packaging the Host projection alone would flip them to Unknown, an explicit failure for every local tool call; and renaming the local names to their closest Host ids would pressure `supportsLite` flips the Host does not execute. Section 32 requires every tool to carry a `ToolDescriptor` and forbids the device from guessing.

## Decision

Ship both documents as APK assets and union them. The app-owned device declarations (`apps/android/app/lite/lite-tool-declarations.json` — six rows, reviewable source, never downloaded; `web_search` stays out because the Host projection already declares it) and the Host's `tool-descriptors.json` projection both ride `copyLiteAssets` with `verifyLiteAssetSources` failing preBuild when either is missing or empty. `LiteToolSource` gains `BUNDLED` beside `HOST_DECLARED` and `BUNDLED_FALLBACK` — the sibling-catalog triple: a selection's source is an observable fact, and APK-frozen bytes are not a live Host negotiation. Both exhaustive `when` sites route `BUNDLED` through the unchanged four-gate ladder, and `fromBundledDocuments` adds the cross-document collision guard: a name declared by both documents has no honest arbitration, so the union fails loud naming the ids. The assembler composes the union; construction without the assets keeps the observable fallback. `run_tests` is authored not-lite at high risk — its handoff survives, the policy-facing reason changing while the emitted event stays the fixed `requiresFullRuntime` literal.

## Alternatives considered

Extending `tool-descriptors.json` with device rows was rejected: the generator boots real Host tool packages, and device ids would leak into the live `tools/list` domain served to paired clients. Renaming the local names to Host counterparts was rejected: only two of six have counterparts, `image_inspect` ↔ `read_image` mismatches semantically (local metadata versus decode-for-model-input), and the rename trips the mirror test's supportsLite-agreement clause, converting the drift guard into a forcing function for wrong Host-side flips. Packaging as declaration-only data without switching the dispatch catalog was rejected: the gate's declared data stays unwired and the stated goal unmet. Wiring `NativeGatewayClient.toolDescriptors` was rejected for this generation: the standalone session has no gateway in its path; the pull channel belongs to paired-host sessions.

## Consequences

Every bundled name's dispatch outcome is unchanged name-for-name — six local executions and the `run_tests` handoff — but they now stand on declared facts rather than the hardcoded table, and `LiteSessionFacts.toolCatalogSource` reports `BUNDLED`. The mirror test's frozen local-only set becomes the device document's owned names, with a test-side disjointness twin beside the runtime collision guard: a future Host tool named like a local name reopens adjudication loudly instead of silently colliding. The production executor remains a stub — the value is the event shape and the future-executor gating. The 2026-10-12 precondition (names align before any additional `supportsLite` flip) is closed.

## Open follow-ups

Real on-device executors for the local names; the paired-host pull channel (`NativeGatewayClient.toolDescriptors` is complete and unwired); the RelayClient shallow retirement; the support-export facts projection; the approval ask tier; the section 54 network matrix.

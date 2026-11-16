# Agent Note: The paired shell pulls the Host's live tool catalog

Status: implemented

English | [中文](2026-10-19-paired-host-tool-catalog-pull.zh.md)

## Problem

Gen-62 assembled the Lite dispatch catalog from the APK-frozen documents only: the device tool declarations unioned the bundled Host projection. Meanwhile `NativeGatewayClient.toolDescriptors()` — a complete per-negotiation-cached fetch with schema validation — sat with zero callers: a paired Host actually serving a tool catalog was invisible to the Lite face, which kept answering from the projection frozen at build time. The paired shell also had no Lite entry at all; the unpaired branch carried the only button, with its label hardcoded (a `verify-client-ui-i18n` violation waiting to fire).

## Decision

Open the pull channel through the wire seam. `WireDriving` gains `suspend fun toolDescriptors(): List<ToolDescriptor>? = null` as an interface default — stateless and unpaired wires have no Host to ask and answer null, which is the bundled-fallback path; `SwitchableWireDriving` delegates, and `NativeGatewayClient` marks its existing implementation `override` with its cache untouched. `HostToolCatalogObserver` follows the `HostDescriptionObserver` template (same `LaunchedEffect(paired, wire, lifecycleOwner, generation, refreshEpoch)` over `repeatOnLifecycle(STARTED)`, sharing the description-refresh epoch); the `LiteHostCatalogWatch` behind it is retain-last-success and keyed to one wire/Host generation: a null answer keeps the last successful declaration, a transport failure keeps it silently, a `BadWire` keeps it and raises the observable `badWire` flag (rendered as the `lite-catalog-badwire` locale-owned diagnostic line), and `CancellationException` propagates. The watch key deliberately excludes `refreshEpoch`, so a failed retry cannot flap the session back to the bundled union. On the catalog side, `LiteToolCatalog.fromDeviceAndLiveHostDeclarations` unions the device declarations with the live-served declaration under the existing `HOST_DECLARED` source value — no fourth enum value — and a Host that serves a catalog replaces the bundled projection wholesale; the cross-document collision guard is extracted into the shared `unionCatalog` so `fromBundledDocuments` stays a thin delegate with its message unchanged. `LiteSessionAssembler.assemble` takes `liveHostToolDescriptors` as an explicit resolve step (null keeps the frozen union), and `LiteChatFace` adds the live declaration to the `remember` assembly identity beside the preset — a genuinely new catalog assembles a new session. The paired shell's Scaffold gains the Lite entry: the button is extracted into `LiteEntryButton`, rendered by both branches over the same `lite_entry` locale key and `lite-entry` test tag.

## Alternatives considered

A fourth `LiteToolSource` value for the live union was rejected: `HOST_DECLARED` already names exactly "declared by the Host", and the distinction it would add (which document the Host side came from) is already observable through which constructor assembled the catalog. Re-pulling per session or per turn was rejected — one fetch per paired foreground entry plus the explicit refresh epoch matches the description observer's cost and freshness contract. Hot-swapping a live session's catalog on a new pull was rejected for the same reason a preset switch reassembles: the catalog is part of the session's identity (its facts name the source), so a changed catalog means a new session, and retain-last-success keeps that identity stable across retries. Silently falling back to BUNDLED on a schema-violating reply was rejected — the failure stays observable and the retained catalog stays in force, matching the fail-loud stance.

## Consequences

A paired Host that serves a tool declaration now owns the whole Host side of the Lite dispatch union, and the §31 permission gate walks the same declared gates over it; a session's facts disclose `HOST_DECLARED` when the live union assembled it. A real catalog change still means a new session (the assembly identity includes the declaration), which is honest: facts and prompt face follow the catalog. Real-Host end-to-end `tools/list` verification remains open — the pull is exercised against a scripted wire in JVM tests, the instrumented entry assertion compiles with `assembleDebugAndroidTest`, and the true Host round is e2e territory. Core JVM tests: 564 -> 572.

## Open follow-ups

Real-Host e2e of the catalog pull (the `NativeGatewayDriver` manual-test channel); catalog hot-refresh UI beyond the shared description-refresh epoch; instrumented execution of the new androidTest pair; the remaining three executors (`url_fetch`, `image_inspect`, `attachment_read`) and the in-turn multi-step continuation stay open from gen-62/63's ledgers.

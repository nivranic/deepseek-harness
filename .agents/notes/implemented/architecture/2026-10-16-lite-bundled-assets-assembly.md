# Agent Note: The app APK bundles the Lite projections and assembles standalone Lite sessions over them

Status: implemented

English | [中文](2026-10-16-lite-bundled-assets-assembly.zh.md)

## Problem

Section 31 requires the Lite runtime to own its tool catalog, and sections 32/33 produced that catalog's content: the persona projection (`lite-preset-descriptors.json`, the true-boot persona harvest) and the model-face projection (`lite-tool-schemas.json`, the supportsLite-filtered schema list). Both lived only as JVM test resources — `:contract` and `:core` copy them onto the test classpath for mirror tests, but a shipped APK carried neither, the `:app` shell had no assets directory at all, and no runtime code read either document. `LiteChatScreen` remained a dead UI with zero call sites: a standalone Lite session had no way to be constructed from real projection bytes, so a session assembled in the app would have run BARE with no tools array and no persona — the projection pipeline ended at the test classpath.

## Decision

The app build copies both projections into the APK. `copyLiteAssets` lands them under `assets/lite/` from the generating packages, `verifyLiteAssetSources` fails the preBuild when either source file is missing or empty, and the main source set's assets directory picks the copy output up. Loading is fail-loud by design: `LiteAssets.load(context)` opens both asset paths and parses them through the shared contract parsers, throwing on absence or malformed bytes — never silently falling back to BARE. The catalogs those bytes build carry their own `BUNDLED` source, a third value beside `HOST_PROJECTED` and `BARE` in both `LiteToolSchemaSource` and `LitePresetSource`: the entries are identical to a live Host projection parsed by the same document parsers, but the selection stays observable as the APK-bundled bytes rather than masquerading as a live projection or as no projection. `LiteSessionAssembler.assemble` builds the full `LiteChatViewModel` chain over them — the provider carries the bundled schemas as its request-face `tools` array, the preset catalog supplies the persona, and the dispatch catalog stays the bundled-fallback name domain, where the section 31 permission gate already refuses unknown names. The factory is construction only; mounting the view model into UI is deliberately not its concern.

## Alternatives considered

Tagging the bundled catalogs as `HOST_PROJECTED` was rejected: the source of a selection is a fact callers can observe, and APK-bundled bytes are not a live Host negotiation. A silent BARE fallback on missing assets was rejected: section 32 forbids guessing, and a session that quietly ships without its tools array hides a broken build. Bundling `tool-descriptors.json` alongside the two projections was cut from this increment: the standalone session is deliberately the fallback name domain (the permission gate's Unknown closure covers it), and Host-declared names belong to the paired-host channel a later generation wires. Mounting `LiteChatScreen` into `MainActivity` was cut the same way: assembly first, entry point later, so the UI change lands as its own reviewable increment.

## Consequences

The section 32 ledger's open item "app-layer runtime wiring (assets packaging)" and the preset-side twin in section 33 are closed: a shipped APK now carries the same projection bytes the JVM mirror tests cross-check, an instrumentation test opens both asset paths and walks the full assemble chain without touching the network, and `:core` tests pin that `BUNDLED` parses identically to `HOST_PROJECTED` under its own observable source. The standalone session's model face and persona come from Host-projected bytes frozen at build time — exactly what a local harness environment without a paired host can honestly claim to own. The permission posture is unchanged: the fallback name domain keeps unknown-name refusal, and no risk facts are invented on-device. The four-piece section 31 checklist now has a live surface to disclose `runtimeMode = lite` on, which remains the last open piece.

## Open follow-ups

Mounting the assembled session in the UI (a Lite entry point in `MainActivity`), the `runtimeMode = lite` disclosure on the now-existing session surface, the preset selection face, bundling tool declarations for a Host-declared name domain in the standalone app, and the interactive approval tier remain open.

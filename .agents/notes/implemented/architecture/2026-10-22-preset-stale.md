# Agent Note: A stale stored preset id renders an assembly failure line, not a crash

Status: implemented

English | [中文](2026-10-22-preset-stale.zh.md)

## Problem

The §33 preset face closed with `resolve` failing loud and the config form gating a stale pick off save — the form's own comment names the remaining gap: "a stale id gates save off until a valid option is picked, without its own error line." The assembly side had nothing at all: `LiteChatFace` ran `LiteSessionAssembler.assemble` bare inside its identity-keyed `remember`, so a stored `presetId` that went stale across an APK upgrade — the re-bundled preset projection no longer carries the id the sealed config names — made `resolve` throw inside composition and crash the Lite face. The config-load failure already had its own line; the assembly failure was the one failure the face could not survive.

## Decision

Hedge the assembly, render the failure, keep fail-loud. `LiteChatFace` wraps `assemble` in `runCatching` inside the same identity-keyed `remember`; when it throws, the face renders a `lite-preset-stale` error line carrying the new `lite_preset_stale` locale key with the exception text as its format argument — resolve's message (the stale id, the catalog source, the carried ids) reaches the user verbatim — and no catalog-source line or chat surface assembles. The reconfiguration entry above (`lite-config-edit`, the configured face's existing button) is the recovery: a saved valid preset bumps the revision, reloads the store, and re-runs the same assembly identity. Nothing else moved — `resolve` still throws and never guesses, the identity keys are unchanged, and the store-less preview face (whose null preset id cannot go stale) inherits the same hedge for its remaining asset-failure paths. The one string lives in `native_companion.xml`, the app's single locale file; bilingual coverage is this note pair.

## Alternatives considered

Silently falling back to the default preset on a stale id was rejected — the §33 no-guessing boundary is the point of `resolve`; this change converts the crash into a readable line, not into a silent substitution the user never chose. Swallowing the error and rendering the unconfigured empty state was rejected — an assembly failure would then read as "never configured," the exact conflation the config-load failure line already refuses. Silently assembling BARE — dropping the persona and running bare prompts — was rejected — a projection-carrying APK that quietly sends bare prompts is a request-face change no one selected. Guessing the nearest id (closest order, or the lexicographically lowest) was rejected — a wrong persona silently applied is worse than an honest failure that names both the stale id and the ids the catalog carries.

## Consequences

A configured device that upgrades past a dropped preset now lands on one readable line — the stale id named, the carried ids named, the recovery entry reachable — instead of a face-crashing throw. `LiteEntryNativeTest` grows to eight with a new stale-config case: the store is written through the real Keystore cipher with `presetId = "vanished-preset"`, and the assertions hold that the failure line renders naming both the stale id and the bundled `minimal`, the edit-config entry stays displayed, and no conversation surface assembles over the failed identity. All eight pass on emulator-5554. Core JVM tests stay at 608 across 85 suites and contract at 37 across 4 suites (an app-source-only change); the debug APK baseline drifts with the production UI change.

## Open follow-ups

The connected case injects the stale residue by writing the store directly; a real over-the-air upgrade path — an older APK's stored config meeting a newer APK's dropped preset — remains unqualified e2e territory. The runtimeMode disclosure text is still a hardcoded literal (gen-70's open item).

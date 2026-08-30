# Agent Note: The Android Lite Tool Registry

Status: implemented

English | [中文](2026-08-31-android-lite-tool-registry.zh.md)

## Problem

The embedded-host-runtime stage on Android had its fold foundation but no dispatch surface: nothing named the tools a Lite runtime may run, and the chapter-35/36 security stance — compile-time registration only, arbitrary execution handing off — existed only in the Apple LiteRuntime.

## Decision

`LiteToolRegistry.kt` in `apps/android/core` mirrors the Apple registry exactly: the chapter-36 P0 set bundles `web_search`, `url_fetch`, `image_inspect`, `attachment_read`, `artifact_create`, and `calculator` with their Chinese descriptions, while `run_tests` carries `LITE_REQUIRES_FULL_RUNTIME` as its fallback capability — the marker a Lite loop hands off on instead of executing, because a Lite runtime is shell-less by design. Lookup is a firstOrNull over the compiled list; an unknown name resolves to null and nothing else. There is no registration API at all, so a dynamically constructed name cannot become dispatchable.

## Consequences

`LiteToolRegistryTest` pins the stance: the bundled names in order, a non-empty description on every descriptor, by-name lookup returning the exact descriptor, `run_tests` as the only handoff (the on-device tools serve with a null capability), and unknown names — including near-miss prefixes like `web_search_exec` — resolving to nothing. The Android lane verified green. With the fold and the registry in place, the next embedded-runtime steps mirror the Apple order: the loop driver, persistence, and the chat surface.

## Alternatives considered

A registration API taking descriptors at runtime was rejected — chapter 36's whole point is that the tool surface ships with the app and is reviewable before release; a mutable registry would re-open the door the design closes. Reusing the companion's remote tool trajectory vocabulary was rejected — those are host-side tool names observed over the link, not a dispatch table; the registry is the on-device authority the future Lite loop will dispatch against.

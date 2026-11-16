# Agent Note: Lite session facts project into the support export's own device-plane segment

Status: implemented

English | [中文](2026-10-23-facts-export.zh.md)

## Problem

The 2026-10-16 note closed §31's fact vocabulary with `LiteSessionFacts` — the mode word, each catalog's source, the preset actually in effect, the bundled local tool names — observable on the device but ending at the UI disclosure line; its Open follow-ups named the remaining gap as the diagnostic projection of those facts into the support export. The support document already speaks a host-plane mode word (`protocol.runtimeMode` restates a paired Host's negotiated `full`), so a support bundle from a device whose working session is the standalone Lite one could carry a mode claim its own session never ran, with no segment naming what the device itself assembled.

## Decision

Project through the existing export infrastructure — no second channel, no new UI copy. `SupportLocalSnapshot` grows one nullable `liteFacts` field (null until a session assembles; every projection-less construction face keeps its existing call site), and `encodeSupportDocument` emits a `liteSession` object on the device-facts plane beside `localIdentity`: producer `LiteSessionAssembler`, observation `construction` (the facts were fixed when the session assembled — a snapshot restated, never a live re-read), the literal mode word, the dispatch-catalog source as its kebab-case selection word, the preset id actually in effect (the key omits when null — the role/value precedent — never a guessed id), and the bundled local tool names. No assembled session leaves the segment named in `uncollected` as `lite-session`. The wiring is parameter then store: `LiteEntry` takes an optional `onFacts`; `LiteChatFace` reports each assembly identity's facts — or null when the identity fails loud (a stale stored preset) — through a `LaunchedEffect` keyed on the assembly, so the export can never claim a session that did not assemble; the shell injects `model::publishLiteFacts`, and `CompanionViewModel.supportSnapshot()` carries the published facts into the one export action the shell already mounts on both its branches. The two planes stay separate segments: the Lite segment restates only what this device assembled and never reads Host describe results, while the host plane keeps its own negotiated words — one document can carry `protocol.runtimeMode = full` and `liteSession.runtimeMode = lite` side by side, each under its own producer.

## Alternatives considered

A journal event stays vetoed — the sixteen-tag closed set would tax a static construction fact, and chapter 64 keeps the journal to fold-visible turn outcomes. A pure UI label as the publication stays vetoed — §6's must-publish demands runtime facts, and a label without a fact source is only copy. Extending `NativeSupportDiagnostics` stays vetoed — that face republishes observed Host describe results, and folding the Lite self-description into it would blur exactly the host-facts and device-facts planes this segment keeps apart. An eighth tab stays vetoed — the tab bar exists only when paired, the opposite of the standalone runtime's main scene, and the projection needs no new surface at all.

## Consequences

`SupportExportTest` grows by one: the mapping test holds the segment's words, the omitted-key form for a null preset id, the `lite-session` uncollected name, and the two-plane pairing of the host `full` beside the device `lite`; the three export fixtures gain the `lite-session` uncollected entry. `SupportExportNativeTest` grows to three with a case feeding a real on-device `LiteSessionAssembler` assembly's facts through the scanned document; `LiteEntryNativeTest` grows to ten with two wiring cases (the assembled identity reports the BUNDLED dispatch union with `minimal` in effect; a stale-preset failure reports null). All pass on emulator-5554. Core JVM tests move 608 to 609 across 85 suites; contract stays at 37 across 4 suites; the debug and androidTest APK baselines both drift with the production core and app change.

## Open follow-ups

The facts ride the export only once the Lite face has assembled in this process — a cold process exporting before any Lite assembly honestly reports `lite-session` uncollected, and Lite usage history is not reconstructable from the bundle. `LiteSessionFacts`' schema-source and preset-source fields remain undisclosed in both the UI and this projection; they earn their own projection only if a second catalog source ever ships. The §41-44 support-collector work stays untouched by this segment.

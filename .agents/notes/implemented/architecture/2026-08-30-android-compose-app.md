# Agent Note: The Compose companion app

Status: implemented

English | [中文](2026-08-30-android-compose-app.zh.md)

## Problem

The Android core could pair and fold, but nothing shipped as an app: no pairing surface, no six-tab product face (plan chapters 52's module list), and the Minimal Neumorphic baseline existed only as tokens no UI read.

## Decision

The view models live in `core` as plain JVM classes over the `WireDriving` seam — `SessionModel` (list, open, incremental fold of snapshot-then-events, prompt with inline image uploads, cancel), `InteractionModel` (`$events` inbox deduplicated by event id, answered through `$events/result`), `FilesModel` (registry follow plus `workspaceFiles/list` level browsing), and `SubagentsModel` (flat listing, read-only child timelines by durable address) — each FakeWire-tested on the JVM lane. The `app` module is the thin Compose shell: a pairing screen pasting the QR payload through `LinkPayloadParsing`, the seven-tab `NavigationBar` scaffold (会话/审批/计划/工具/文件/工件/子代理), and a Material3 theme whose palette and raised-card treatment read the core `NeumorphicTokens`. minSdk 33 carries the JDK Ed25519 provider the signing needs. The lane grew `:app:assembleDebug` beside the JVM tests.

Core palette tokens are 32-bit ARGB values. Compose's `Color(ULong)` constructor reads a packed color with a color-space index, so the app explicitly decodes ARGB with `Color(token.toLong())`. An unpaired composition displays pairing without starting Remote push observation; after pairing, the push effect starts that subscription and stops it when the effect leaves composition.

## Consequences

JVM tests cover domain and wire behavior, while `:app:assembleDebug` checks the Android dependency graph; neither proves that Compose can render its first frame. `:app:connectedDebugAndroidTest` launches the real unpaired activity on Android, waits for asynchronous credential restoration, and requires the pairing heading to be visible. It grants notification permission to isolate the app startup assertion; the Android workflow runs it on an API 34 emulator and retains its reports. This check does not establish real-device networking, pairing, or permission-denial behavior. Current state observation belongs to the [StateFlow decision](2026-08-31-android-stateflow-projections.md), and wire restoration and process ownership belong to the [transport decision](2026-09-02-android-link-transport-and-stream-ownership.md).

## Alternatives considered

View models in the app module were rejected — the JVM lane would lose their tests to an emulator-only world. Testing only numeric ARGB tokens was rejected: it cannot detect Compose color-space decoding errors or execute the unpaired activity's effects.

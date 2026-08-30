# Agent Note: The Compose companion app

Status: implemented

English | [中文](2026-08-30-android-compose-app.zh.md)

## Problem

The Android core could pair and fold, but nothing shipped as an app: no pairing surface, no six-tab product face (plan chapters 52's module list), and the Minimal Neumorphic baseline existed only as tokens no UI read.

## Decision

The view models live in `core` as plain JVM classes over the `WireDriving` seam — `SessionModel` (list, open, incremental fold of snapshot-then-events, prompt with inline image uploads, cancel), `InteractionModel` (`$events` inbox deduplicated by event id, answered through `$events/result`), `FilesModel` (registry follow plus `workspaceFiles/list` level browsing), and `SubagentsModel` (flat listing, read-only child timelines by durable address) — each FakeWire-tested on the JVM lane. The `app` module is the thin Compose shell: a pairing screen pasting the QR payload through `LinkPayloadParsing`, the six-tab `NavigationBar` scaffold (会话/审批/计划/工具/文件/子代理), and a Material3 theme whose palette and raised-card treatment read the core `NeumorphicTokens`. minSdk 33 carries the JDK Ed25519 provider the signing needs. The lane grew `:app:assembleDebug` beside the JVM tests.

## Consequences

The lane is green end to end: 24 JVM tests (conformance, vocabulary, tokens, wire, signing, pinning, client round trips, and the four view models) plus a debug APK assembled over them. The fold's incremental form (`foldInto`) is new with this increment — live events fold onto the snapshot's state the way the Swift fold always did. Known skeleton limits: the models expose plain fields, so Compose re-reads on recomposition triggers rather than observing live state (StateFlow projections arrive with polish); relaunch re-pairs (the endpoint is not persisted). The lane's iteration rounds surfaced the usual first-contact facts: AndroidX needs `android.useAndroidX`, application ids cannot carry hyphens, `activity-compose` 1.9.10 was never published, material3 `NavigationBarItem` requires an icon, and `runTest`'s `backgroundScope` jobs never advanced before the assertions — the follow tests run unconfined so replay delivers synchronously.

## Alternatives considered

View models in the app module were rejected — the JVM lane would lose their tests to an emulator-only world. StateFlow everywhere now was rejected — plain fields keep the skeleton honest about its recomposition limits until the polish pass designs the observation.

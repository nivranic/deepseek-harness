# Agent Note: The thin Xcode app shells

Status: implemented

English | [中文](2026-08-30-xcode-app-shells.zh.md)

## Problem

Chapter 49's target structure named iOS and macOS Companion application hosts, but the package shipped libraries only — nothing launchable, and no target graph proving CompanionUI links as an app rather than a test bundle.

## Decision

`apps/apple/project.yml` declares the two application targets through XcodeGen: DSH Companion (iOS, iPhone+iPad via `TARGETED_DEVICE_FAMILY 1,2`) and DSH Companion (macOS companion), each a `@main` SwiftUI `App` whose whole body is `WindowGroup { CompanionRootView(client: nil) }` — the shell owns nothing; pairing-when-unpaired and the six-tab surface both live in CompanionUI. The generated `Companion.xcodeproj` is CI-local (gitignored; the lane regenerates it every run), so no generated artifact drifts in review. The Apple Swift lane grew three steps after `swift test`: generate the project, build the iOS scheme against the iOS Simulator destination, build the macOS scheme against the Mac destination.

## Consequences

Both shells build green on the lane against the same local package the tests exercise — the product surface is now a compilable app on both platforms, and any CompanionUI change that breaks app linkage fails CI. The lane's first run caught one cross-SDK fact: `SecCertificateCopyKey` returns a bare `SecKey` on the iOS SDK too (Xcode 26), so the platform split collapsed back to one call. The macOS direct-host target (chapter 49's fourth target) and richer viewers stay open; relaunch still re-pairs because the endpoint is not persisted (the standing single-host limitation).

## Alternatives considered

Committing the generated xcodeproj was rejected — it would need a freshness gate and reviews pbxproj noise for zero information over project.yml. SwiftPM executable targets were rejected — iOS app delivery needs a real app bundle and the plan names Xcode hosts.

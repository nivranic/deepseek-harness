# Agent Note: The Android Lite Runtime Foundation — a Trilingual Lite Domain Fold

Status: implemented

English | [中文](2026-08-31-android-lite-fold-foundation.zh.md)

## Problem

The Lite Behavior Spec (chapters 33/34/63) already had a TypeScript reference fold and a Swift mirror pinned by golden fixtures, but the Lite conformance artifacts never synced to Android and no Kotlin fold existed — so "same fixture, same domain state" was a two-language guarantee, and the embedded-host-runtime stage had no foundation on Android.

## Decision

`LiteFold.kt` in `apps/android/core` mirrors `foldLiteDomain` exactly: the 17-event lifecycle vocabulary folds into `LiteDomainState` (conversation rows with the interrupted marker, the streaming pane, the paired tool trajectory, plan/todo/artifact panes, the last turn end, recorded failures, and the pending handoff). The semantics that make Lite Lite ride unchanged: a cancel finalizes the delivered stream prefix as an interrupted assistant row only when text was delivered, a dropped transport keeps the partial for resume while a provider error clears it, tool results pair by id and tolerate orphans, and whole-value panes are last-write-wins.

The generator and its drift gate gained the Android lite destination: `gen-link-contracts` now writes the six `lite-conformance` fixtures into `apps/android/core/src/test/resources/lite-conformance`, and `verify-link-contracts` refuses drift there exactly as it does for Apple. The Kotlin `toJson` canonicalization matches the reference emission — the interrupted marker only where true, nullable ends as JSON null — so the replay compares structurally against the expected fixture bytes.

## Consequences

The Lite fold is now a machine-verified trilingual guarantee: `LiteConformanceTest` replays every synced fixture through the Kotlin fold and asserts the identical state, and `LiteFoldTest` pins the behaviors one at a time (cancel with and without delivered text, network-drop retention versus provider-error clearing, prompt-rejection recording, tool pairing with an orphan no-op, reasoning streaming into its own partial). The Android lane verified green. The next embedded-runtime steps on Android mirror the Apple LiteRuntime sequence on this foundation: the tool registry, the loop driver, and persistence.

## Alternatives considered

Reusing the companion fold's artifact type was rejected — the companion pane and the Lite runtime state are different domains that happen to share a wire vocabulary; separate types keep each fold honest to its own fixtures. Waiting to mirror the whole LiteRuntime at once was rejected — the fold is the conformance-bearing core; landing it alone makes every later driver mistake visible against pinned fixtures instead of against hand-written expectations.

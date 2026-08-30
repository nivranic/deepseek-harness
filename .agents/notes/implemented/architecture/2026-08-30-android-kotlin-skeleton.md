# Agent Note: The Android Kotlin skeleton and its lane

Status: implemented

English | [中文](2026-08-30-android-kotlin-skeleton.zh.md)

## Problem

Chapter 62's conformance promise names three languages, but the Kotlin leg existed only as generated text under `generated/` — never compiled, never tested, and generated with defects no consumer had ever caught. Chapter 52's Android companion had no module at all.

## Decision

`apps/android` opens as a Gradle build whose single module `core` is pure JVM Kotlin: the contract models sync from the drift gate (extending `gen-link-contracts`/`verify-link-contracts` with the Kotlin source, fixture, and conformance destinations under `apps/android/core`), the Kotlin domain-state fold mirrors the TypeScript reference and Swift fold exactly — same per-tag Chinese summaries, same UTF-16-unit-style number rendering, same image collection and tool pairing — and replays every golden scenario, and `NeumorphicTokens` pins chapter 60's Minimal-Neumorphic-only baseline as plain constants the future Compose module reads. Decoding uses kotlinx-serialization's annotation-free `JsonElement` tree parsing, so the runtime jar needs no compiler plugin and the generated models stay pure. The lane (`android-kotlin.yml`) runs `gradle test` on ubuntu-latest under JDK 17 / Gradle 8.14 with no committed wrapper.

## Consequences

The first consumer of the generated Kotlin caught two emission defects the byte gate could never see: enum entries lacked commas between members, and const-field trailing comments swallowed the separator comma that followed inside them — the text had never parsed. After the fixes, the lane is green: all four conformance scenarios fold identically, and the chapter-62 trilingual guarantee (TypeScript, Swift, Kotlin — same fixtures, same domain state) is machine-verified on all three legs. The Compose surface grows over `core` next.

## Alternatives considered

Emitting `@Serializable` annotations was rejected — it would bind every consumer of the generated models to the serialization compiler plugin for decoding the fold never needs. A committed Gradle wrapper was rejected — the setup-gradle action pins and caches the version without a binary jar in review.

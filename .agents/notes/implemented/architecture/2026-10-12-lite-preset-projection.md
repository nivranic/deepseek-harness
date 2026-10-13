# Agent Note: Lite persona reuses the official system prompt through a projected preset catalog

Status: implemented

English | [中文](2026-10-12-lite-preset-projection.zh.md)

## Problem

Section 33 forbids a parallel prompt system for Lite and asks it to reuse the official System Prompt assembly, composing context only through profile/preset. The Lite runtime had no prompt composition at all: the provider seam took a bare user string, the request body carried a single user message, and nothing persona-shaped existed in Kotlin — so any first step toward prompts risked hand-rolling exactly the parallel system the section forbids.

## Decision

The reuse channel is a generated projection, not Kotlin-side assembly. `scripts/gen-lite-preset-catalog.ts` really boots each shipped preset through the roster, composes its standing scope, and records the official `ctx.systemPrompt.assemble()` output beside the preset's declared persona row into the checked-in `packages/preset/agent-presets/lite-preset-descriptors.json` (`LitePresetProjection` in the package's `src/types.ts`); `verify-lite-preset-catalog` runs in `doc-sync` and `--check` reports the first differing line. A preset whose assembly still references runtime variables — the shipped `standard` and `ptc` templates over `{{model}}` and `{{cwd}}` — is carried in the file's `excluded` list with those variable names rather than faked into a static row, and a persona row declaring deferred (`!!js`) booleans fails the harvest: a static projection renders only literal values. The official assembly surface itself is untouched — no section orders, no persona plugin changes.

The Android side consumes the projection without owning any prompt text. `:contract` mirrors `LitePresetDescriptor` with the hand-written `JsonElement` parser (missing fields, mistyped values, duplicate ids, and an empty assembled prompt all throw; unknown future fields are tolerated), copied into test resources by a `copyLitePresets` task. `LitePresetCatalog` in `:core` is dual-sourced like the tool catalog: `HOST_PROJECTED` when the projection parsed, `BARE` when offline or absent, and `BARE` yields a null system prompt. `LiteProviding.stream(prompt, system = null)` grew the seam as an interface default parameter, so only the provider implementations changed; `LiteHTTPProvider` inserts one `{role: "system"}` message at the head of `messages` when the system string is non-null and otherwise produces a byte-identical request body. `LiteChatViewModel` picks the projection's lowest-`order` preset as its default and submits that assembled prompt. The fold and journal are untouched: the system prompt is request-face context, not a session event.

## Alternatives considered

A live Host broadcast (a persona `tools/list` twin) was rejected for this surface: presets are static shipped configuration with no dynamic producers — the reason the tool catalog required a live namespace does not apply — while the Lite loop runs hostless by design. Substituting documented placeholder values for `{{model}}`/`{{cwd}}` was rejected: a Lite prompt that lies about the runtime it renders for is worse than an exclusion. Rendering the persona prefix alone on-device was rejected: that would fork the assembly semantics (identity sections, completion) into Kotlin, recreating the parallel system.

## Consequences

Every shipped preset now has one authority for its Lite-visible prompt: the official assembly harvested at generation time, re-verified by `doc-sync`. Variable-dependent presets are visibly excluded rather than silently wrong. The Kotlin source carries zero prompt text — an enforced invariant of this increment — and the request-body change is additive, so a `BARE` client is byte-identical to the previous behavior (HTTP tests pin all three shapes). Deferred-expression booleans in a persona row now fail loudly instead of silently reading as `false`.

## Open follow-ups

A preset-selection surface for Lite (choosing among projected presets rather than the lowest `order` default), the app-layer runtime wiring shared with the tool catalog, the Lite tool-permission policy of section 31, and advertising the on-device tools to the model (the request body still carries no `tools` array) remain open.

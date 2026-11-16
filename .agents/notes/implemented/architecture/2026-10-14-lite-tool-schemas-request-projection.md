# Agent Note: Lite advertises tools to the model through a projected schema catalog

Status: implemented

English | [中文](2026-10-14-lite-tool-schemas-request-projection.zh.md)

## Problem

Section 32 landed the Lite declaration face — five required fields, the Remote tools namespace, and `tool-descriptors.json` — but the model face never followed: the declaration file deliberately carries only host-only fields ("never reach the model wire"), so the Lite request body advertised no tools at all. The response side could already assemble `tool_calls` from a stream, meaning a Lite model could attempt a call against a request that never named a single tool. The only static carrier of `name`/`description`/`parameters` was `docs/tool-catalog.md`, a page for humans; the Lite lane had no machine-readable source for the OpenAI function-tool shape its provider would need.

## Decision

The model face is a third output of the existing catalog generator, not a new authority. `scripts/gen-tool-catalog.ts` already boots every tool package to harvest both `descriptors()` and `schemas()`; it now filters the declarations to `supportsLite === true`, joins each with its harvested schema by name (a Lite-declared name missing a schema throws), and writes `packages/core/tools/lite-tool-schemas.json` with exactly `{name, description, parameters}` per row, sorted by name. The existing `--check` byte-verifies all three artifacts under the same `verify-tool-catalog` leaf, so `doc-sync` covers the new file with no new gate. Same-name conflicts are fatal only inside the Lite domain: `bash` is registered by two packages with different descriptions, and non-Lite same-name variants do not participate — the Lite face carries one schema per name.

The Android side consumes the projection with construction-state request injection. `:contract` mirrors `LiteToolSchema` with the hand-written fail-loud `JsonElement` parser (missing fields, mistyped values, blank names or descriptions, non-object parameters, and duplicate names all throw; unknown future fields are tolerated) and a cross-file parity test asserting the projection's name set is a subset of `tool-descriptors.json`'s `supportsLite` ids — both files ride the same test classpath via `copyLiteToolSchemas`. `:core` gains `LiteToolSchemaCatalog`, dual-sourced like its siblings (`HOST_PROJECTED` from the parsed projection, `BARE` as the empty list). `LiteHTTPProvider` takes `toolSchemas: List<LiteToolSchema> = emptyList()` and, when the list is non-empty, puts an OpenAI-shaped `tools` array (`{type: "function", function: {name, description, parameters}}`) after `messages`; an empty list omits the key, matching the host DeepSeek serializer's own empty-array rule. Tools are provider construction input, not per-call state: `LiteProviding`, `LiteChat`, `LiteLoop`, the fold, and the journal are untouched, and the HTTP tests pin that a `BARE` request still carries exactly the three original top-level keys while system-plus-tools keeps the system message at `messages[0]`.

## Alternatives considered

Extending `tool-descriptors.json` with `description` and `parameters` was rejected: that file is the section 32 declaration contract whose documentation pins its fields as never reaching the model wire, and mixing audiences would drag 58 parameter schemas through a parser that only needs six fields. Hardcoding the schemas beside `LiteToolRegistry`'s bundled descriptions was rejected: it would create a Kotlin-side authority for parameter schemas, the parallel system the projection pattern exists to prevent. A separate generator with its own boot was rejected: the harvest machinery is identical, and a third output on one generator keeps a single real boot and a single verify gate.

## Consequences

The Lite model face has one authority chain — registered `ToolDefinition`, `schemas()` harvest filtered by `supportsLite`, checked-in projection, contract mirror with cross-file parity, request injection — and `web_search`, the only `supportsLite` declaration today, is the first tool a Lite model can see. `BARE` requests remain byte-identical to the pre-increment behavior. The generator's conflict rule stays scoped to Lite names, so cross-package persistent-shell variants cannot block the projection.

## Open follow-ups

The Lite loop still has no tool-call handling: received `ToolCall` chunks end at the fold's in-memory state, and the section 31 permission policy that would govern execution is unimplemented. The app-layer runtime wiring (assets packaging for both projections, constructing the real provider) and the preset-selection surface remain open, as do the local-name alignment (`url_fetch` versus `web_fetch`) and the `runtimeMode = lite` disclosure.

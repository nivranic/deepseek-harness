# Agent Note: Lite tool declarations end Mobile guessing for tool capability

Status: implemented

English | [中文](2026-10-12-lite-tool-declarations.zh.md)

## Problem

Section 32 requires every tool to declare `id`, `version`, `risk`, `permissions`, `supportsLite`, and `supportsRemote`, and forbids Mobile from guessing whether a tool can run. Nothing of that surface existed: `ToolDefinition` carried no declaration fields, the Remote surface had no tools namespace, and the Android Lite loop decided handoffs from a hardcoded local name table — unknown names were silently dropped.

## Decision

`ToolDefinition` requires `version` (positive integer from 1), `risk` (the section 37 four-tier vocabulary), `permissions` (existing Remote permission vocabulary; empty means no claim), `supportsLite`, and `supportsRemote` at registration; `ToolRuntime.register()` fails loud on out-of-vocabulary or mistyped values, mirroring the section 37 `normalizeDefinition` shape. All 63 production `defineTool` sites across 26 packages, both preset fixtures, the `run_code` transport, and the dynamic producers declare explicit values (per-tool rationale in the generation's decision table). Producers wrapping untrusted sources set values at the bridge: the MCP bridge declares `high` risk and `supportsLite: false` for every server tool without reading server declarations, and the sandbox guard overwrites untrusted fields. The fields are host-only — the `schemas()` allowlist is untouched, so model requests and the session log see nothing new and no SDK surface changed.

`ToolRuntime` extends `TypertRemoteService` and exposes `list()` on a new `tools` namespace under `tool.catalog.v1`, following the section 37 `commands` chain into the `dsh-api-remotes` admission table and `host/describe` aggregation. Descriptors exclude `parameters` and `description`, which stay on the model-facing surface. `gen-tool-catalog` also writes the checked-in machine-readable `packages/core/tools/tool-descriptors.json`.

Android consumes the declarations instead of guessing. The `:contract` module mirrors `ToolDescriptor` with a hand-written `JsonElement` parser that fails loud on out-of-vocabulary risk, non-positive or fractional versions, missing fields, and duplicate ids while tolerating unknown future fields. `LiteToolRegistry` gains `LiteToolCatalog` with an explicit source enum — `HOST_DECLARED` when descriptors arrived, `BUNDLED_FALLBACK` offline or without the capability, byte-identical to the old table. Declared mode hands `supportsLite: false` tools back to the full runtime even against the old table, and hands undeclared names back instead of dropping them. `NativeGatewayClient` pulls `tools/list` only when the capability is advertised; a missing capability is the normal negotiated-subset path and a declared-but-broken payload fails as `BadWire`. The mirror test pins shared ids for `supportsLite` agreement and freezes the local-only name list so a future Host tool named like a local entry reopens adjudication.

Alongside, a baseline red went green: `admitHostOperation` required every declaring capability to be advertised, so `session/prompt` — declared by both `session.control.v1` and `model.steer.v1` since section 30 — failed admission on a single advertised declarer. Admission now accepts any one advertised declarer, mirroring the Gateway's first-matching dispatch, and names the first declarer in the rejection for determinism.

## Alternatives considered

A generated-projection-only channel (no live namespace) was rejected: MCP-bridged and sandbox tools are dynamic, so only the Host can serve their declarations, and the negotiated-subset rules for older Hosts need the capability gate anyway. Baking the five fields into `ToolSchema` was rejected because model-visible inputs must be reconstructable from the session log and none of these fields belong in a model request. Keeping the bundled table as the declared source was rejected — it is exactly the guessing section 32 forbids.

## Consequences

Tool authors must state five fields per registration; the register boundary rejects missing or invalid values immediately. Remote clients can discover tool capability without invoking anything, and the Lite loop's handoff decisions are declaration-driven with an explicit fallback mode instead of a hidden table. The `app-debug.apk` bytes drift this generation because `:contract`, `:core`, and the capability-details screen changed; the seal record becomes the next baseline. The single-capability admission test red that predates this generation (outside the audit file list since the section 30 era) is closed.

## Open follow-ups

Android local names versus Host tool names (`url_fetch` versus `web_fetch` and four more) align in a follow-up before any additional `supportsLite` flip; the app-layer runtime wiring from gateway pull to `LiteChatViewModel`, the Lite tool-permission policy, and section 33 prompt composition remain.

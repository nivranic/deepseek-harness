# Agent Note: Lite tool calls pass a declaration-fact permission gate before dispatch

Status: implemented

English | [中文](2026-10-15-lite-tool-permission-policy.zh.md)

## Problem

Section 31 requires the Lite runtime to own a permission policy, yet the tool-call branch of the Lite loop dispatched on catalog presence alone: a bundled-fallback name went straight to the executor with no gate at all, and an unknown fallback name folded `tool/call` and left it hanging in `phase="running"` forever — no result, no error, a turn that completed without saying anything about the call it dropped. The declaration facts the policy should read — `ToolDescriptor.risk` and `permissions` — were parsed by the contract layer and held by `LiteToolCatalog` but consumed nowhere.

## Decision

The policy is one decision point consulted once per call. `LiteToolPermissionPolicy.decide(name)` answers one of `AllowLocal`, `Handoff(reason)`, or `Unknown`; `LiteLoopDriver` takes it as a constructor parameter defaulting to `LiteToolPermissionPolicies.defaultPolicy(toolCatalog)`, placed before the trailing-lambda executor parameter so every existing call site stays untouched. The default ladder reads Host-declared facts only where they exist: a HOST_DECLARED name hands off when it is declared not-lite, when no bundled executor serves it on this device, when the declared risk is high or critical, or when the declared permissions list is non-empty (Lite holds no device admission to satisfy them); otherwise it allows local execution. A BUNDLED_FALLBACK name keeps the bundled capability judgment with no risk gate, because that name domain carries no Host risk facts and inventing them would be the guessing section 37 forbids. The vocabulary reuses `ToolRisk` tiers and `ToolDescriptor.permissions` — no parallel permission model (section 72). An `Unknown` name now folds an explicit failed `tool/result` (existing event shape, `ok=false`, naming the unknown tool) and the turn completes; the fold and journal vocabularies are untouched, and handoff events keep the fixed `requiresFullRuntime` capability field, so no downstream vocabulary drifted.

## Alternatives considered

Gating in `LiteChat.send` after the turn was rejected: execution has already happened by then; a permission gate only means anything at the dispatch point. A risk gate over bundled-fallback names was rejected: those tools have no Host-declared risk facts, and any tier assigned on-device would be the mobile-side guessing section 32/37 prohibit. Auto-mapping risk tiers to an interactive approval tier was rejected for this increment: the loop has no approval surface yet, the specification's own priority appendix defers built-in tool execution to P2, and handoff to the full runtime already routes high-risk calls to the surface that owns escalation.

## Consequences

The Lite runtime now owns its permission policy (the section 31 four-piece checklist is three-quarters done: catalog, persona, policy; `runtimeMode = lite` disclosure remains), and the policy agrees with the catalog's execution-surface semantics — a declared name without a bundled executor hands off under both readings, a divergence the first implementation pass had and the gate closes. Unknown tool calls end in an explicit failure the fold can show instead of a silent hang. Nothing about the single round trip changes: executor results still do not feed back to the model, which stays deferred with the specification's P2 note.

## Open follow-ups

The `runtimeMode = lite` disclosure, the interactive approval tier (an `ask` decision with the section 38 approval surface), feeding tool results back to the model (deferred P2 by the specification), the app-layer runtime wiring, and the local/host tool-name alignment remain open.

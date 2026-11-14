# Agent Note: The Lite permission ladder gains an approval tier with §38's dialog

Status: implemented

English | [中文](2026-10-24-approval-ask.zh.md)

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core` (`LiteToolPermissionPolicy.kt`, `LiteLoop.kt`, `LiteChat.kt`), `apps/android/app` (`LiteApprovalAsks.kt`, `LiteSessionAssembler.kt`, `LiteEntry.kt`, `LiteChatScreen.kt`, `native_companion.xml`)

## Problem

The §31 permission ladder answered every declared tool call with one of three decisions — execute on-device, hand off to the full runtime, or fail on an unknown name — so a `moderate`-risk call (the union's `web_search`, `url_fetch`, and `artifact_create`: network fetches and on-device writes) executed with no user in the loop. §38 demands the opposite for dangerous operations: an approval face that shows the call's facts, never a bare "allow?".

## Decision

Add a fourth decision, `LiteToolDecision.Ask(risk)`, between the handoff gates and the free pass: after the high/critical and remote-permissions gates refuse, a declared `moderate` risk asks; `low` names (pure computation, local reads, image metadata) keep the direct-execution pass, and the bundled-fallback name domain keeps its no-risk-gate semantics because it carries no declared risk facts to ask about (§37: never guess). The loop driver consults the policy as before, and an `Ask` call suspends on a new `LiteToolAsking` seam — `(name, arguments, risk) -> Boolean` — before executing: a grant runs the call through the same body as a permitted call, a denial folds the established `tool/result(ok=false)` vocabulary (zero new event tags), and no seam at all folds an explicit `approval unavailable` denial — an Ask never executes unconfirmed. The app face mounts the seam as `LiteApprovalAsks`: one pending slot (the loop serves its calls serially), a `StateFlow` the dialog renders, cancellation clearing the dialog when the turn is replaced, and `respond` resuming outside the lock. The dialog carries §38's seven fields from the facts at hand — operation (the tool name), target (this device, restricted mode), host (the on-device Lite session), workspace (lite local storage), risk (the declaration's wire word), permission escalation (none — local execution never escalates), command preview (the arguments JSON) — with eleven locale-owned keys, full-action test tags, and dismissal counting as denial: a confirmation-gated call must not run by default. The wiring follows the assembly seam: `LiteSessionAssembler.assemble` and `LiteChatViewModel` accept the ask seam and pass it to the driver, and `LiteChatFace` remembers one `LiteApprovalAsks` per assembly identity.

## Alternatives considered

- Asking for every tool call, the way a full-runtime approval policy might: the ladder's own tiers already encode the danger gradation — `low` is pure computation and local reads, and §38's demand is about dangerous operations, not all operations; asking for a calculator turn would train the user to approve reflexively.
- Rendering a pending-ask row in the fold instead of a suspension seam: the ask is a UI-local interaction the model never sees, and the fold's tag set is a closed sixteen-tag vocabulary verified from three sides — the denial reaches the model through the existing `tool/result` row, which is the only model-visible face of the exchange.
- Journaling the approval exchange as session events: same closed-vocabulary argument — the user's grant or denial is not a turn outcome and chapter 64's journal keeps turn outcomes; the folded denial row already persists what the restart needs.

## Consequences

- The union's behavior flips for exactly three names — `web_search` (Host projection), `url_fetch` and `artifact_create` (device declaration) — from direct execution to ask-first; the low names keep theirs. `LiteToolRegistryTest`'s union-ladder loop now branches on the declared risk, and the two policy tests assert the Ask tier on both declaration faces.
- The loop driver's constructor gained the optional `ask` seam **before** `execute`: the existing call sites pass the executor as a trailing lambda, and a defaulted parameter after it would capture that lambda.
- `:core:test` grows to 85 suites / 612 tests (+3): the suspension test pins the seam facts (name, arguments, `moderate`) and the wait point (the call row already landed `running`, no result), the denial test pins the `user denied on this device` fold and the chapter-64 journal tail, and the no-seam test pins the explicit `approval unavailable` denial.
- No androidTest covers the dialog itself: the entry face assembles real HTTP sessions with no scripted-provider injection point, so the dialog's semantics live in the core seam tests and its rendering is compile-and-locale-verified; a scripted UI harness would be new infrastructure this generation does not need.
- `LiteHTTPProviderTest.aStreamThatEndsBeforeDoneIsTruncation` flaked intermittently under the full suite during this generation's rounds (three full-run failures, green on every isolated rerun and on the final clean full round); this generation touches no provider code — recorded as the standing intermittent, not a regression.
- Both APK faces drift (the app and core main source sets changed): androidTest `2c73cbb2 → e0d3214b`, debug `995eeb31 → 5b996719`.

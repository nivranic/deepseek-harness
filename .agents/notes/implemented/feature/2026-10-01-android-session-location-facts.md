# Agent Note: Android publishes the Session location facts (§29)

Status: implemented

English | [中文](2026-10-01-android-session-location-facts.zh.md)

## Problem

Section 29 requires every Session to publish five location facts — Host, runtime mode, workspace, permission preset, online state — as a persistent compact chip. The Web Session header has done this ([2026-10-01-session-location-chip](../architecture/2026-10-01-session-location-chip.md)); the Android companion showed only the current Host in the Hosts controls, and its session list row parsed no workspace at all.

## Decision

- `SessionRow` gains the optional `cwd` the wire rows already publish (`SessionSummary.cwd`); the chip derives the workspace basename from it, splitting on both separators (Hosts may run on Windows).
- The permission preset stays OUT of `DomainState` — that shape is the chapter-62 trilingual conformance contract. `SessionModel` keeps a `permissionPreset: StateFlow<String?>` fed from the journal publish callback (newest `permission/preset` record wins; a replacement window with none is authoritative null; `openSession` resets).
- The follow-stream connection state becomes Compose-observable: `StreamTransitionOwner` mirrors its atomic `ConnectionSnapshot` into a `StateFlow` posted after every transition (`advanceGeneration`, `update`, `settleStopped`); `SessionModel.connectionSnapshots` exposes it. The existing snapshot getters stay.
- `SessionLocationFacts` renders, while a Session is open and outside the composer row (the model-steer width constraint): one facts line `Host · workspace basename · preset word · state word?` (testTag `session-location-facts`) and a detail line with the full-runtime word and full workspace path (testTag `session-location-detail`). Built-in presets reuse the shared zh vocabulary (仅可查看/工作区内修改/完全权限/自定义); host presets show their raw id. The state word appears only for non-OPEN states; the runtime word is honest as a protocol invariant — the native gateway admits only `runtimeMode: "full"`.
- The acceptance lane pairs a real AVD companion to a providers-only replay Host over the header-only fixture (reading facts drives no model call) and proves the settled facts line and detail line from published Host data.

## Alternatives considered

- **Adding `permissionPreset` to `DomainState`:** breaks the trilingual conformance fixtures in three languages for one chip line.
- **Driving a live outage in the lane to show the state word:** not physically possible with the lane's toolset — removing the adb reverse is undetectable by an idle follow stream (no keepalive), reopening the same Session reuses the live stream, and a fresh connect through the removed tunnel was observed to still succeed (host-side `ESTABLISHED` during the "outage"). The state-word machinery is covered by the JVM connection-state tests; a deterministic outage needs a Host-side stream kill, left open.

## Consequences

- The online-state word renders from real follow-stream transitions but has no device-level acceptance proof yet (JVM tests cover the transitions; the word mapping lives in the chip composable).
- `StreamTransitionOwner` now posts every snapshot mutation to a flow; the atomic getter semantics are unchanged.
- Two host incidents during development, disclosed: a property-less `:app:assembleDebug` (missing `-PdshNativeAcceptance`) rebuilt plain-id APKs that were then installed over the user's real `com.deepseek.harness.companion` (+ `.test`) — same debug signature, data preserved, now carrying current-source builds; and the host adb server crashed once mid-lane (port 5037 refusal), recovered with kill/start-server.

## Open work

- A deterministic device-level outage leg (needs a Host-side stream-kill primitive or a follow-stream keepalive).
- Real-device qualification; Swift-side location facts.

# Agent Note: Apple contract adopts the session-location facts derivation (§29)

Status: implemented

English | [中文](2026-10-02-apple-session-location-facts.zh.md)

## Problem

§29 requires every Session to expose five location facts (Host, runtime mode, workspace, permission preset, online state). The Web chip and the Android facts row derive them, but the Apple side had no mirror, so a Swift client would have to re-derive the rules from prose: which facts appear, in what order, with which fallbacks. The §29 traceability row lists "Swift 外壳与位置事实" among the open work.

## Decision

- The Android derivation is extracted into one pure core object `NativeLocationFacts` (apps/android/core `NativeLocationFacts.kt`): `presentedHostName` (blank name falls back to hostId, no entry adds no fact), `workspaceBasename` (last non-blank segment over both separators, falling back to the whole path), `latestPreset` (the newest `permission/preset` record wins; a matching event without a string preset keeps the earlier value — moved verbatim from `CompanionModels.latestPermissionPreset`, which now delegates), `stateWord` (the open state adds no word, the six §18-family words name themselves, unknown words drop), `factsLine` (present identifiers only), and `detailLine` (exists only with a workspace: the protocol-fixed full runtime word plus the whole path — `NativeGatewayProtocol` admits only `full`).
- `MainActivity.SessionLocationFacts` (the composable) keeps rendering localized words but delegates `presentedHostName`/`workspaceBasename` to the core object — one authority, no duplication.
- The Apple mirror `NativeLocationFacts.swift` (apps/apple/contract) adopts the same rules and a whole-document `decode`: a non-object host reads as no Host, a non-string cwd or state reads as absent, a non-array journal reads as empty, malformed JSON throws, a non-object root reads as all-absent. Locale words stay client-owned; the contract speaks identifiers.
- Shared fixtures `apps/apple/contract/fixtures/native-location-facts/` (one canonical document, four edge cases — blank-name and all-blank-segment fallbacks, an all-absent document, preset precedence kept through a non-string value, an unknown state word with an ignored event type — and one malformed case; counts pinned 1/4/1 in both columns) run through `NativeLocationFactsFixtureTest` on the Kotlin side (driving the real core object) and the self-check section in `main.swift` on the Swift side, so both derivations agree byte for byte over the same inputs.

## Alternatives considered

- **Mirroring the localized words:** the §18 state words and preset words are locale-owned client copy; a contract column must not freeze translations. The mirror pins identifiers; each client localizes.
- **Mirroring at the UI layer:** the Apple side has no shell yet; a derivation-level contract lands the shared rules now and stays true whatever the shell renders.
- **Keeping the derivation app-private:** the preset derivation already lived in core; extracting the remaining two rules into the same object removes the app/core split that would otherwise force the Swift mirror to guess which file is the authority.

## Consequences

- A Swift client derives the same facts from the same wire data as the Android core; drift between the two columns fails the shared fixtures.
- `CompanionModels.latestPermissionPreset` and the MainActivity basename/name fallbacks now delegate to the single core object; behavior is unchanged (the moved bodies are verbatim).

## Open work

- The Apple shell that renders the facts (and its locale words) is still open; this contract column is the derivation-level half of "Swift 外壳与位置事实".
- 真机, background/push, follow cursor/handoff, and the rest of §29's acceptance remain open.

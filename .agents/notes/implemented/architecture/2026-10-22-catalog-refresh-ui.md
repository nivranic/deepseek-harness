# Agent Note: The Lite face refreshes the shared catalog observation in-face

Status: implemented

English | [中文](2026-10-22-catalog-refresh-ui.zh.md)

## Problem

Gen-64's pull channel landed with three UI gaps the gen-69 ledger carried. The `descriptionRefresh` epoch in `CompanionApp` had exactly two incrementers — the view-link retry and the capabilities dialog's `native-capabilities-refresh` — and both live on branches the Lite face's early `return` leaves unreachable, so a paired catalog could only be re-asked by exiting Lite. The `lite_catalog_bad_wire` diagnostic line's copy instructed exactly that exit ("可在连接能力中刷新后重试"). And `LiteSessionFacts.toolCatalogSource` — the fact naming which catalog assembled the session — had no rendering anywhere; the disclosure row carried only the runtimeMode word.

## Decision

Wire the epoch in, disclose the source, and make the bad-wire remedy reachable in-face. `LiteEntry` gains `onCatalogRefresh: (() -> Unit)?`; when a caller passes one, the disclosure row becomes the disclosure text plus a `lite-catalog-refresh` TextButton (the `native-capabilities-refresh` form) labeled by the new `lite_catalog_refresh` locale key. MainActivity's lite-open assembly passes `{ descriptionRefresh++ }` — the same shared epoch both observers key on — so one tap re-runs the existing catalog observation, and a changed declaration then re-runs the existing assembly identity: the `remember` keys in `LiteChatFace` are untouched, because a refresh re-judges the identity rather than swapping a live session's catalog. The `lite_catalog_bad_wire` copy drops the exit instruction for the in-face one ("可在本页刷新后重试"). `LiteChatFace` renders `chat.facts.toolCatalogSource` as a `lite-catalog-source` line through three locale keys, one per `LiteToolSource` value — a construction-time fact, so the line names the source the current session identity was assembled against, never a live re-read. All four strings live in `native_companion.xml`, the app's single locale file; bilingual coverage is this note pair.

## Alternatives considered

Hot-swapping a live session's catalog on refresh was rejected — the gen-64 decision stands: the catalog is part of the assembly identity, a changed catalog means a new session, and the refresh entry only re-runs the observation and lets the existing identity judgment act. An inline refresh action on the bad-wire row itself was rejected — one entry beside the disclosure line serves every face state (empty state, config form, assembled chat), and the row's copy names it. Rendering the source line at the `LiteEntry` disclosure level was rejected — facts exist only per assembled session, so the line renders in `LiteChatFace` where the assembly happened; the endpoint-less empty state carries no fact it could honestly name. Gating the refresh entry on paired state was rejected — the entry renders whenever a shell wires it; unpaired, the bump re-runs an observation with no wire to ask and changes nothing, and hiding it would leave the connected unpaired face unable to show the entry at all.

## Consequences

A paired user re-asks the Host's live tool declaration without leaving the Lite face, the bad-wire diagnostic's remedy sits beside the line, and every assembled Lite session names its dispatch-catalog source. `LiteEntryNativeTest` grows to seven with a new bad-wire test — the first rendering assertion of `lite-catalog-badwire` (direct render over the composable after the paired-shell-entry precedent, scripted with the flag raised and the bump clearing it), plus `lite-catalog-refresh` presence on the real unpaired face and the `lite-catalog-source` line asserting the BUNDLED word over the configured-face assembly. All seven pass on emulator-5554. Core JVM tests stay at 608 across 85 suites (an app-source-only change) and contract stays 4 suites / 37 tests; the debug APK baseline drifts with the production UI change.

## Open follow-ups

A live paired on-device round — a real Host serving then violating the descriptor schema, with the in-face refresh clearing `badWire` in the field — remains e2e territory shared with the gen-64/69 open item. The runtimeMode disclosure text is still a hardcoded literal (a pre-existing face this generation left untouched).

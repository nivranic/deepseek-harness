# Agent Note: CompanionUI — the SwiftUI application layer

Status: implemented

English | [中文](2026-08-30-companion-ui-layer.zh.md)

## Problem

Phase 2's plan (E:\11585 plan, chapters 58–59, 73) calls for the companion's application surface — session UI over the follow stream, approval/question answering, the plan/todo/goal pane — under the user-pinned dual visual styles (简约拟态 plus 液态玻璃 on Apple), with the styles sharing one semantic token set and glass degrading automatically on incapable OSes or accessibility preferences. The Apple core had the wire state machine but nothing an app shell could render, and no compile lane exists on this host, so the layer had to be authored testable without a host.

## Decision

A second SwiftPM library target, `CompanionUI` (iOS 17+/macOS 14+, SwiftUI + the Observation macro), keeps every screen a thin function of two `@Observable` view models that depend only on a `CompanionWireDriving` protocol — one unary call, one stream, both shaped exactly like the carrier's — with the real adapter wrapping `LinkClient`. `RemoteSessionViewModel` runs the session slice against the real endpoint names (`session/list`, `session/follow` with snapshot-then-events folding and cursor tracking, `session/prompt` in queue mode, `session/cancel`) and resubscribes the follow stream after a loss from the last cursor, treating even a clean stream end as a loss the way the reference client does. `InteractionViewModel` watches `$events`, collects approval/question forwards into an inbox, and answers through `$events/result` with the gateway's exact outcome shape (`{kind:'result', value:'allowed-once'|'rejected'|'cancelled'}`), surfacing a host refusal (typically the independent approval switch) as inbox state instead of dropping the card. Theming is one `CompanionTheme` token set: both styles read the same names, `resolve` swaps liquid glass for 简约拟态 when the OS cannot carry it or reduce-transparency/increase-contrast is set, and `CardSurface`/`CompanionButtonStyle` are the only two style-aware surfaces — no component branches on style. The plan/todo/goal pane renders behind a `PlanTodoGoalSourcing` protocol whose production source stays empty until the session-event contract models exist, rather than guessing wire shapes. XCTest covers the view models over a scripted fake wire (projection, folding, cursor, prompt/cancel args, answer outcome, refusal retention) and the five degrade-rule cases.

## Consequences

The companion's app shells are now thin Xcode hosts over two libraries, and everything below the shells is authored and tested — but still not compiled here: the same macOS-lane caveat as the core applies, and the view models' assertions encode the wire shapes the fixture drift gate and the carrier-level slice e2e already prove on the TypeScript side. The generic timeline projection shows record/event kinds and extracted text; refined per-event rendering (and the plan/todo/goal production source) waits on extending `dsh-link-contracts` with the session-event vocabulary, which is the natural next contract increment.

## Alternatives considered

Putting the view models in the app shells was rejected: the shells must stay thin and the layer must test on whatever lane exists. Modeling the full session-event map by hand in Swift was rejected for the same reason as filling the plan source — guessed wire shapes are exactly what the contract pipeline exists to prevent. A per-style component fork (separate glass and neumorphic view trees) would violate the user's one-token-set rule; the degrade lives entirely in `resolve`.

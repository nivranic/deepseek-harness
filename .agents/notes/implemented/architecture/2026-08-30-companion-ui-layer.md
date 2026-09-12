# Agent Note: CompanionUI — the SwiftUI application layer

Status: implemented

English | [中文](2026-08-30-companion-ui-layer.zh.md)

## Problem

Phase 2's plan (E:\11585 plan, chapters 58–59, 73) calls for the companion's application surface — session UI over the follow stream, approval/question answering, the plan/todo/goal pane — under the user-pinned dual visual styles (简约拟态 plus 液态玻璃 on Apple), with the styles sharing one semantic token set and glass degrading automatically on incapable OSes or accessibility preferences. The Apple core had the wire state machine but nothing an app shell could render, and no compile lane exists on this host, so the layer had to be authored testable without a host.

## Decision

A second SwiftPM library target, `CompanionUI` (iOS 17+/macOS 14+, SwiftUI + the Observation macro), keeps every screen a thin function of `@Observable` view models that depend only on `CompanionWireDriving` — one unary call and one stream shaped exactly like the carrier's — with the real adapter wrapping `LinkClient`. `RemoteSessionViewModel` owns one follow task. Opening or reconnecting cancels and awaits the prior task, assigns a new generation identity, and prevents a retired generation from publishing; unexpected failure and clean completion both back off and reopen from an authoritative snapshot, while stop cancels backoff without creating another generation. The same model drives the generated Session-event fold for timeline, plan, todo, goal, tools, attachments, artifacts, and subagent addresses. `InteractionViewModel` owns one `$events` task: repeated start is idempotent, restart cancels and awaits the prior task, each generation takes its answer identity only from the Host `ready.clientId`, and loss automatically reopens after backoff. It collects approval/question forwards into an inbox and answers through `$events/result` with the Gateway's generated outcome fields, surfacing a Host refusal as inbox state instead of dropping the card. Theming remains one `CompanionTheme` token set: both styles read the same names, `resolve` swaps liquid glass for 简约拟态 when the OS cannot carry it or reduce-transparency/increase-contrast is set, and no component forks by style. XCTest covers replacement ordering, stale-generation suppression, automatic retry, cancellation during backoff, generated Session folds, prompt/cancel and interaction arguments, refusal retention, and the degrade rules.

## Consequences

The companion's app shells remain thin Xcode hosts over two libraries. Single-task ownership makes stream replacement awaitable and prevents a cancelled task from racing a current generation. The real Host acceptance interrupts active follow and `$events` generations and requires these production retry loops to publish exactly one replacement of each kind; generated fixtures and fake-wire tests do not substitute for that platform result. A Windows host without Swift/Xcode records native compilation and execution as `NOT_EXECUTED`, while the Apple lane owns those results.

## Alternatives considered

Putting the view models in the app shells was rejected: the shells must stay thin and the layer must test on whatever lane exists. Modeling the Session-event map by hand in Swift was rejected because guessed wire fields are exactly what the generated contract pipeline prevents. Cancelling and overwriting task references without awaiting them was rejected because an old stream can publish after a replacement or survive stop. A per-style component fork (separate glass and neumorphic view trees) would violate the one-token-set rule; the degrade lives in `resolve`.

# Agent Note: The Android Lite Chat Surface

Status: implemented

English | [中文](2026-08-31-android-lite-chat-surface.zh.md)

## Problem

The Android embedded-runtime stage had every seam — fold, registry, driver, journal — but no surface that composed them: nothing submitted a prompt through the loop into the journal, and nothing rendered the folded state a user would see. Apple's `LiteChatViewModel` and `LiteChatView` were the last unmirrored pieces of the stage.

## Decision

`LiteChat.kt` in core mirrors the view model: `send()` submits the prompt through the loop and joins the turn's Job (`submit` now returns it), then journals the turn's fold-visible outcome events — `prompt/accepted`, `message/completed` with the turn's final conversation text, and `handoff/requested` (setting `lastHandoff`) or `turn/completed` — and persists through the store. Raw deltas stay out of the journal, the same chapter-64 fidelity rule Apple recorded. The exposed `state` is the live driver fold while a turn runs, the journal replay otherwise. `LiteChatScreen.kt` in the app module renders `LiteDomainState` exactly as Apple's view does: conversation rows with 你/助手 captions and the 已中断 marker, the streaming partial (or 正在思考…), tool rows with phase words, artifact references, and the handoff banner naming the capability continued on the host.

## Consequences

`LiteChatViewModelTest` pins the composed lifecycle over the scripted provider and a temp-directory store: submit-persist-relaunch-restore folds back to the identical conversation, a `run_tests` turn surfaces the banner state (`lastHandoff` and `pendingHandoff` both carrying the marker), and a second turn over the same session grows the journal and the restored replay together. The Android lane verified green. The embedded-host-runtime stage is now fully mirrored on Android — fold, registry, driver, persistence, chat — with every piece conformance-pinned or unit-pinned against the same fixtures Apple replays.

## Alternatives considered

Journaling the driver's raw stream events was rejected — the driver's fold is live-only state; the turn's outcome events are the durable truth, and chapter 64 forbids premature fidelity. Rendering through a StateFlow projection of the fold was deferred — the surface re-reads per persisted turn today; a live streaming projection arrives with the real HTTP provider, where mid-turn rendering matters.

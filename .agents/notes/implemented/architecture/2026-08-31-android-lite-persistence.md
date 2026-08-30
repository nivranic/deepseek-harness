# Agent Note: Android Lite Persistence

Status: implemented

English | [中文](2026-08-31-android-lite-persistence.zh.md)

## Problem

The Android embedded-runtime stage could fold, dispatch, and drive a turn, but nothing survived the process: the journal that is a Lite session lived only in memory, and chapter 56's resource channel — artifact bytes beside reference-only events — had no store.

## Decision

`LiteStores.kt` mirrors Apple's `LiteStores`. `LiteSession` is the event-sourced journal: its id plus the recorded events, with `state` replaying the whole journal through the incremental `LiteFold.apply` — the same fold the driver drives live and the conformance fixtures pin. `LiteFileSessionStore` persists one session per `<id>.litejournal` file as JSON lines (chapter 11's journal shape), written by an atomic same-directory temp-file rename with a plain-replace fallback where the platform refuses atomic moves; `save` replaces the prior journal wholesale, `load` decodes line by line and fails loud on a corrupt line, and absent sessions load as null. `LiteFileArtifactStore` is the resource channel: one atomic `<id>.artifact` file per artifact id, `put`/`get`/`remove` with absent reads as null.

One deliberate Kotlin deviation: the store seams are blocking calls, not suspend — Swift's actors isolate the same operations, while on the JVM plain file IO is the idiom and the app layer wraps with a dispatcher when it needs one.

## Consequences

`LiteStoresTest` pins the lifecycle: submit-persist-relaunch-restore (a fresh store instance loads the journal and folds to the identical conversation and turn end the live session reached), wholesale replacement on re-save, absent-load null and delete-removes, a corrupt journal line failing loud, artifact bytes round-tripping through the resource channel, and the in-memory replay finalizing a cancelled prefix. The Android lane verified green. The last embedded-runtime mirror step is the chat surface over these seams.

## Alternatives considered

A suspend seam mirroring the actor signature was rejected — it would wrap blocking IO in ceremony without an async implementation existing; the seam stays swappable for one. Compaction at save time (chapter 64 forbids premature snapshotting) was rejected — the journal replays verbatim, and the chapter's own rule is that compaction arrives with a format decision, not before.

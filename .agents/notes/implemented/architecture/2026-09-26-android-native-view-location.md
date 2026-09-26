# Agent Note: Android reveals shared Session locations through bounded Host history

Status: implemented

English | [中文](2026-09-26-android-native-view-location.zh.md)

## Problem

A native companion that only retains the latest follow window cannot reveal an older shared position. Loading pages against a changing log cut or accepting a late result after Session replacement can mix unrelated windows. The dormant Lite Handoff protocol creates a different Session and therefore cannot implement a transfer of viewing position.

## Decision

Android uses the existing [Session Controller](../../../../packages/api/session-controller/README.md) v1 location grammar: a prefixed base64url payload carries Host id, Session id, and a safe nonnegative durable sequence. It contains no credential. Encoding follows Web's ASCII JSON restriction; decoding checks the exact fields and a caller-supplied character limit. The selected trusted Host must match before opening a stream. Import never selects or trusts a Host from the payload.

One native journal owns the opening snapshot cut, ordered retained records, and backward-page requests. Each page uses that fixed cut and the earliest held sequence; live events continue above the snapshot. Snapshots and pages replace the folded window, while live events fold incrementally. Wire checks reject missing pagination metadata, unsafe sequences, gaps, and pages that make no progress. The native pane retains its existing raw-event summaries; this change does not replace their presentation semantics.

A follow retry sends fromSeq only when the same journal owner still holds the corresponding records. Each transport begins with a snapshot whose header id matches the selected Session. Contiguous deltas keep the retained prefix and its history availability; overlapping full windows compare shared records before retaining that prefix. An uncovered cursor replaces the window, while contradictory records, backwards cursors, and byte overflow fail without publishing a partial merge. Each accepted snapshot renews the paging cut and retires old reads. A fresh model or process has no resumable cursor. Persisting a cursor alone would omit the records needed to reconstruct the view.

The Session model supplies configurable page and retention limits, defaulting to 50 messages per request and 8 MiB of serialized retained record bytes. This is not a total-heap measurement. A rejected older page preserves the current window and exposes manual retry. The application does not automatically download all history on open. Explicit anchor navigation loads backward only until the anchor is covered or a failure or limit stops it.

Snapshot or Session replacement cancels old paging and invalidates its result generation. Every cancelled read remains owned until completion; suspending model retirement awaits its cleanup. A shared-location jump also belongs to model lifetime and can be cancelled while waiting for the first snapshot. Completed jumps carry a navigation generation so opening the same sequence again still requests a new scroll. Once revealed, later live data does not repeatedly pull the viewport back.

The UI copies the first visible durable row and imports a pasted location. Pending unsent input has no durable anchor. Import follows the Host's existing observation and activation policy; it neither creates another Session nor calls the retired runtime-migration method. Drafts remain principal-owned through the [input checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md), and Host changes remain governed by the [saved Host catalog](2026-09-26-android-saved-host-catalog.md). Those decisions and the native TLS decision remain active.

## Alternatives considered

**Use the legacy Lite snapshot transfer.** That protocol requests a new full Session and carries runtime-derived content. Viewing-location Handoff instead identifies the existing Host log and preserves its ownership.

**Preload the full transcript or let each page use the latest cursor.** Unbounded startup work exceeds mobile budgets, while moving cuts can merge inconsistent history. Explicit bounded pages retain the opening cut and a fixed memory-accounting limit.

**Drop cancelled requests from ownership immediately.** Cancellation can precede transport cleanup. Retained jobs and generation checks independently provide quiescent retirement and stale-result rejection.

## Consequences

Core tests cover Web-compatible encoding, wrong-Host rejection, backward/live merging, stale pages, read failure, byte limits, cancelled-read retirement, and repeated navigation. A real Host scenario exposes an 88-turn generated Session to the installed Android application, rejects a wrong Host without another stream, retries a refused page, and verifies the copied visible anchor with the Web decoder. It submits no prompt and creates no new Session. This is seeded-history transport evidence, not live-provider qualification. Deep links, platform share routing, Swift adoption, physical devices, and Artifact retrieval remain separate work.

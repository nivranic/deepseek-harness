# Agent Note: Structured image references in the companion fold

Status: implemented

English | [中文](2026-08-30-fold-structured-image-refs.zh.md)

## Problem

The attachment surface landed with the fold rendering image blocks as inline summary text — the opaque attachment id never reached the companion state, so nothing could offer a tap-to-load affordance: the view model's `readAttachment` existed with nothing addressable to call it on.

## Decision

`CompanionDomainState` grows `images`: the ordered, attachment-id-deduplicated list of `CompanionImageRef { attachmentId, mediaType, width, height, name? }` collected while folding. Both folds walk the same three content-carrying events — `user/message`, `assistant/message`, `tool/result` — nesting through tool-result content exactly like the text projection, mirroring the TS reference in Swift (empty names normalize to nil the way the TS spread omits the key). The golden `image-attachment` scenario now pins the collected list in its expected state, so the conformance replay holds both languages to it. `RemoteSessionViewModel` projects the list, and `SessionView` renders a horizontal strip of `AttachmentCard`s: cached bytes decode to a platform image (UIKit/AppKit by build), otherwise the card names the reference and offers 载入 through `readAttachment`.

## Consequences

The fold now carries both the human summary (inline text) and the machine address (structured ref) for every image; the strip is the first companion surface that renders host bytes. Collection is append-mostly and idempotent — replays and re-follows after reconnect cannot duplicate rows. A folded session with many images holds the full list in state, which is bounded by the session's own image count.

## Alternatives considered

Reading bytes eagerly during the fold was rejected — the fold stays pure over references; fetching is a user-intent action. Keying the strip by timeline item was rejected — first-appearance order with id dedupe matches how a conversation's images are actually cited.

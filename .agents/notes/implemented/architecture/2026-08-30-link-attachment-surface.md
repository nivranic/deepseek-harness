# Agent Note: The link attachment surface

Status: implemented

English | [中文](2026-08-30-link-attachment-surface.zh.md)

## Problem

Plan chapter 54 names "Upload Attachment / Download Artifact" as part of the remote Files first version. The host already owns both halves — prompts carry inline base64 image parts the controller admits through `ctx.attachments`, and `session/attachment` returns durable bytes — and both endpoints sit in the link allowlist. But the wire vocabulary knew nothing about images: the contract table had no attachment types, the companion fold rendered image blocks as empty text, and the Apple side could neither send nor fetch an image.

## Decision

The contract table grew the attachment vocabulary as five rows — `LinkImageMediaType`, `LinkImageDimensions`, `LinkImageAttachmentRef`, `LinkAttachmentReadValue` (the `session/attachment` response), and `LinkPromptImagePart` (the inline upload block) — each pinned to the real `dsh-attachment` / `dsh-api-session-controller` types by `satisfies` fixtures, with `LinkContentBlock` gaining the optional `attachment` reference. The reference fold now renders image blocks inline as `图片 name（mediaType，W×H）` beside their text, mirrored byte-for-byte in the Swift fold (integral doubles drop the `.0` to match JavaScript number-to-string), and a new golden scenario (`image-attachment`) pins the mixed text/image message through the conformance replay. `RemoteSessionViewModel` gained the two consumer halves: `send(text:images:)` builds the prompt content array with inline `CompanionImageUpload` parts, and `readAttachment(_:)` calls `session/attachment` under the session verbs' `{request:{…}}` envelope, decodes the generated value, and caches `Data` bytes by attachment id.

## Consequences

A paired companion can now submit a photo with a prompt and fetch any image the folded log references, entirely through existing endpoints and roles — upload rides `session/prompt` (controller), download rides `session/attachment` (observer), so no allowlist change. The inline summary deliberately hides the opaque attachment id; a structured image surface (tap-to-render from the fold) needs the fold to carry references, which lands when the product wants rendering rather than naming. Swift remains authored-not-compiled locally (standing macOS-lane caveat).

## Alternatives considered

A dedicated upload endpoint was rejected — prompt-attached admission already validates, normalizes, and persists atomically, and a second path would duplicate admission policy. Exposing attachment bytes through `workspaceFiles` was rejected — attachments live in the content-addressed store, not the workspace tree, and `session/attachment` already authorizes reads against the session log.

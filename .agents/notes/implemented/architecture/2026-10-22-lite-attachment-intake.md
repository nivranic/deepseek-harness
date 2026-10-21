# Agent Note: A Lite attachment intake keeps the bytes on the device

Status: implemented

English | [中文](2026-10-22-lite-attachment-intake.zh.md)

## Problem

The last two local names — `attachment_read` and `image_inspect` — were honestly deferred in gen-62's ledger as "without intake producers", and gen-66's re-survey pinned why: the paired face's attachment channel (document/photo/camera pickers feeding base64 wire uploads) keeps no bytes on the device and belongs to the paired session, while the independent Lite face has no picker, no store, and no wire to upload over. An executor without an intake is unreachable in a stronger sense than a schema-less one — there is nothing on the device for it to read.

## Decision

Build the producer first, exactly one generation ahead of its consumers. `LiteAttachments.kt` lands as the whole seam: `LiteAttachmentEntry` (name, mediaType, sizeBytes), `LiteAttachmentStoring` (put/get/list/remove), `LiteFileAttachmentStore` mirroring the artifact store's file layout and atomic writes (the shared `writeAtomically` helper opened from private to internal) with one addition the artifact channel never needed — attachment intake writes no journal, so the media type lives in a `<name>.attachment.json` sidecar written after the bytes: a crash between the two writes leaves bytes no listing resolves, never a listed entry without bytes. Corrupt sidecars fail loud (the config store's corrupt-read form); a sidecar whose bytes are gone reads as absent. `LiteAttachmentIntake` is the typed step between a picked document and the store: the caller's bounded read already happened, intake derives the store key — `storeName` strips the display name's last path segment on both separators and trims, an empty or absent name falling back to a generated `attachment-<uuid8>` rather than refusing the user's file (the artifact channel refuses path separators because its ids are model-controlled; a provider display name carrying a prefix is not the user's fault) — defaults an unstated media type, enforces `CONTENT_LIMIT_BYTES = 8 MiB` (whole modern phone photos, bounded because nothing admitted reaches a request this generation), and returns `Stored` or a typed refusal. The UI is a panel beside the preset selector's idiom: an add button opening a two-option dialog (document picker, photo picker) over the app's existing `AndroidNativeFileAttachmentSource`, eleven locale-owned strings, test tags on every action, entries removable and listed across restarts. MainActivity's lite-open branch creates the store under `filesDir/lite-attachments` and injects it; the panel shows in both the unconfigured empty state and the assembled session face.

## Alternatives considered

Writing an intake event into the journal or fold was rejected — the sixteen-tag journal vocabulary is a three-way conformance set (TS reference, Swift, Kotlin) that this generation must not unilaterally extend, and intake is not a turn outcome. Admitting attachment bytes into provider requests was rejected as premature: the Lite wire's request rows are role/content strings today, and the request-face form for attachments is the gen-68 decision that lands with the two executors and their schemas as one paired increment. The camera source was deferred — the paired camera chain carries NativeCameraFiles and SavedStateHandle cleanup machinery that would dwarf this increment; document and photo pickers cover the intake surface. Pixel-dimension metadata was deferred to gen-68's `image_inspect` executor — decoding is that tool's job, intake keeps name/mediaType/sizeBytes only.

## Consequences

The device now retains Lite-session attachments locally — a real producer exists for the two deferred executors to read in gen-68, and nothing admitted this generation touches the journal, the fold vocabulary, or a provider request (LiteChat/LiteFold/LiteHTTPProvider/LiteLoop all untouched, verified by the diff surface). Restart keeps the list; a corrupt sidecar surfaces as an explicit error row with a stated recovery. Core JVM tests: 587 -> 597 (a new LiteAttachmentsTest suite of ten — path-stripping forms across both separators, sidecar-after-bytes crash form, corrupt-read, cap boundary, typed refusals). The connected device round stays unexecuted (the androidTest face only compiles).

## Open follow-ups

Gen-68 lands both executors with their schemas and the request-face decision for admitted attachments (paired per the gen-62 rule); the camera intake source and pixel-dimension metadata ride with it; the tool-row journal persistence stays a chapter-64 decision.

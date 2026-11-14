# Agent Note: Apple contract adopts the follow-resume request vocabulary (§25)

Status: implemented

English | [中文](2026-10-02-apple-follow-resume.zh.md)

## Problem

Android and Swift need structurally identical follow requests that remain compatible with the Host. Inline envelope construction and fixtures shared only between clients can hide drift from the authoritative Host request type.

## Decision

- Android's pure `NativeFollowResume` object owns Session and subagent address construction, positive page bounds, and `request` assembly. Initial and reconnect requests contain the same address and `maxMessages`; retained sequence numbers stay in the journal.
- The Apple mirror `NativeFollowResume.swift` uses the same builder rules and catchable `NativeFollowResumeError.maxMessages` failure.
- Request envelopes pin structural equality, not byte equality (the model-catalog `wireBody` precedent): key order stays builder-owned on every platform. This is the deliberate contrast with view-location payloads, whose user-visible bytes are pinned exactly.
- Shared fixtures under `apps/apple/contract/fixtures/native-follow-resume/` cover an ordinary request, one-message page, unknown-mode child address, and invalid zero page size. Kotlin and Swift consume them, and the Host scenario checks valid bodies against its generated strict validator.

## Alternatives considered

- **Byte-pinning the envelope:** insertion-ordered maps differ across JSON encoders by design, and request envelopes are machine-read, so structural equality is the honest contract (catalog precedent) and keeps the mirror free of manual JSON building.
- **Duplicating untyped wire validation in typed builders:** the Host owns JSON type validation; native builders enforce positive page sizes. The shared Host check rejects fields or mode values outside the current interface.
- **Leaving the rules inline in `CompanionModels`:** inline construction left the envelope untestable against shared fixtures; the extraction is what lets both columns drive the same authority.

## Consequences

- A Swift client can compose follow and follow-resume requests structurally equal to the Companion's; drift fails the shared fixtures.
- Request fixtures establish the cross-platform construction rules; installed-app recovery and physical-device acceptance remain separate obligations.

## Open work

- The Apple shell consuming the builder (opening a follow stream, including from a view location) remains open; this column lands the envelope vocabulary.
- §25's persisted-window, physical-network, and foreground/push recovery acceptance remain open, as do physical-device qualifications across the native tracks.

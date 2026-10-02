# Agent Note: Apple contract adopts the follow-resume request vocabulary (§25)

Status: implemented

English | [中文](2026-10-02-apple-follow-resume.zh.md)

## Problem

§25's follow resume (optional non-negative `fromSeq` cursor on the `session/follow` ask, reconnects carrying the last applied inclusive seq) ships in the Android core, but the envelope construction rules lived inline in `CompanionModels` and the Apple side had no builder, so a Swift client could not compose the same request. The §25 traceability row lists Swift among the open items.

## Decision

- The Android envelope rules are extracted into the core pure object `NativeFollowResume` (apps/android/core): `sessionAddress`/`subagentAddress` (the two follow address shapes), `withMaxMessages` (positive page size), `withResumeCursor` (non-negative cursor riding only when present — a fresh follow envelope carries no `fromSeq` key), and `request` assembling `{"request": {address, maxMessages, fromSeq?}}`. `CompanionModels` delegates at its four former inline sites (openSession and openChild address construction, replaceFollow's page-size injection, follow's cursor injection).
- The Apple mirror `NativeFollowResume.swift` (apps/apple/contract) adopts the same builder rules with catchable errors (`NativeFollowResumeError.maxMessages`/`.fromSeq`; throwing static functions instead of preconditions, so client self-checks can assert them).
- Request envelopes pin structural equality, not byte equality (the model-catalog `wireBody` precedent): key order stays builder-owned on every platform. This is the deliberate contrast with view-location payloads, whose user-visible bytes are pinned exactly.
- Shared fixtures `apps/apple/contract/fixtures/native-follow-resume/` (one canonical resume, three edge cases — a fresh follow, a zero cursor, a subagent address — and one invalid case; counts pinned 1/3/1 in both columns) run through `NativeFollowResumeFixtureTest` on the Kotlin side (driving the real core object, comparing through `WireValue.fromJsonElement`) and the self-check section in `main.swift` (recursive structural comparison), so both builders reject the same inputs and emit structurally equal envelopes.

## Alternatives considered

- **Byte-pinning the envelope:** insertion-ordered maps differ across JSON encoders by design, and request envelopes are machine-read, so structural equality is the honest contract (catalog precedent) and keeps the mirror free of manual JSON building.
- **Mirroring Host-side validation (fractional, `-0`, boolean fromSeq):** those classes cannot arise from a typed `Int64`/`Long` cursor; the Host's wire boundary keeps validating them — validation stays with the boundary owner.
- **Leaving the rules inline in `CompanionModels`:** inline construction left the envelope untestable against shared fixtures; the extraction is what lets both columns drive the same authority.

## Consequences

- A Swift client can compose follow and follow-resume requests structurally equal to the Companion's; drift fails the shared fixtures.
- The §25 traceability row's Swift item closes at contract level; persisted windows, physical disconnects, and foreground/push recovery stay open.

## Open work

- The Apple shell consuming the builder (opening a follow stream, including from a view location) remains open; this column lands the envelope vocabulary.
- §25's persisted-window, physical-network, and foreground/push recovery acceptance remain open, as do physical-device qualifications across the native tracks.

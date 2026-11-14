# Agent Note: Apple contract adopts the view-location handoff vocabulary (§26)

Status: implemented

English | [中文](2026-10-02-apple-view-location.zh.md)

## Problem

§26's first-stage handoff (transfer the viewing position, never the runtime) ships as the `dsh-session-view.v1` payload — mirrored byte-for-byte between the Web Client and the Android core — but the Apple side had no codec, so a Swift client could neither read nor write the handoff payload. The §26 traceability row lists Swift among the open items.

## Decision

- The Apple mirror `NativeViewLocations.swift` (apps/apple/contract) adopts the exact grammar of the Android core's `NativeViewLocations` (itself the mirror of the Web Client's `encodeSessionViewLocation`/`decodeSessionViewLocation`): encode writes the ordered ASCII JSON `{"hostId":…,"sessionId":…,"anchorSeq":…}` as one `dsh-session-view.v1.`-prefixed base64url document (manual JSON string building preserves the field order dictionaries cannot; only `"` and `\` need escaping in the ASCII range); decode fails loud at every parse boundary — unknown grammar prefix, non-base64url characters, undecodable base64, invalid JSON, a field set other than exactly the three keys, non-string or empty ids, and anchors that are negative, fractional, boolean, `-0`, or beyond the safe-integer range — and never coerces.
- The boolean-anchor trap is guarded by the CF type id (`CFGetTypeID != CFBooleanGetTypeID`): NSNumber bridges `true as? Double` to `1.0` on macOS, so a plain numeric cast would admit booleans the Kotlin/Web codecs reject. `-0` is rejected through sign-and-zero, matching Kotlin's raw-bits check.
- Shared fixtures `apps/apple/contract/fixtures/native-view-location/` (one canonical round-trip that pins the exact encoded bytes, three edge cases — zero anchor, ids carrying escaped quote characters, the max safe integer — and six invalid classes; counts pinned 1/3/6 in both columns) run through `NativeViewLocationFixtureTest` on the Kotlin side (driving the real `NativeViewLocations.encode`/`decode` with the Companion's 4096-character caller bound) and the self-check section in `main.swift`, so both codecs read and write identical payload bytes over the same documents.
- Caller-side size limits and the `dsh-companion://` deep-link wrapper stay client-owned; this contract column pins the shared v1 grammar only.

## Alternatives considered

- **Mirroring the deep-link wrapper:** the `dsh-companion://session-view/` URI is the Android shell's channel, not a cross-client grammar; the Web Client has no counterpart. The v1 payload is the shared surface.
- **Dictionary-based JSON encoding:** `JSONSerialization` order is undefined and `.sortedKeys` alphabetizes — both produce different bytes than the Kotlin/TS insertion-ordered encoders. Manual field-ordered building is the only way the pinned bytes match on every platform.
- **Accepting numeric anchors via a plain Double cast:** macOS NSNumber bridging admits booleans; the CF type-id guard is the documented reliable test (apple-roster-swift precedent).

## Consequences

- A Swift client can read and write handoff payloads bit-compatibly with the Web Client and the Android core; drift fails the shared pinned bytes.
- The §26 traceability row's Swift item closes at contract level; physical devices, share-sheet routing, and the rest of §26's acceptance stay open.

## Open work

- The Apple shell that consumes the payload (open a Session at the anchor) is still open; this column lands the codec.
- §25's Swift mention (follow-resume adoption) remains a separate open item, as do physical-device qualification and cross-device real QR/link delivery channels.

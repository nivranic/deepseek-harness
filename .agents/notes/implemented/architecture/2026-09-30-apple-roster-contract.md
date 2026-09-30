# Agent Note: The Apple contract adopts the section 28 native Host roster vocabulary

Status: implemented

English | [中文](2026-09-30-apple-roster-contract.zh.md)

## Problem

The section 28 remaining-work list carries "Swift 采用" — the Swift contract package mirrored only the Remote failure vocabulary, so an Apple client had no adopted reading of the persisted native Host roster that the Android core already owns (whole-document selection, strict decode, atomic replacement). The apple README also still counted 84 schema-known codes while the check asserts 92.

## Decision

- `NativeHostRoster.swift` adopts the roster's JSON vocabulary and every decode invariant from `FileNativeHostStore`: exact field sets on the root and each row, non-blank strings, the `native-gateway-v1` transport format, the four pairing roles (viewer/collaborator/controller/owner), a 64-lowercase-hex pinned fingerprint, a base64 signing key of exactly 32 bytes, a canonical reachable HTTPS origin (no userinfo/query/fragment, empty-or-root path, plausible port, no any-address host; trailing slash dropped), distinct Host keys, and an active key that names a saved identity — absent exactly when the roster is empty.
- `NativeHostRoster.hostKey` mirrors `nativeHostKey`: SHA-256 hex of the JSON array `[hostId, pinnedFingerprint]`, keeping the key independent of the replaceable device grant. Two platform parsing gaps are handled explicitly: JSONSerialization bridges JSON booleans as NSNumber where `NSNumber(true) == 1`, so `version` rejects booleans before the integer compare; and Kotlin's URI reports the IPv6 any-address as `[::]` while URLComponents reports `::` — both spellings are rejected.
- One fixture set is the shared parity evidence: `fixtures/native-host-roster/` holds one canonical document (two Hosts, active key, trailing-slash origin, port) plus 14 rejected cases (version, extra root/host field, blank string, role, fingerprint case, short key, transport format, http endpoint, query endpoint, duplicate Host, unknown active, active with empty roster, missing active key). The Swift self-check (`main.swift`) decodes the canonical document and rejects every invalid case by rule; `NativeHostCatalogTest` feeds the identical bytes through the Android `FileNativeHostStore`, so both implementations accept and reject the same documents.
- Local verification: the Kotlin parity test runs green through gradle (`:core:test`, 375 tests, 0 failures); the Swift half compiles and runs only on the macOS CI lane (`swift run dsh-contract-check`) — no Swift toolchain exists on this Windows host, so Swift-side execution is claimed only after CI evidence, per the swiftCiRecovery precedent. The apple README (both languages) documents the adoption and corrects the stale 92-code count.

## Alternatives considered

- **Generate the Swift model from a JSON Schema:** the roster has no schema authority (the Android core is the authority, like the pairing model); a hand-written strict mirror with shared fixtures keeps one source of truth instead of introducing a schema generator for one document type.
- **XCTest cases instead of the self-check executable:** the package deliberately carries one executable target (the hosted macOS runners fail test-target imports nondeterministically); the roster checks extend the same plain-exit-code pattern.
- **Copy the fixtures into the Android test tree:** duplicated fixtures drift; the Kotlin test discovers the canonical directory by walking up to the repository root, keeping one fixture set.

## Consequences

- §28's Swift-adoption item now has contract-level evidence: both native implementations enforce the same roster vocabulary and invariants on identical bytes, and a future Apple shell can read the Android-written roster document.
- Any drift in either implementation's acceptance breaks its own lane (Swift self-check on CI; Kotlin parity test locally and in CI).

## Open work

- The Swift half has no local execution on Windows hosts; its green state rests on the macOS CI lane (and on desk-checked parity until that run completes).
- Roster write/re-pair semantics (atomic swap, preserve-and-start-fresh) remain Android-core behavior; the Swift mirror reads and validates only, as the contract layer.

# Agent Note: Shared Apple Remote Core (Phase 2 opening increment)

Status: implemented

English | [中文](2026-08-30-shared-apple-remote-core.zh.md)

## Problem

Phase 2 of the nativization plan (E:\11585 plan, chapter 73) opens with the Shared Apple Remote Core: before any iOS/iPadOS/macOS companion UI exists, the Apple side needs the link-client state machine — pair, SPKI pinning, signed unary RPC, NDJSON streams — built over the wire models the Contract Generator already emits, with the golden fixtures replayed cross-language per chapter 19. The repository had no Swift code, no SwiftPM package, and no mechanism keeping Swift-side copies of generated artifacts fresh.

## Decision

`apps/apple` is a SwiftPM package (iOS 16+, macOS 13+) whose single library target, `SharedAppleRemoteCore`, mirrors `dsh-link-client`'s state machine with no UI imports: `LinkClient` (pair / describe / call / stream, gateway `client-request`/`server-response` envelope handling in `LinkWire`), `LinkSigning` (the canonical `timestamp\nmethod\npath\nsha256hex(body)` input, Ed25519 via CryptoKit, fixed SPKI headers for Ed25519 and P-256 keys), `LinkPinningDelegate` (the leaf certificate's SPKI fingerprint is hashed in the TLS challenge handler and any mismatch cancels the handshake before a request byte is written), and credentials behind a `LinkCredentialsStoring` protocol with Keychain and in-memory implementations. Generated artifacts are synced, not forked: `gen-link-contracts` now also writes `LinkContracts.swift` into the package sources, one JSON file per golden fixture into `generated/fixtures/`, and copies those fixtures into the test bundle's resources; `verify-link-contracts` (the hygiene-aggregate drift gate) compares every copy byte-for-byte. XCTest fixtures replay each JSON into the generated model and round-trip the pairing payload; signing tests cover the canonical input, SPKI framing, and a sign/verify round-trip.

## Consequences

A wire-type change now fails three gates before a companion ships: typecheck (the zod schemas stop satisfying the protocol types), the manifest/Swift/Kotlin drift gate, and — once a macOS runner lands — `swift test` on the synced fixtures. The Swift sources are authored but not compiled in this repository's CI yet: this Windows host cannot run Xcode, and the repo's runners are Linux, so compile verification waits for a macOS lane; the fixture and drift gates carry the contract guarantees meanwhile, and the package deliberately avoids exotic Swift so a first `swift build` is low-risk. The companion apps themselves (session UI, approvals, plan/todo/goal, files/diff/artifact viewers, the 简约拟态 + 液态玻璃 dual themes) are the next increments over this core.

## Alternatives considered

Vendoring the models into the Swift package by hand was rejected immediately — it would fork the contract. A symlink from the package sources to `generated/` would avoid the copy, but SwiftPM targets cannot include files outside the package directory and Windows checkouts cannot materialize the link. Rewriting the reference client's tests in Swift first was deferred: the fixture replay plus signing-vocabulary tests pin the wire contract, while full state-machine tests (a local TLS server in Swift) belong with the compile lane that can actually run them.

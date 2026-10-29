# Agent Note: The macOS Swift lane

Status: implemented

English | [中文](2026-08-30-macos-swift-lane.zh.md)

## Problem

Every Apple artifact so far — the three libraries, their tests, the contract mirror — shipped authored-not-compiled: fixture drift was gated on the TypeScript side, but nothing proved the Swift compiled or the tests passed. Chapter 62's conformance promise (same fixtures, same domain state, in TypeScript and Swift) had no executing Swift half, and the two deferred user decisions (macOS track timing, relay priority) gated on exactly this lane existing.

## Decision

The user resolved both decision points to the recommendation: spin the macOS lane now; relay stays LAN-first and deferred. `.github/workflows/apple-swift.yml` runs `swift test` on `macos-latest` for every `apps/apple` change (pull request, dev, and master pushes, plus manual dispatch), path-filtered, with a per-package cache and the repo's PR-only cancellation policy. The package has zero external dependencies, so the job is a checkout plus the test run. Ten iterations over the lane's logs took the never-compiled sources to green: the `SecCertificateCopyPublicKey` CFTypeRef dance never compiled (the modern `SecCertificateCopyKey` is cross-platform), the wire payload encoder lacked `try`, `LinkWire` carried two structurally identical JSON enums that made request and response values mutually unconvertible (hoisted into one `Codable WireValue`), `LiteUsage`/`LiteTodo`/`LiteArtifactStatus` redeclared conformances, `Streaming` needed mutability and a public init, toolbar placements and `ButtonRole` members were iOS-only, fixture round-trips compared non-Equatable `Any` dictionaries (now sorted-key bytes), and the subagent catalog's diagnostic arm omits `activity`/`hasChildren`/`mode` — the contract row now carries them optionally and `SubagentRow.mode` is optional.

The lane's first runtime pass exposed real defects no type could: `WireShape.object` returned non-object fields (interaction forwards read payloads off the event-name string), inbox dedupe compared whole cards instead of event ids, the fake follow stream finished immediately and made every view model resubscribe and replay its stub mid-assertion (a real follow stream ends only on loss; the fake now stays open until cancelled), and file ranges counted grapheme clusters where every range speaks UTF-16 units.

## Consequences

All 55 Swift tests compile and pass on macOS — the chapter-62 TypeScript/Swift conformance is machine-verified on both sides for the first time, and every future `apps/apple` change carries the proof. The standing "authored-not-compiled" caveat in every prior note is retired. Xcode app shells are now unblocked as the next increment. CI iteration happens by pushing to dev and reading the lane's log (job logs via the API with the host's stored credential; the two hop-redirect requires dropping the auth header on the blob hop).

## Alternatives considered

A Windows-side Swift toolchain was rejected — SwiftPM plus FoundationNetworking on Windows is a support surface of its own and the plan named a macOS runner from the start. Extending ci.yml with a macOS job was rejected — a path-filtered dedicated lane keeps Apple changes off the paid Linux job graph and fires on dev pushes, which the pull-request-only main CI never sees.

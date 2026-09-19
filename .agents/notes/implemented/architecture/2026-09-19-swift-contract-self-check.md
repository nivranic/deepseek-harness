# Agent Note: Swift contract column runs as a self-check executable

Status: implemented

English | [中文](2026-09-19-swift-contract-self-check.zh.md)

## Problem

The Swift contract package carried its mirror evidence in an XCTest bundle (`DSHContractTests` with `@testable import DSHContract`), and the macOS CI lane could not build it: across twenty dispatched runs the test module died importing the library module with no usable diagnostic ("no such module 'DSHContract'" or a missing `DSHContract-Swift.h` through the synthesized module.modulemap).

## Current upstream boundary

The evidence claims in the sealed apple-contract record require the lane to actually run: mirror equality with the generated projection, classified codes declared by the schema, unclassified codes resolving to `unknown`, and the opaque unknown branch excluding all 84 known codes. A lane that cannot build produces no evidence at all.

## Decision

Replace the XCTest bundle with a single executable target, `dsh-contract-check`: the enum mirror stays in `Sources/DSHContract`, a `main.swift` asserts the same four checks with plain exit codes, and the fixtures live in `contract/fixtures/` (refreshed there by `scripts/gen-remote-failure-classes-json.mjs`). The CI job runs `swift run dsh-contract-check` on the `macos-15` runner. Twenty rounds of probes isolated the failure to the hosted-runner test-bundle path, not the sources: standalone module emission and ObjC header emission pass in under a second, a minimal fresh package with a test target reproduces the import failure on both installed macos-14 toolchains and serial builds, and the macos-14 image itself is scheduled for deprecation. An executable has no XCTest bundle, no `@testable`, and no cross-module import, so the pathological path does not exist.

## Alternatives considered

Pinning `DEVELOPER_DIR` to Xcode 16.2 mixed toolchains (the 5.10 driver planned the old module layout while the 6.0.3 compiler wrote `Modules/`) and was abandoned for the 16.2 binary path. Serial `swift test -j 1` did not change the failure. A library-first two-step build closed the emission race but then linked the test executable without the library objects. Keeping XCTest and pinning an external macOS runner was rejected as new infrastructure for no product value.

## Contract

`swift run dsh-contract-check` in `apps/apple/contract` exits 0 after printing four PASS lines, or exits 1 with a `FAIL <detail>` line on stderr. `node scripts/gen-remote-failure-classes-json.mjs` refreshes `contract/fixtures/` from the built protocol package; committed drift fails the check.

## Persistence

None; the package is a build-time evidence artifact with no runtime state.

## Security

No new inputs, network paths, or privileged operations; the executable reads two fixture JSON files from its own package directory.

## Compatibility

The package name and the `RemoteFailureClass`/`RemoteFailureClasses` API are unchanged; only the target kind (executable) and the fixtures location change. The Kotlin column is untouched.

## Failure handling

A FAIL line names the violated invariant and the check exits nonzero, failing the CI job. A missing or stale fixture fails to decode and exits nonzero through the top-level error.

## Testing

CI run 35450241173, job 105916046840 (macos-15-arm64, Swift 6.1.2): four PASS lines, job conclusion success, log archived at `.artifacts/swift-ci-recovery-lane.log`. The lane had failed seventeen consecutive dispatched runs before the rework.

## Rollout

Source-tree and workflow only; the lane changed from `swift test` to `swift run dsh-contract-check` on macos-15.

## Rollback

Restore the XCTest target and `Tests/DSHContractTests` from the apple-contract record's archive and revert the CI job to `swift test`.

## Consequences

The Swift column's evidence is a deterministic exit-code check instead of an XCTest bundle, and the lane is green on macos-15. The mirror is no longer an importable library module; a future Swift shell consumes the generated JSON projection or re-mirrors in its own module.

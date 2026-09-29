# Support Bundle Implementation Plan

English | [中文](2026-09-08-support-bundle.zh.md)

**Goal:** Export local diagnostics for Windows, macOS, iOS/iPadOS and Android with explicit collection results and zero secret findings over the final exported bytes.

**Architecture:** Each running application projects its own state into an immutable JSON document. Runtime and transport owners supply fixed categories and bounded counts; the export operation applies the complete size limit and fails closed on an incomplete secret scan. Existing profile launchers, Gateway authorization and Session ownership remain authoritative.

**Technology:** Swift/Foundation, Kotlin, existing Cordis plugins and typed Remote APIs, the pinned Gitleaks scanner and current candidate workflows.

## Scope and acceptance

This plan implements G2-SUPPORT from the [handoff](../../artifacts/verification/goal-mode-handoff-2026-09-05.md#82-gate-2--release-engineering-foundation). Each platform must collect application version/build/channel, runtime health, connection state, diagnostic events, protocol versions, the relevant role, capabilities and update state. One platform or one partial document cannot close G2-SUPPORT. Export remains local and requires an explicit user action; it does not enable telemetry or upload data.

Every section identifies its producer and whether the observation is current, last known, not applicable, unavailable or failed. Uncollected information is never healthy, authorized or up to date. The initial Mac runtime export remains partial until transport, update and native diagnostic producers are connected. Acceptance records stay bound to the candidate, executable and exact export digest.

## Data ownership and privacy

Application identity comes from the packaged product metadata. The Link package version is not the application version. Apple uses its expanded AppInfo.plist; Android uses generated build metadata; the desktop stage must carry product identity into its runtime. An absent source SHA remains absent until a build-owned runtime record supplies it.

Mac runtime health comes from RuntimeSupervisor. Web connection observations use the actual generation owner and distinguish the initial connecting state from reconnecting. A listening Link socket does not establish a connection or runtime health. Native clients retain pairing roles as last-known observations; current authorization requires an authenticated response from the authoritative Device Trust owner.

Diagnostic records contain only closed state/failure categories and bounded counts. They exclude raw process output, exception messages, credentials, prompts, tool payloads, paths, addresses, device names, host identifiers and pseudonymous telemetry identifiers. A second SessionTelemetryCoordinator is unsuitable because its module-level handoff cursor is shared. Local diagnostic capture must not interfere with that cursor or enable its external sink.

The document declares omitted sections explicitly. Exported strings are limited to validated build metadata and fixed protocol vocabulary. The complete UTF-8 document is bounded before scanning; packaging cannot add fields after scanning. A failed, timed-out or unavailable scanner prevents delivery. Scanner canaries exercise default rules and cannot be suppressed by source-review exceptions.

## Selected approach and alternatives

Start with the Mac Host's native export action because its supervisor already owns concrete lifecycle and health results. Extend the existing pinned scanner installer to both macOS architectures, then package the scanner with the app and scan immutable export bytes offline. Preserve scanner licensing and binary provenance in the candidate inventory. The current Windows/Linux installer remains usable for release verification.

A release-only JSON summary cannot diagnose a running application. Whole-log redaction allows unknown payloads into the export and therefore loses to explicit projection. A second Gateway or a new Session domain would duplicate existing authority. These alternatives are excluded.

Mobile platforms cannot launch the desktop CLI. Before connecting mobile delivery, build and exercise an offline library adapter using the same maintained scanner rules, including the real canary and final-byte tests. Failure to establish that adapter keeps mobile export unavailable while independent Windows, Mac and producer work continues; it does not waive the mobile requirement.

## Task 1: Enable verified macOS scanner acquisition

**Files:** `.github/security/scanners.json`, `scripts/release/secret_scan.py`, `scripts/release/test_secret_scan.py`.

1. Record official Gitleaks 8.30.1 Darwin x64/arm64 archive URLs and independently verified SHA-256 digests. Retain the existing Linux and Windows pins.
2. Add executable tests for both Darwin architectures, unsupported platform pairs, archive tampering, the wrong binary name, and version mismatch. Invalid selection must fail before network access or execution.
3. Extend the existing installer without executing a foreign architecture or weakening digest/version checks. Run the focused Python suite on Windows and Linux; actual Darwin execution belongs to the remote Mac lane.

## Task 2: Deliver the Mac runtime export

**Files:** `apps/apple/Sources/DirectHostRuntime/`, `apps/apple/Hosts/HostSurface.swift`, `apps/apple/Hosts/HostCopy.swift`, `apps/apple/Tests/DirectHostRuntimeTests/`, `apps/apple/UITests/DirectHostStartupTests.swift`, `scripts/produce-mac-host.ts`, `.github/workflows/mac-host-candidate.yml`.

1. Add a fixed-field snapshot of the actual supervisor status and bounded lifecycle counts, with separate failure and collection results. Snapshotting must not start, stop or reconfigure the runtime.
2. Validate the bundled identity and serialize one immutable JSON value. Add payload canaries to ignored producer fields and prove they never reach serialization. Preserve owner-local expected output for stopped, ready and failed states.
3. Package the verified scanner and license before final signing. Run it without inherited configuration, ignores or credentials; retain only fixed scan outcomes. Bound process execution and await termination on cancellation and timeout.
4. Add a localized export action and native save dialog. Present only scanner-approved bytes. A failed or cancelled save does not claim success. The action works when the runtime failed to launch.
5. Exercise the installed candidate action, read its actual saved bytes, verify product identity and state, scan the exact bytes independently, and retain a digest plus native UI evidence. Missing producer sections remain explicit and G2-SUPPORT stays partial.

## Task 3: Connect Host and Windows producers

**Files:** existing owners under `packages/remote/`, `packages/api/`, `packages/client/`, `apps/desktop/` and `scripts/release/`.

1. Expose the required diagnostic projection through the existing authorized Gateway. Do not expand the remote administrative allowlist for convenience; test direct denial through the executor.
2. Connect actual protocol/capability and role observations. Keep the local application and connected Host identities separate, and clear generation-specific observations when their connection is lost.
3. Add lifecycle category capture through scoped effects without storing raw logs or creating an anonymous identity. Test disposal, duplicate delivery and bounded output.
4. Connect the real updater owner once implemented. Record unchecked, checking, available, applying and failed outcomes only when that owner emits them; absent implementation does not imply up to date.
5. Exercise the shipped Windows profile and installed candidate export on an ephemeral runner. Scan final bytes and retain the successful and denied-export evidence.

Windows lifecycle design: wrap the existing native profile startup and shutdown calls with an observation-only owner. Preserve results and rejections, prevent older operations from replacing newer phases, and copy fixed phase/failed-operation fields before asynchronous export collection. Label the current observation `profile-lifecycle`; do not infer provider availability. Verify pending and failed operations, retired settlements and snapshot copying locally, then require the fresh installed/portable export to contain the native ready phase.

## Task 4: Connect native mobile producers and scanning

**Files:** `apps/apple/Sources/SharedAppleRemoteCore/`, `apps/apple/Sources/CompanionUI/`, `apps/android/core/`, `apps/android/app/` and their existing platform workflows.

1. Prove the maintained scanner's offline library adapter can execute on iOS and Android with the pinned rules and canary. Keep build artifacts platform-specific and disclose their source/module inventory.
2. Project connection recovery, authenticated host description, last-known pairing role and application identity from their owners. Exercise revoked, disconnected, reconnecting and unavailable states without serializing identity stores.
3. Add native local export through the same immutable-byte and zero-findings admission rule. Test cancellation, oversized input, poisoned metadata, scanner failure and unknown protocol data. Android retains admitted bytes in its Activity ViewModel across configuration recreation; native tests must prove exact-byte retention, one-time consumption and clearing after final destruction, while process restoration remains unapproved.
4. Exercise actual iOS/iPadOS and Android export actions in their remote native lanes. Missing local Xcode does not stop independent implementation; remote compilation and product evidence remain required for those claims.

## Task 5: Close only verified coverage

Update the affected README pairs and decision note, re-record pairing, and run focused tests, `test:docs`, `doc-sync`, lint and normal pre-push checks. Keep the existing dev draft PR. Preserve the single handoff and a machine-readable per-platform coverage matrix. G2-SUPPORT closes only after all required producers and all four platform exports pass against the same candidate; other Gate 2–4 requirements remain independent.

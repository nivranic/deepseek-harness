# Gate 2 Product Identity Implementation Plan

English | [中文](2026-09-05-gate-2-product-identity.zh.md)

> **For Claude:** Use `executing-plans` to implement this plan task by task.

**Goal:** Give Windows, Apple, and Android builds one application version, build sequence, and distribution channel with executable drift rejection.

**Architecture:** Keep the workspace root manifest as the application SemVer owner. Store only the build number and channel in release metadata, generate platform representations, and validate every consumer before packaging. Link protocol, contract, and Session format versions remain independently owned.

**Tech Stack:** TypeScript, existing release scripts, Vitest, Gradle properties, XcodeGen/xcconfig, electron-builder, and repository documentation checks.

---

## Scope and prerequisites

This plan implements G2-VERSION and the identity/policy portion of G2-CHANNEL. The [handoff](../../artifacts/verification/goal-mode-handoff-2026-09-05.md#82-gate-2--release-engineering-foundation) retains the complete Gate 2–4 scope. RC artifacts, update feeds, store submission, signing, and promotion require their later owning tasks; creating this plan does not pass any release gate.

Preparation can run while the Gate 1 repair candidate completes CI. Record actual verdicts in [Gate 1 evidence](../../artifacts/verification/gate-1/gate1-evidence.json) before declaring entry. The Apple environment deferral does not waive a product failure. Keep all work in the existing implementation worktree and preserve the user's `dev` checkout.

## Selected design

Use `package.json.version` plus `release/product.json` containing `schemaVersion`, `buildNumber`, and `channel`. Begin with the existing SemVer, build number `1`, and channel `dev`; do not invent a release tag or increment the product version as part of introducing the mechanism. Build numbers advance for each new distributed candidate, including a channel transition; a retry of the same candidate retains its identity.

Generate `release/product.generated.json`, `apps/android/product-version.properties`, and `apps/apple/Config/Product.xcconfig`. The generated JSON contains the full SemVer, numeric marketing version, build number, platform build representations, and channel. A later RC manifest binds that identity to the source SHA and artifact digests; embedding the current commit into a committed generated file would create a self-reference.

The Windows four-component file version limits every component to `65535`; enforce the same build-number ceiling. Map Apple build numbers monotonically to three components: `1 + floor(buildNumber / 10000)`, `floor(buildNumber / 100) % 100`, and `buildNumber % 100`. Android consumes the integer unchanged. Thus build `1` maps to Apple `1.0.1` and Windows `<major>.<minor>.<patch>.1`; validate numeric limits before writing any output.

Channels select distribution policy and artifact identity without changing runtime composition. `dev` is a development artifact; `canary` is an opt-in prerelease; `beta` accepts only `beta` or `rc` prerelease identifiers; `stable` accepts no prerelease. Promotion and upload remain disabled until their own protected release workflow exists. Channel selection never changes protocol acceptance or enables a product capability.

**Alternatives:** Per-platform manual versions preserve drift and were rejected. Deriving the application version from the Link protocol conflates release cadence with interoperability and was rejected. CI run numbers alone cannot reproduce a candidate from its committed inputs, so the build number is explicit; RC validation must compare it with the previously distributed manifest.

### Task 1: Parse and render the identity

**Files:** Create `scripts/release/product-identity.ts`, `scripts/release/product-identity.spec.ts`, and `release/product.json`.

1. Add failing tests for the current application version, each channel, malformed metadata, unknown keys, invalid SemVer, numeric overflow, and stable/beta mismatches. Test transitions at Apple component boundaries and reject a non-increasing build number against a previous distributed identity.
2. Run `pnpm exec vitest run scripts/release/product-identity.spec.ts` and retain the initial failure.
3. Implement a pure parser/renderer with strict validation at file input. Keep filesystem writes outside the pure implementation; validate the complete output set before any write.
4. Run the focused tests; require deterministic bytes and exactly one trailing newline for each output. Do not add protocol constants to the input file.

### Task 2: Generate and verify platform inputs

**Files:** Create `scripts/gen-product-identity.ts`, `scripts/verify-product-identity.ts`, `release/product.generated.json`, `apps/android/product-version.properties`, and `apps/apple/Config/Product.xcconfig`; modify `package.json` and `scripts/run-gates.ts`.

1. Add `gen-product-identity` and `verify-product-identity` commands. The verifier reads source inputs and compares all expected generated bytes; it never repairs a stale file while checking.
2. Wire the verifier into the existing static/hygiene aggregate. Add a focused aggregate-membership assertion to the owning gate test.
3. Generate twice and require no second diff. Mutate each generated file in an isolated fixture and require the verifier to reject it, including the original Android `0.1.0` drift.

### Task 3: Connect the real consumers

**Files:** Modify `apps/android/app/build.gradle.kts`, `apps/apple/project.yml`, and `scripts/build-desktop-exe.ts`.

1. Load the generated Gradle properties without fallback versions. Configure all Apple application targets through the generated xcconfig for marketing/build version and retained full version/channel metadata.
2. Validate the desktop manifest against the root identity before staging. Pass the derived file build version and channel metadata to packaging without enabling publication.
3. Exercise Android assembly and inspect the built package metadata. Use the macOS lane to inspect resolved Xcode build settings and build all application schemes. Keep unsigned Windows packaging and installation smoke under G2-WIN if that artifact work is not yet ready.

### Task 4: Preserve release-bump ownership

**Files:** Modify `scripts/release/bump.ts` and its owning tests.

1. Make the dsh bump validate the selected identity, render native outputs after the root version rewrite, and include those outputs in its normal commit. The vendor sequence must not touch product metadata.
2. Extend dry-run tests to prove no writes or Git mutations. An invalid channel/version combination must fail before changing manifests.
3. Verify the release planner in an isolated fixture; do not execute a real version bump, tag, or publication on this candidate.

### Task 5: Document and record the result

**Files:** Add a bilingual product-identity reference under `docs/development/`, update affected Apple/Android/desktop README pairs, and add an implemented Agent Note under `.agents/notes/implemented/architecture/` once behavior is verified.

1. Retain the independent npm release-sequence rationale and link the new application metadata decision; it is a partial extension, not a replacement of vendor/native publication ownership.
2. Record exact commands, source inputs, platform outputs, failures, and remaining packaging limits in `artifacts/verification/gate-2/G2-VERSION.json` and `G2-CHANNEL.json`.
3. Run focused behavior tests, generated drift verification, relevant builds, `test:docs`, `doc-sync`, and lint. Record platform checks that have not executed without promoting them to PASS.
4. Commit normally, inspect hook edits, and push under the existing authorization. Keep the PR draft and preserve all remaining Gate 2–4 tasks in the handoff.

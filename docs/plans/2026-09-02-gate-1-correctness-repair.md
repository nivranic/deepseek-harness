# Gate 1 Contract-owned Correctness Repair Implementation Plan

English | [中文](2026-09-02-gate-1-correctness-repair.zh.md)

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Make the shipped Remote vertical slice interoperable across the Host, Swift, and Kotlin clients, with resource-scoped authorization, privacy-safe telemetry, deterministic recovery, and one verified release-candidate commit.

**Architecture:** Preserve the Typert Gateway, Session, Projection, Interaction, Device Trust, and existing carrier owners. Extend the canonical `dsh-link-contracts` source graph so generated Swift and Kotlin artifacts own transport and Remote-event fields, then repair each consumer against those generated fields. Treat real Host composition and cross-language execution as blocking evidence; fake servers and source inspection remain supporting evidence only.

**Tech Stack:** TypeScript, Cordis, Typert, Vitest, Swift/SwiftPM, Kotlin/JUnit, Gradle, YAML, GitHub Actions, and the repository documentation gates.

---

## Scope and execution rules

This plan implements only the P0 work in Gate 1. Gate 2 planning starts only after every mandatory exit assertion below passes or has an explicit host-environment blocker that the requirement permits.

- Start every task from the last committed checkpoint on `codex/goal-mode-full-implementation`.
- Write a failing test or preserve a reproducible failing command before changing behavior.
- Update the owning README, JSDoc, active Agent Note, generated artifacts, and bilingual counterpart in the same logical commit.
- Exclude `vendor/` and `.agents/notes/archived/` from discovery and edits.
- Save task evidence under `artifacts/verification/gate-1/` with the source commit, exact commands, results, changed files, limitations, and next dependencies.
- Do not publish, sign with production credentials, submit to a store, expand the Relay, add a second Gateway, or add another Session authority.

## Mandatory exit assertions

- The shipped base composition parses and `apps/cli/tests/link-session-slice.e2e.ts` starts the real Host.
- Gateway stream and Remote-event tests pass without bypassing loader composition.
- `pnpm run test:docs` and every repository-owned `pnpm run doc-sync` leaf pass.
- The canonical contract owns unary, stream, ready, emit, waterfall, cancel, outcome, void success, error, sequence, cursor, version, capability, and unknown-optional-field semantics.
- Generated manifest, schema, fixtures, Swift, and Kotlin outputs are fresh and decode the same corpus.
- Real Host-to-Swift and Host-to-Kotlin acceptance covers pair, connect, describe, list, open, history, follow, prompt, stream, approval, cancel, reconnect, and revoke.
- Android rejects a wrong SPKI pin and reconnects after a dropped follow stream.
- Authorization denies out-of-scope session, workspace, interaction, resource, and path access.
- Multi-device approval is first-valid-wins without duplicate side effects, and recovery has no silent permanent gap.
- Telemetry exports no prompt, source, tool arguments or results, system prompt, credential, or workspace path by default.

### Task 1: Record and commit the execution baseline

**Files:**

- Create: `artifacts/verification/gate-1/implementation-baseline.json`
- Create: `docs/plans/2026-09-02-gate-1-correctness-repair.md`
- Create: `docs/plans/2026-09-02-gate-1-correctness-repair.zh.md`
- Create: `docs/plans/2026-09-02-gate-1-correctness-repair.i18n.yaml`

**Steps:**

1. Confirm the current branch, HEAD, upstream, worktrees, remote names, `dev`/`master` heads, merge-base, divergence, and commits after the verification snapshot.
2. Confirm the original worktree still contains only the user-owned untracked verification report and that the implementation worktree is clean.
3. Write the baseline JSON with the sanitized remote, observed SHAs, original dirty-state preservation, command list, and Gate 1 dependencies.
4. Record and verify the bilingual plan pair.
5. Run `git diff --check` and inspect the full diff.
6. Commit with `chore(goal): record Gate 1 execution baseline`.

### Task 2: Repair shipped and test composition

**Files:**

- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify as evidence requires: `packages/api/gateway/tests/gateway-stream.host.spec.ts`
- Modify as evidence requires: the loader fixture or service injection owner used by `packages/api/gateway/tests/gateway-stream.host.spec.ts`
- Test: `apps/cli/tests/link-session-slice.e2e.ts`
- Update: the active Agent Note that owns the affected composition decision

**Steps:**

1. Run `pnpm exec vitest run packages/api/gateway/tests/gateway-stream.host.spec.ts apps/cli/tests/link-session-slice.e2e.ts` and save the before log.
2. Add a narrow YAML parser assertion that fails on the shipped invalid row if the existing e2e does not isolate it clearly.
3. Fix the shipped YAML at its owning row without disabling Link access or bypassing the loader.
4. Make the Gateway test composition inject the services required by `client-connection`; do not change product behavior solely to satisfy a hand-built context.
5. Re-run the focused command and save the after log.
6. Run the affected package tests, `git diff --check`, and commit with `fix(remote): restore shipped Link composition`.

### Task 3: Remove repository-owned documentation drift

**Files:**

- Modify owner JSDoc and type declarations reported by `doc-sync`
- Regenerate: `docs/config-catalog.md` and other generator-owned English outputs reported stale
- Update: affected `docs/subsystems/*.md`, `docs/subsystems/*.zh.md`, and `*.i18n.yaml` pairs
- Modify as evidence requires: TypeScript path/config owners reported by the gate

**Steps:**

1. Run `pnpm run test:docs` and `pnpm run doc-sync`; save each leaf result and classify repository drift separately from host symlink permission failure.
2. Fix owner source before generated output for public signature types, Cordis inspect/config catalog, exported `@returns`, Artifact subsystem ownership, and TypeScript paths.
3. Regenerate derivatives and minimally update bilingual counterparts.
4. Re-run the affected leaf after each repair iteration, then run both aggregate commands.
5. Save `artifacts/verification/gate-1/G1-DOC.json`, run `git diff --check`, and commit with `docs: restore repository documentation freshness`.

### Task 4: Make the Link source graph own the complete wire protocol

**Files:**

- Modify: `packages/remote/link-contracts/src/index.ts`
- Modify: `packages/remote/link-contracts/src/generate.ts`
- Modify: `packages/remote/link-contracts/tests/link-contracts.spec.ts`
- Modify: `packages/api/gateway/src/stream-protocol.ts`
- Modify: `packages/api/gateway/src/client/remote-events.ts`
- Modify: `packages/remote/link-access/src/protocol.ts`
- Update: `packages/remote/link-contracts/README.md`, its Chinese counterpart, and their pairing record
- Add or supersede: an active architecture Agent Note for canonical Link transport and Remote-event ownership

**Steps:**

1. Add contract tests for unary `{ payload: { args } }`, streams, ready/client identity, emit, waterfall request, cancel, outcome, void success, structured errors, sequence/cursor, independent versions, capabilities, and ignored unknown optional fields.
2. Run the contract tests and confirm the missing protocol fields fail before implementation.
3. Extend the existing source graph; do not add a handwritten JSON Schema or a second protocol table.
4. Make Host protocol code consume or prove equivalence to generated definitions at the typed same-process boundary.
5. Run the focused TypeScript tests and `pnpm run verify-link-contracts`; keep the drift failure as expected evidence until Task 5 regenerates outputs.
6. Run `git diff --check` and commit with `feat(link-contracts): own transport and event protocol`.

### Task 5: Regenerate and prove Swift/Kotlin equivalence

**Files:**

- Modify: `scripts/gen-link-contracts.ts`
- Modify: `scripts/verify-link-contracts.ts`
- Regenerate: `packages/remote/link-contracts/generated/**`
- Regenerate: `apps/apple/Sources/SharedAppleRemoteCore/LinkContracts.swift`
- Regenerate: `apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures/**`
- Regenerate: `apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`
- Regenerate: `apps/android/core/src/test/resources/fixtures/**`

**Steps:**

1. Run `pnpm run gen-link-contracts` from the canonical source graph.
2. Add decoder/conformance assertions that replay the same payload bytes through Swift and Kotlin model tests.
3. Run `pnpm run verify-link-contracts` and then regenerate once more followed by `git diff --exit-code`.
4. Run the TypeScript fixture tests; run `swift test` and `gradle --no-daemon test` on capable hosts, otherwise preserve the platform workflow command and mark only the unavailable execution as `NOT_EXECUTED`.
5. Save `artifacts/verification/gate-1/G1-GEN.json`, run `git diff --check`, and commit with `chore(link-contracts): regenerate native protocol artifacts`.

### Task 6: Repair Apple Remote ownership and event handling

**Files:**

- Modify: `apps/apple/Sources/SharedAppleRemoteCore/LinkClient.swift`
- Modify: `apps/apple/Sources/CompanionUI/RemoteSessionViewModel.swift`
- Modify: `apps/apple/Sources/CompanionUI/InteractionViewModel.swift`
- Test: `apps/apple/Tests/**`
- Update: `apps/apple/README.md`, its Chinese counterpart, pairing record, and the active Apple Remote Agent Note

**Steps:**

1. Add failing tests for fresh-pair wire replacement, Host `ready.clientId`, the nested waterfall request, outcome frames, void RPC success, and authoritative refresh after reconnect.
2. Run `swift test` on macOS or the repository Apple workflow; preserve a host blocker on Windows without claiming a pass.
3. Implement the minimum client changes using generated envelopes and one credential-owned active wire.
4. Run Swift unit/fake-server tests and the real Host acceptance corpus from Task 9.
5. Save `artifacts/verification/gate-1/G1-APPLE.json`, run relevant documentation checks, and commit with `fix(apple): align Remote client with Host protocol`.

### Task 7: Repair Android TLS, ownership, envelopes, and reconnect

**Files:**

- Modify: `apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkClient.kt`
- Modify: `apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkPinning.kt`
- Modify: `apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionModels.kt`
- Test: `apps/android/core/src/test/kotlin/ai/deepseek/dsh/link/LinkClientTest.kt`
- Test: `apps/android/core/src/test/kotlin/ai/deepseek/dsh/link/LinkPinningTest.kt`
- Update: `apps/android/README.md`, its Chinese counterpart, pairing record, and the active Android Remote Agent Note

**Steps:**

1. Add failing tests for the Host envelope, authoritative client identity, outcome frames, fresh-pair wire replacement, right-pin success, wrong-pin rejection before request bytes, dropped-follow reconnect, and snapshot/history resynchronization.
2. Run `gradle --no-daemon test` in `apps/android` and save the failing cases.
3. Enforce SPKI pinning in the TLS client actually used for every request and stream; remove any stored-but-unenforced security state.
4. Add bounded reconnect with authoritative resynchronization and disposal that reaches quiescence.
5. Run unit tests, `gradle --no-daemon :app:assembleDebug`, and the real Host acceptance corpus from Task 9.
6. Save `artifacts/verification/gate-1/G1-ANDROID.json`, run relevant documentation checks, and commit with `fix(android): enforce Link security and recovery`.

### Task 8: Enforce minimum resource scopes and privacy-safe telemetry

**Files:**

- Modify: `packages/remote/link-access/src/index.ts`
- Modify: `packages/remote/link-access/src/protocol.ts`
- Test: `packages/remote/link-access/tests/**`
- Modify: `packages/session/session-telemetry/src/**`
- Modify: `packages/session/session-telemetry-otel/src/**`
- Test: `packages/session/session-telemetry/tests/**`
- Test: `packages/session/session-telemetry-otel/tests/**`
- Update: affected package README pairs, subsystem pairs, privacy inventory, and active Agent Notes

**Steps:**

1. Add denial tests for unauthorized session, workspace, interaction, resource, and path; also cover revoked devices, observer mutation, disabled Remote Approval, and a non-pending interaction.
2. Add telemetry tests for disabled export, prior consent/feedback authorization, allowlisted safe fields, and rejection/redaction of prompt, source, tool payloads, system prompt, credentials, and workspace path.
3. Run the focused tests and confirm each new invalid case fails.
4. Resolve authorization from existing Device Trust role plus request-owned scope; do not add complex RBAC.
5. Make telemetry default export metadata-only and fail closed when a field is not allowlisted.
6. Re-run focused tests, package invariants, documentation checks, and commit separate logical checkpoints for authorization and telemetry.

### Task 9: Add real Host-to-native acceptance

**Files:**

- Modify or create: `apps/cli/tests/link-native-acceptance.e2e.ts`
- Modify or create: a Swift executable/test adapter under `apps/apple/Tests/`
- Modify or create: a Kotlin executable/test adapter under `apps/android/core/src/test/`
- Modify: `.github/workflows/apple-swift.yml`
- Modify: `.github/workflows/android-kotlin.yml`
- Create: cross-language corpus and logs under `artifacts/verification/gate-1/acceptance/`
- Update: the owning testing Agent Note

**Steps:**

1. Define one scenario corpus for pair, connect, describe, list, open, history, follow, prompt, stream, approval, cancel, reconnect, and revoke.
2. Make both adapters report the Host commit, client commit, protocol version, contract version, and per-step verdict.
3. Run the corpus against a real shipped Host process; fake servers may isolate failures but cannot satisfy acceptance.
4. Add platform workflows that preserve logs and fixtures as CI artifacts and fail on a skipped runnable step.
5. Save separate Swift and Kotlin evidence JSON, run workflow contract tests, and commit with `test(remote): add cross-language Host acceptance`.

### Task 10: Prove multi-device approval and recovery

**Files:**

- Modify: `packages/api/gateway/tests/gateway-stream.host.spec.ts`
- Modify or create: deterministic multi-device and fault-injection scenarios in `apps/cli/tests/`
- Modify as evidence requires: Native reconnect/projection tests
- Create: evidence under `artifacts/verification/gate-1/multi-device/` and `artifacts/verification/gate-1/recovery/`

**Steps:**

1. Add controlled scheduling for Desktop, Controller A, Controller B, and Observer so both controller win orders are deterministic.
2. Assert first valid outcome wins, the late outcome converges to no-op/cancel, no side effect executes twice, and the Observer is denied.
3. Inject a network drop during streaming while the Host continues, reconnect each native client, and compare final projection with authoritative history/snapshot.
4. Assert no permanent sequence gap, duplicate-safe replay, idempotent repeated reconnect, and correct final projection.
5. Run the scenarios repeatedly without random scheduling, save evidence, and commit with `test(remote): prove approval convergence and recovery`.

### Task 11: Close Gate 1 on one candidate commit

**Files:**

- Create: `artifacts/verification/gate-1/gate1-evidence.json`
- Create or update: `CURRENT_GROUND_TRUTH.md` and its bilingual counterpart if the final location is in the documentation corpus
- Update: the Gate 1 plan status without rewriting evidence history

**Steps:**

1. Select the current committed HEAD as the only candidate and record its SHA before running aggregate checks.
2. Run contract, conformance, authorization, pinning, reconnect, compatibility, regression, documentation, official build, Apple, and Android commands required by changed surfaces.
3. Classify each failure as product, test, contract drift, toolchain, host environment, missing credential, or external service; never convert a repository failure to `NOT_EXECUTED`.
4. Verify every mandatory exit assertion, ensure generated output is fresh, and confirm `git status --short` is empty.
5. Write `gate1-evidence.json` with the exact candidate SHA and only then mark Gate 1 `PASS`; otherwise keep the Gate open and continue every independent repair.
6. Commit the evidence with `chore(goal): close Gate 1 correctness repair` and begin the precise Gate 2 plan only after the commit is green.

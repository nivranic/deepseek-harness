# Gate 2 CI and supply-chain implementation plan

English | [中文](2026-09-05-gate-2-ci-supply.zh.md)

> **For Claude:** Use `executing-plans` to implement this plan task by task.

**Goal:** Produce verifiable candidate evidence from one source SHA, with immutable workflow dependencies and narrowly scoped automation permissions.

**Architecture:** Extend the existing CI and package-release owners. Keep application identity in its existing owner, collect platform artifacts through receipts, and reject missing platforms, mismatched identities, or altered bytes before candidate promotion. Production publication remains outside this preparation workflow.

**Tech Stack:** TypeScript, js-yaml, Vitest, existing GitHub Actions workflows, platform packaging tools, and standard SBOM/provenance formats.

---

## Scope and selected approach

This plan covers G2-CI and G2-SUPPLY from [the handoff](../../artifacts/verification/goal-mode-handoff-2026-09-05.md#82-gate-2--release-engineering-foundation). It does not declare G2-RC complete before the Windows, macOS, iOS, and Android packaging owners emit real artifacts. Keep the existing worktree and draft PR; do not modify the user's dev checkout, vendor sources, production credentials, or release activation.

The selected design adds a checked policy and receipts around existing owners. A second release engine would duplicate package/version responsibilities. A document-only checklist would not reject stale or missing evidence. Pinning a mutable version tag would preserve an upstream code-substitution risk; full commit SHA references preserve the selected action bytes.

GitHub's [secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use) recommends immutable full-length action SHAs and read-only default token permissions, with job-specific increases. Validate SHAs against each action's owning repository. Keep GitHub API attestation optional behind a separate protected operation; the portable receipt must remain useful without private GitHub features.

### Task 1: Pin and verify workflow dependencies

**Files:** `.github/workflows/*.yml`, `release/action-pins.json`, `scripts/workflow-security.ts`, `scripts/workflow-security.spec.ts`, `scripts/verify-workflow-security.ts`, `scripts/run-gates.ts`, `scripts/run-gates.spec.ts`, `scripts/ci-workflow.spec.ts`, and `package.json`.

1. Resolve every existing external action reference in its owning repository and retain the requested reference and verified commit SHA. Preserve the selected action major versions and local reusable workflow paths.
2. Write parser tests that reject short SHAs, mutable tags, missing permissions, `write-all`, and unrecorded writable jobs. Admit local reusable workflows and explicit job permissions only through the checked policy.
3. Implement YAML-aware discovery across workflow job and step `uses` fields. Reject an empty corpus and malformed workflows. Add the verifier to executed static/hygiene aggregates.
4. Replace action tags with verified SHAs and readable version comments. Update behavioral workflow tests to identify the action independently of its revision; the security verifier owns revision acceptance.
5. Run focused security/workflow/aggregate tests, the top-level verifier, lint, and documentation checks. Confirm an invalid fixture is rejected by the same entry used by CI.

### Task 2: Make required-check evidence explicit

**Files:** `scripts/release/ci-evidence.ts`, its focused tests, `release/required-checks.generated.json`, and `artifacts/verification/gate-2/G2-CI.json`.

1. Derive the mandatory CI job set from the existing aggregate's `needs`; include the independent Apple and Android acceptance workflows explicitly. Preserve separately reported Windows coverage and observational results.
2. Read branch-protection settings without changing them. If inaccessible, record that result and the exact source-derived required-check list; do not imply branch protection is configured.
3. Parse run/job receipts and reject a missing, skipped, cancelled, failed, or differently sourced required result. Keep a pending result pending. Record the actual PR merge SHA and tree when that is what executed.
4. Exercise rejection and successful aggregation fixtures, then collect the real current-candidate receipts. No result for an ancestor substitutes for a changed candidate.

### Task 3: Add dependency, static-security, and secret checks

**Files:** `.github/workflows/supply-chain.yml`, scanner configuration beside its owning workflow, `scripts/workflow-security.spec.ts`, and G2-SUPPLY evidence.

1. Add dependency review and CodeQL/SAST through maintained pinned tooling; choose the smallest permissions each job requires. Run on candidate code without production credentials.
2. Run secret scanning against the candidate and outgoing changes with redacted output. Allow only precise known fixture literals or generated test keys; never exclude all fixtures, all tests, or an entire application tree.
3. Retain machine-readable counts and scanner/tool versions. A missing scanner, unsupported account feature, or skipped scan does not produce PASS.
4. Run the scanners on the candidate and verify controlled invalid fixtures fail without publishing their contents. Review any findings and repair actual defects before accepting the check.

### Task 4: Bind candidate artifacts, SBOM, and provenance

**Files:** `scripts/release/rc-manifest.ts`, its focused tests, `scripts/release/rc-artifacts.ts`, and `release/rc-policy.json`.

1. Define a versioned receipt containing source SHA, application identity, platform/runtime class, relative artifact path, byte size, SHA-256, signing class, and references to checks, SBOM, and provenance. Require exactly the platform set declared by policy.
2. Reject absolute/escaping paths, symlinks leaving the artifact root, duplicate platform records, mixed source SHAs, mismatched identities, unsupported schema versions, missing files, and checksum/size mismatches.
3. Compare the last distributed identity using the existing build-advance owner. Permit a retry only when the complete source, identity, and artifact digests match the retained candidate; channel/version changes are new candidates.
4. Generate an SBOM with maintained tooling over each actual packaged closure. Preserve its format/version and tool identity. Emit portable provenance binding builder identity, source, invocation, and material/output digests; do not label unsigned provenance as an authenticated attestation.
5. Mutate one output byte and one receipt identity in isolated fixtures and require verification failure. Verify a complete four-platform fixture and each real artifact as the packaging owners become available.

### Task 5: Assemble the unsigned RC workflow

**Files:** `.github/workflows/release-candidate.yml`, platform packaging owners, candidate-manifest CLI, and G2-RC evidence.

1. Require a full immutable source SHA and declared identity, then run the source checks and real platform producers against that SHA. Reuse the existing build and launch mechanisms; do not invent placeholder platform artifacts.
2. Upload artifacts and receipts without production signing or store publication. Collect all expected platforms into the candidate manifest; missing runner/toolchain evidence blocks the RC verdict.
3. Attach checksums, SBOM, portable provenance, and a payload-free evidence summary. Any optional GitHub attestation uses a dedicated minimal-permission job, separate from untrusted artifact execution.
4. Execute the complete dry-run only after the platform producers are ready. Record each actual source SHA, job verdict, and artifact identity; a workflow file alone is not execution evidence.

### Task 6: Document and publish the reviewable candidate

**Files:** A bilingual reference under `docs/development/`, a process Agent Note, and `artifacts/verification/gate-2/G2-CI.json` / `G2-SUPPLY.json` / `G2-RC.json`.

1. Keep command and schema details at their owners and cross-link existing release-sequence rationale. Record required checks, source selection, permission exceptions, scanner limits, and manual production steps accurately.
2. Run the applicable focused tests and top-level gates, doc-sync, lint, and actual candidate workflows. Commit normally, inspect hook changes, push, verify remote SHA, and keep the PR draft with base dev.
3. Update the single handoff with actual results. Continue G2 platform/support/migration/compatibility/rollback work and Gate 3–4; do not mark the overall goal complete after this plan.

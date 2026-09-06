# Agent Note: Candidate bytes and unsigned producer evidence

Status: implemented

English | [中文](2026-09-06-candidate-artifact-integrity.zh.md)

## Problem

A successful build or a self-consistent manifest can describe the wrong source, omit a platform, or retain checksums for different bytes. Unsigned provenance also cannot establish who produced it. Treating metadata parsing as artifact acceptance hides these distinct failures.

## Decision

The [candidate verifier](../../../../docs/development/release-candidate.md) separates complete-candidate acceptance from individual platform verification. An independently selected source and checkout-owned product identity constrain each receipt. Every artifact and evidence file is checksum-verified; checks and SLSA provenance bind the same deliverables, and the official CycloneDX library validates the SBOM schema. A synthetic fixture proves verifier behavior without representing a platform build.

The caller owns an exclusive, quiescent artifact directory throughout verification and later use. Streaming file descriptors, link rejection and repeated metadata checks detect observed mutation without claiming a portable filesystem sandbox. Evidence is never executed. Keeping files immutable avoids presenting a time-limited checksum result as a guarantee about later replaced bytes.

The [Windows producer](../../../../docs/development/windows-candidate.md) performs actual installation and GUI interaction only on disposable hosted runners, with separate state and credential-scrubbed subprocesses. It requires normal exit and compares each running executable with the packaged bytes. Screenshots and observations are referenced attachments whose hashes also appear in provenance; an image-size heuristic cannot establish readiness.

Operation and cleanup failures remain distinguishable because startup acceptance and resource disposal are independent obligations. A cleanup exception does not replace the primary failure, and successful disposal does not grant acceptance to a failed operation.

Syft scans packaged directories with installed-package catalogers. Its directory defaults omit installed npm packages, so the producer explicitly selects `image` and independently checks every packaged name and available version against the SBOM. Unreadable directories fail; Windows extended paths prevent long paths from silently narrowing the audit. The scanner archive and executable version are verified before accepting its output.

Retries retain source, identity and complete deliverable records while allowing refreshed evidence and invocation metadata. This implements the [product release identity](2026-09-05-product-release-identity.md) distinction between an unchanged retry and a new distribution. Every changed distribution uses the existing monotonic build-number rule. [Candidate security scans](2026-09-05-candidate-security-scans.md) retain their independent source-analysis and disclosure decisions.

## Alternatives considered

- Requiring the entire manifest to be identical treats a refreshed scan or provenance invocation as new application bytes.
- Checking only JSON references permits changed files or evidence for a different source to inherit PASS.
- A handwritten SBOM subset can admit invalid nested standard fields; the maintained schema library owns standard validation.
- Portable unsigned provenance remains usable without a hosted attestation service, but cannot authenticate a builder. A signed attestation requires a separate trusted producer.

## Consequences

Validation adds development-only schema and GUI-driver dependencies and requires ASCII artifact references, regular files and a completed directory. Full and companion labels classify distributions without proving native Lite behavior. Platform workflow execution, bundled code without package manifests, upgrade, rollback, production signing and actual four-platform assembly require evidence beyond synthetic verifier tests.

Focused regressions cover mixed identities, incomplete platforms, path aliases, links, missing or modified bytes, false PASS checks, invalid nested SBOM data, altered provenance subjects, independent source expectations and distribution advancement. CLI subprocess cases prove a nonzero exit after a byte changes and after policy loses a platform. These are synthetic verifier tests, not release acceptance.

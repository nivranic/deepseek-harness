# Agent Note: Source-bound security scans and exact non-secret exceptions

Status: implemented

English | [中文](2026-09-05-candidate-security-scans.zh.md)

## Problem

Scanners can succeed after examining the wrong checkout, inheriting source-controlled ignore rules, or emitting findings without failing the job. Broad test exclusions hide new credentials beside legitimate public vectors. Raw reports can copy detected sensitive content into CI artifacts.

## Decision

The [workflow](../../../../.github/workflows/supply-chain.yml) checks the immutable candidate with read-only permissions. Gitleaks scans complete candidate blobs and introduced history. Archive verification rejects transformed or omitted blobs; symlinks contribute link text. Exact path/line-hash/rule exceptions retain default detection rules. Translation hashes require proof against the actual owner blob at the finding's commit.

Each Gitleaks invocation proves detection and redaction with a synthetic credential beside an ignored allow comment. CodeQL requires completed analysis for four application languages and retains suppressed findings too. Confirmed non-issues require exact selectors with source context pinned to immutable Git objects; source suppression alone cannot grant acceptance. Relevant callers and build selection remain part of the review context so a new use cannot inherit an obsolete rationale. Dependency review requires actual outputs and rejects every vulnerability severity. Reports retain identities, counts, and locations; matched text and source-bearing SARIF stay outside published artifacts. The [reference](../../../../docs/development/security-scanning.md) owns requirements and coverage limits.

## Alternatives considered

- Directory exclusions reduce false positives but hide future credentials in excluded source.
- Hash-looking text does not establish a non-secret value; checking its Git owner avoids a generic hexadecimal allowlist.
- Raw SARIF and secret reports provide more context but can republish sensitive source or identity.
- Process success cannot establish a clean verdict when the scanner deliberately succeeds after finding vulnerabilities.
- Line-only SAST exceptions survive changed callers and make a previously valid rationale unsafe; context identities require renewed review when those inputs change.

## Consequences

Cryptographic review follows the complete construction: the Kotlin relay uses ChaCha20-Poly1305 AEAD, while `ChaCha20` labels its JCA key. Noise's zero nonce prefix is combined with a unique per-key counter; fresh directional keys, serialized exchanges, and refusal before counter exhaustion are required together. Reviews pin the Android tree and analysis workflow so changed callers or nonce ownership require renewed assessment instead of inheriting an algorithm-name exception.

Edited fixture lines or SAST context require renewed review. Unsupported platforms, submodules, incomplete analysis, unavailable account features, and missing outputs fail without retaining stale PASS. Even a fully reviewed finding set cannot override extraction errors. Source-free artifacts reduce remote diagnostic detail; reproduction uses the exact candidate and scanner revision. Unsigned receipts complement [CI source evidence](2026-09-05-ci-source-evidence.md) and [workflow policy](2026-09-05-workflow-security.md).

Regressions cover archive transformations, path escape, changed exceptions, checksum-before-execution, stale output, suppressed findings, and incomplete reports. A real Gitleaks negative fixture verifies the installed tool. Actual language analysis and dependency-graph execution remain candidate-specific CI evidence. Native C/C++ and Rust are outside the four-language matrix. [Candidate artifact integrity](2026-09-06-candidate-artifact-integrity.md) separately checks packaged bytes and unsigned producer claims.

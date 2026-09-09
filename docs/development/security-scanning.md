# Candidate security scanning

English | [中文](security-scanning.zh.md)

## Summary

The [supply-chain workflow](../../.github/workflows/supply-chain.yml) scans the immutable PR head with read-only permissions. Secret detection, dependency review, and four application-language CodeQL jobs must all succeed. The required Go scanner job in [CI](../../.github/workflows/ci.yml) adds Go analysis on the same immutable candidate. Unreviewed findings or incomplete scans block the respective verdicts.

## Table of Contents

- [Secret scanning](#secret-scanning)
- [Dependency and static analysis](#dependency-and-static-analysis)
- [Evidence and limitations](#evidence-and-limitations)
- [Dev Note](#dev-note)

-----

<a id="secret-scanning"></a>
## Secret scanning

[scan-secrets.py](../../scripts/scan-secrets.py) requires Python 3.10+, Git, a clean tracked checkout with the candidate tree, and an ancestor base commit. `--candidate`, `--base`, and `--output` select full commit SHAs and the verdict file. The installer selects the running platform's Linux/Windows x64 or macOS x64/arm64 archive from the candidate's [registry](../../.github/security/scanners.json), verifies SHA-256 before execution, and confirms the executable version. Unsupported platform pairs, missing pins and URLs naming another architecture fail before download. The [Apple lane](../../.github/workflows/apple-swift.yml) owns native macOS execution of the pinned scanner, its detection/redaction canary and a clean UTF-8 input; mocked platform selection tests alone do not establish native execution.

The complete candidate tree and added lines in the base-to-candidate commit range are separate inputs. Exported files must match every Git blob's bytes; omissions or substitutions fail. Symlinks contribute link text without following their targets. Untracked files, including local credentials, are outside the input. Submodules require a separately pinned scanner input and currently fail.

Gitleaks uses its default rules with redacted reports. Source allow comments and ignore files cannot disable detection. Each invocation first proves that the real executable rejects a synthetic credential beside an allow comment and redacts the value. Failed self-tests block scanning.

The [exceptions](../../.github/security/secret-exceptions.json) match exact paths, complete-line SHA-256 values, and rule IDs for reviewed public vectors, privacy canaries, invalid test inputs, and type declarations. Changed lines or rules remain findings. Translation records are classified separately only when their complete Markdown-owner field equals that owner's Git blob identity at the finding's commit. Multiline matches receive no exception.

-----

<a id="dependency-and-static-analysis"></a>
## Dependency and static analysis

Dependency review compares the explicit base and candidate using GitHub's dependency graph. Vulnerabilities at every severity in runtime, development, or unknown scopes fail. License approval is outside this check. Missing outputs or unavailable account features produce no acceptance; a successful empty diff is valid. The job does not post PR comments.

CodeQL runs `security-extended` queries for JavaScript/TypeScript, Python, Java/Kotlin, Swift, and the Go support scanner. Kotlin compilation includes the core and Android app. Swift compilation includes SwiftPM and all three Apple app schemes. The Go CI job compiles the scanner and its tests with a read-only module graph before analysis. These jobs do not establish native C/C++ or Rust analysis. Build or extraction failure blocks the language job.

[security-evidence.py](../../scripts/security-evidence.py) requires a successful analyzer outcome and SARIF with tool identity, a non-empty rule set across the driver and extensions, successful invocations, and explicit results. Every finding remains visible, including suppressed findings. Warning/error analysis notifications fail while preserving diagnostic IDs and findings together. Java extraction diagnostics may include a category and an existing repository path recognized from CodeQL's fixed message templates; arbitrary messages remain private. Source-bearing SARIF and CodeQL databases are not uploaded. Rejected rule metadata records only structural counts for diagnosis.

The candidate's [SAST reviews](../../.github/security/sast-reviews.json) classify confirmed non-issues by exact language, rule, path, and line. Each review records its rationale and immutable Git blob or tree identities covering the finding source and relevant context. The reviewed source and line must exist. Every location in a finding must match; missing locations, changed context, or invalid reviews cannot pass. Source suppression alone has no effect. Evidence keeps both reviewed and unreviewed counts plus the registry digest. Reviewed findings never override incomplete analysis. Callers and build selection belong in the pinned context whenever the rationale depends on them.

-----

<a id="evidence-and-limitations"></a>
## Evidence and limitations

Artifacts retain candidate/tree identity, scanner revision or archive digests, counts, and finding locations without matched text, source snippets, author identity, or credentials. Errors replace old PASS files with FAIL. Run/attempt artifact names identify the producer. Receipts remain unsigned observations; the [CI collector](workflow-security.md#candidate-source-evidence) independently verifies GitHub/source data for its required workflows.

Secret scanning has no broad test-directory exclusion. CodeQL covers extracted application languages; dependency review covers changes recognized by GitHub's dependency graph. These checks do not prove the absence of all vulnerabilities, generate an SBOM, authorize publication, or replace platform release acceptance. The aggregate has no skipped-scanner success path.

-----

<a id="dev-note"></a>
## Dev Note

The [decision](../../.agents/notes/implemented/process/2026-09-05-candidate-security-scans.md) owns exception and evidence trade-offs. [Workflow policy](workflow-security.md) owns Action pins and permissions.

# Windows candidate production

English | [中文](windows-candidate.zh.md)

## Summary

The [Windows workflow](../../.github/workflows/windows-candidate.yml) builds unsigned installer and portable applications from one explicit source commit. It installs the candidate, interacts with both application launchers, scans the packaged directory and verifies a [platform receipt](release-candidate.md) before uploading it. The workflow does not accept the other three platforms or publish a production release.

## Table of Contents

- [Source and execution](#source-and-execution)
- [Installation and GUI checks](#installation-and-gui-checks)
- [Packaged inventory and evidence](#packaged-inventory-and-evidence)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

-----

<a id="source-and-execution"></a>
## Source and execution

Pull requests changing the declared inputs run the workflow against their full head SHA. Reusable calls and manual dispatches require `source_sha`; GitHub's default-branch availability rule still applies to manual dispatch. Source validation precedes checkout, and the checked-out SHA is compared again before production. Full Action revisions, disabled checkout credential persistence and `contents: read` follow the repository's [workflow policy](workflow-security.md) and GitHub's [secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use).

The job uses native PowerShell on a disposable `windows-2025` runner. It installs the locked dependencies, checks generated product identity, runs the SBOM regressions, builds the official client and invokes [the existing packager](../../scripts/build-desktop-exe.ts). Electron and builder downloads use their upstream GitHub release locations. Packaging remains unsigned and disables publication.

After packaging, the producer runs through `node --import tsx/esm` against the installed development toolchain. The production deployment changes pnpm workspace-state metadata; a subsequent `pnpm exec` can automatically reinstall with production-only dependencies and remove the verification tools before they start.

The [producer](../../scripts/produce-windows-candidate.ts) requires a new output directory beneath `RUNNER_TEMP`. It creates a separate unique run directory for installation and application state. Its hosted-runner markers prevent accidental use on a developer machine; they are not authentication against a caller deliberately spoofing environment variables. This producer must not run on persistent self-hosted runners.

-----

<a id="installation-and-gui-checks"></a>
## Installation and GUI checks

The NSIS candidate installs silently for the current disposable runner user into the owned run directory. The producer compares the installed main executable with the unpacked executable, and [Windows metadata inspection](../../scripts/release/verify-windows-product.ps1) checks string and numeric versions plus `NotSigned` for the installer, portable launcher, unpacked main and installed main. Distinct file references are required.

[Playwright's Electron driver](../../scripts/release/windows-smoke.ts) launches the installed executable and the actual portable launcher separately. Each launch uses fresh Harness and application-data directories with credential-like environment variables and development hooks removed. The driver dismisses the real first-run notice, chooses later credential configuration, opens Settings, selects Models and opens the provider form without saving a credential or making a model request.

NSIS does not forward the Electron child's stderr, which Playwright uses for debugging addresses. A test-only [portable adapter](../../scripts/release/windows-portable-launch.ts) launches the actual portable file, discovers both requested loopback endpoints and forwards their announcements to the same Electron driver. It retains the portable process until exit and remains in Playwright's owned process tree for failure cleanup. Portable startup allows four minutes for extraction and connection; installed startup allows ninety seconds. The driver verifies the connected application's isolated user-data path before interacting with it.

The driver captures the rendered provider form, checks uncaught page errors, records the running application version and hashes its actual executable before portable cleanup. Both running executables must match the packaged main executable. Normal application close and process exit must both finish with exit code zero; failure cleanup terminates only the process tree owned by that launch. No PNG-size threshold grants startup acceptance.

The producer logs installation, inspector, window and form milestones. Operation and cleanup failures are retained together, including failures before the Electron driver returns a process handle. Directory removal retries transient Windows locks for a bounded interval and still rejects unresolved cleanup; retries do not grant startup acceptance.

After acceptance fails, a separate [read-only diagnostic](../../scripts/release/read-windows-installer-crash.ps1) queries up to 100 Application Error events from the preceding 45 minutes and matches the candidate installer's full path. It logs the installer hash, byte size and selected crash fields, excluding full event messages and paths. An empty result or unavailable event log does not explain the crash or change the failed job; verified-artifact upload remains conditional on acceptance.

-----

<a id="packaged-inventory-and-evidence"></a>
## Packaged inventory and evidence

[The SBOM producer](../../scripts/release/sbom.py) downloads a fixed Syft archive from [the scanner registry](../../.github/security/scanners.json), verifies its SHA-256 before extracting or executing it, and checks the binary version. An explicit configuration disables update checks, and ambient Syft configuration is removed. CycloneDX 1.6 output uses the `image` cataloger set because the input contains installed dependencies; default directory catalogers omit installed npm packages.

The npm audit walks the actual packaged application directory, fails on unreadable directories and links, and compares every named package and every available name/version pair with the generated SBOM. Manifests that contain only module metadata do not become packages. Unversioned named manifests remain counted and must appear by name. Windows extended paths preserve coverage for long deployed paths. An empty inventory or an omitted package fails before a tool receipt is emitted.

The final platform receipt binds installer and portable files, named PASS checks, the standard SBOM, screenshots and observed metadata attachments. Portable SLSA provenance names the source repository, commit, builder and workflow invocation and binds all referenced file digests. The common verifier reads all referenced bytes again before the producer writes `windows/receipt.json`. Upload runs only after production succeeds; the artifact name includes source SHA, run ID and attempt, and retention is seven days.

-----

<a id="limitations"></a>
## Limitations

Synthetic regression tests do not establish installer or GUI success; only the actual candidate workflow does. The npm comparison proves coverage against shipped manifests, not against code whose dependencies were bundled without manifests or missing license metadata. This workflow checks a fresh installation and keyless GUI configuration, not upgrade, rollback, model execution, production signing or store distribution. Unsigned provenance does not authenticate the builder, and one Windows receipt is not a complete four-platform RC.

-----

<a id="dev-note"></a>
## Dev Note

The [candidate integrity decision](../../.agents/notes/implemented/process/2026-09-06-candidate-artifact-integrity.md) owns trust and evidence semantics. The [product identity reference](product-release-identity.md) owns platform version representations.

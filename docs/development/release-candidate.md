# Release candidate integrity

English | [中文](release-candidate.zh.md)

## Summary

The candidate verifier checks downloaded application artifacts against an independently selected commit and the checkout's [product identity](product-release-identity.md). A complete manifest requires Windows, macOS, iOS and Android receipts. A platform receipt can be checked separately without accepting a complete release candidate. Neither operation authorizes publication. The [Windows producer](windows-candidate.md) owns installation, GUI interaction and packaged-directory scanning for its platform.

## Table of Contents

- [Inputs and commands](#inputs-and-commands)
- [Artifact and evidence requirements](#artifact-and-evidence-requirements)
- [Trust and verification limits](#trust-and-verification-limits)
- [Dev Note](#dev-note)

-----

<a id="inputs-and-commands"></a>
## Inputs and commands

Use a checkout with the expected product identity and reviewed [RC policy](../../release/rc-policy.json). Select the expected full lowercase commit SHA and Git repository URI independently of the downloaded manifest. The [CLI](../../scripts/verify-rc-candidate.ts) takes these required options:

| Option | Meaning |
|---|---|
| `--root` | Exclusive, completed artifact directory |
| `--manifest` or `--receipt` | Complete manifest JSON or one platform receipt JSON; exactly one is required |
| `--source-sha` | Expected full source commit |
| `--source-repository` | Expected Git repository URI in provenance |
| `--previous` | Optional trusted retained distribution manifest; valid only with `--manifest` |
| `--max-json-bytes` | Positive per-document byte limit, default 33554432 |

Invoke `pnpm run verify-rc-candidate` with these options. Success prints a JSON summary with `scope: candidate` or `scope: platform`; failed verification exits nonzero. The command does not write a PASS file, execute artifacts, install applications, or publish them. `pnpm run verify-rc-policy` checks only the policy and runs in the static and hygiene aggregates; its success does not accept any artifacts. The [CLI regressions](../../scripts/verify-rc-candidate.spec.ts) exercise both entry points with synthetic files and a modified-byte rejection.

Without `--previous`, distribution advancement is `not-checked`. With it, a retry requires the same source, complete product identity and deliverable records, including paths, sizes, digests, runtime and signing classes. Evidence and invocation metadata may refresh after their own verification. Every other candidate must increase the build number across versions and channels. The caller owns the retained manifest's authenticity and its status as the last distribution.

-----

<a id="artifact-and-evidence-requirements"></a>
## Artifact and evidence requirements

The [metadata parser](../../scripts/release/rc-manifest.ts) owns schema version 1 and canonical ordering. The policy requires one receipt per supported platform and declares each platform's artifact kinds and runtime classes. `full` identifies a host distribution; `companion` identifies a client distribution that may include native Lite features. That classification does not verify Lite functionality. Candidate signing classes are `unsigned` and `debug`.

References use ASCII relative paths beneath their platform directory, such as `windows/installer.exe`. Absolute paths, parent traversal, Windows device names, reserved characters, trailing dots or spaces, and case aliases fail. All files carry a positive byte size and SHA-256. The required `attachments` array may be empty or contain screenshots and diagnostic files. The [reader](../../scripts/release/rc-files.ts) streams binary files, bounds JSON, rejects symbolic and hard links, and checks observed files and directories for replacement or modification before accepting the result.

Each named check is JSON containing `schemaVersion: 1`, its name, source SHA, complete identity, platform, `status: PASS`, and in-toto subjects for every deliverable. Extra or mismatched claims fail. This verifies the recorded claim; the platform producer remains responsible for actually testing identity and startup.

The [evidence verifier](../../scripts/release/rc-evidence.ts) validates a CycloneDX 1.6 SBOM with the pinned official CycloneDX library and its JSON schema dependencies. The document must declare version 1.6, name the recorded scanner and version, identify its scan target, and contain a non-empty component inventory. Other SBOM formats fail. The producer must run maintained scanning tools over the actual packaged closure; a schema-valid synthetic inventory is not a real scan.

Portable provenance uses in-toto Statement v1 and SLSA provenance v1 with build type `urn:dsh:release-candidate:v1`. Its subjects bind every deliverable, check, attachment and SBOM digest. External parameters bind source SHA, identity and platform; the resolved source material binds the independently expected repository URI and commit. Run details bind the receipt's builder and invocation identifiers. These unsigned claims do not authenticate their author.

-----

<a id="trust-and-verification-limits"></a>
## Trust and verification limits

The caller must prevent concurrent writes or renames to the artifact directory, its ancestors and referenced files through verification and later consumption. File descriptor checks and final metadata rechecks detect observed changes; portable Node filesystem APIs do not provide a sandbox against an adversarial concurrent writer. A result describes the verified bytes and becomes stale if those bytes change.

Consistency does not prove inventory completeness, scanner execution, builder identity, signing, installation, startup, compatibility, or rollback. A compromised producer can create mutually consistent unsigned claims. [Source security scans](security-scanning.md), trusted workflow execution, real platform acceptance and any authenticated attestation retain their separate owners. Missing real producers cannot be replaced with test fixtures to close RC acceptance.

-----

<a id="dev-note"></a>
## Dev Note

The [artifact integrity decision](../../.agents/notes/implemented/process/2026-09-06-candidate-artifact-integrity.md) records the trust assumptions and retry policy. The [implementation plan](../plans/2026-09-05-gate-2-ci-supply.md) tracks actual platform producers and candidate workflow assembly.

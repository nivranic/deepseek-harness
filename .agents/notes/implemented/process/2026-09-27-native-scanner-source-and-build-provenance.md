# Agent Note: Native scanner verification owns committed source and explicit build inputs

Status: implemented

English | [中文](2026-09-27-native-scanner-source-and-build-provenance.zh.md)

## Problem

An Android AAR with a verified historical receipt does not make its source build reproducible from the current candidate. Missing scanner and builder sources also prevent reviewing the admission implementation or running its rejection tests alongside the application. Host-only subprocess overrides obscure the build's effective checksum policy.

## Decision

The [shared Go scanner](../../../../native/support-scanner/README.md) and Android builder dependency closure live in this repository. Gitleaks remains the maintained rule engine; application exporters retain field selection, identity and delivery ownership. No second Host support producer or runtime service is introduced. The scanner's canary, immutable approved bytes, fixed refusals and joined cancellation remain unchanged.

`test:support-scanner` executes the gate's rejection controls, Python source/build/artifact tests, Go module verification, behavior tests and vet. It requires the policy-pinned compiler and nonempty executed test sets, and reports skipped tests explicitly. The gate clears alternate module/workspace settings and enforces public checksum-database verification. It does not substitute for race analysis, reachable-dependency vulnerability checks or native device execution.

The builder reads only regular committed scanner files and the repository license into a deterministic private Go module proxy. Its running builder files must match the requested commit. Downloaded private-module files must match the committed inventory and bytes; external modules remain checksum-verified. Android artifact admission checks both declared ABIs, 16 KiB ELF alignment, JNI/R8 entries, source and module identities, private-path exclusion and licenses before recording success.

An explicit credential-free HTTPS module proxy can replace the public download endpoint without disabling `sum.golang.org` or bypassing private-source verification. Invalid proxy inputs fail before a working directory is created. Cache, working and output directories remain separate, and existing artifacts are never overwritten. The [historical host accommodation record](2026-09-20-scanner-toolchain-host-accommodations.md) still explains the external AAR's provenance; it is not the new builder's execution policy.

Source adoption and artifact qualification are separate milestones because the builder requires committed inputs. A restored source tree and passing tests cannot relabel the application's existing external AAR as a current-candidate build. A subsequent build must name the actual source commit and preserve its own receipt; installed admission and application qualification require separate matching evidence.

## Alternatives considered

**Keep only the historical AAR and receipt.** That preserves an artifact but leaves its implementation and compiler inputs outside the candidate. The source and negative tests need the same review ownership as their consumer.

**Patch subprocess environments at runtime or disable checksum verification.** Hidden overrides make the committed builder an incomplete description of execution. An explicit HTTPS proxy preserves public checksum verification and can be exercised by invalid-input tests.

**Build uncommitted sources under an older commit id.** That makes the receipt's source identity false. The builder rejects edited files, so source restoration commits before an artifact is produced from it.

## Consequences

Python tests exercise altered builder files, invalid versions, source/cache byte changes, archive aliases, JNI/ELF metadata and preserved output paths. Go tests cover real secret rejection despite ambient and inline allowlisting, immutable admission, cancellation, timeout, panic containment and concurrent scans. Gate controls reject missing test owners, a different compiler, empty test output and entirely skipped Python tests. Windows directory-symlink coverage remains explicitly skipped; race analysis, current-commit AAR construction, vulnerability qualification, Apple bindings and physical devices remain separate evidence.

# Workflow dependency, token, and source policy

English | [中文](workflow-security.zh.md)

## Summary

GitHub Actions workflows use recorded upstream commit SHAs, explicit token permissions, and source receipts. Static and hygiene checks validate the workflow policy and generated required-check metadata. Scanners, artifact integrity, and production release approval have separate owners.

## Table of Contents

- [Immutable Action references](#immutable-action-references)
- [Token permissions](#token-permissions)
- [Candidate source evidence](#candidate-source-evidence)
- [Validation and limits](#validation-and-limits)
- [Dev Note](#dev-note)

-----

<a id="immutable-action-references"></a>
## Immutable Action references

[action-pins.json](../../release/action-pins.json) records each selected Action, requested revision, owning repository, and verified full commit SHA. Workflow `uses` fields consume those SHAs; comments retain readable revisions. A mutable tag, short SHA, or full SHA absent from the registry fails validation. Pin updates require verification against the Action's owning repository and a reviewed update to both the registry and consumers.

Local reusable workflows resolve to existing files under `.github/workflows`; the verifier inspects those files too. External reusable workflow references follow the same recorded-SHA rule as step actions. The checked required-file list prevents acceptance of an empty or narrowed workflow corpus.

-----

<a id="token-permissions"></a>
## Token permissions

Workflow defaults are explicit mappings containing only `read` or `none`. Jobs inherit those defaults unless they declare their own mapping. Writable jobs must match the exact permission set and environment recorded in [workflow-security.json](../../release/workflow-security.json), with a reason for the exception. An absent, broadened, or unused exception fails validation. Checkout steps set `persist-credentials: false`.

The existing preview job owns its PR-write permission. Existing protected publication jobs retain their named environments and narrow OIDC or Pages permissions. This policy does not enable workflows, dispatch jobs, change branch protection, grant registry access, or authorize publication. GitHub App credentials and external service credentials retain their own scopes and approval owners.

-----

<a id="candidate-source-evidence"></a>
## Candidate source evidence

[required-checks.generated.json](../../release/required-checks.generated.json) derives the CI aggregate's dependencies and the Apple/Android required verdicts from their workflow owners. `pnpm run gen-required-checks` refreshes the projection; `pnpm run verify-required-checks` rejects drift in static and hygiene checks. The CI aggregate continues to own its dependency verdicts. Independent Windows coverage and observational results stay separately visible.

Each source-producing job runs [write-ci-source.ts](../../scripts/write-ci-source.ts) after immutable installation and before validation, then preserves `source.json` as `ci-source-<runId>-<attempt>`. The receipt contains the candidate, actual checkout, Git tree and parents, workflow digest, run/attempt/event, and dirty flag. Changed checkout inputs fail the job. It contains no author, workspace path, credential, or business payload.

The [evaluator](../../scripts/release/ci-evidence.ts) selects the newest run, requires successful mandatory jobs, and binds source metadata to the producer's execution attempt. It rejects missing or mismatched evidence, dirty or different trees, unrelated commits, and inconsistent execution SHAs across workflows. Pending required jobs stay pending.

Run `pnpm run collect-ci-evidence --repo owner/repository --sha <full-sha> --output <evidence.json>` with an authenticated GitHub CLI on PATH. The [collector](../../scripts/release/ci-collector.ts) reads workflow definitions at that immutable candidate, paginates runs/jobs/artifacts, and independently checks uploaded tree and parent fields against the Git commit API. Partial reruns can copy successful jobs with new IDs and attempt numbers: matching runner, execution timestamps, and all step results identify the original execution that owns the source artifact. A newly executed producer cannot reuse its previous receipt.

Before returning, collection checks the latest run, job verdicts, and artifact identity again. Changes fail collection and require a fresh invocation. The output retains source-file SHA-256 and GitHub-reported archive digest as separate fields; the CLI does not independently hash the downloaded ZIP. Failed collection invalidates a previous PASS file, and FAIL or PENDING returns a nonzero exit code. Collection is read-only, does not configure branch protection, and does not authenticate unsigned receipts as provenance.

-----

<a id="validation-and-limits"></a>
## Validation and limits

Run from the repository root:

```sh
pnpm run verify-workflow-security
```

The verifier parses YAML job and step fields instead of searching arbitrary text for `uses`. It rejects malformed workflow/policy input and reports violations without modifying files. Static and hygiene aggregates execute this same entry; focused tests exercise both accepted and rejected input through the executable.

A recorded SHA fixes the selected Action revision. It does not audit that Action's code, pin transitive downloads made by the Action, freeze hosted runner images, or establish artifact provenance. The offline verifier checks consistency with the reviewed registry; it does not repeat the upstream GitHub lookup. Dependency scanning, SBOM generation, secret scanning, signing, and candidate promotion require additional evidence.

-----

<a id="dev-note"></a>
## Dev Note

The [CI source-evidence decision](../../.agents/notes/implemented/process/2026-09-05-ci-source-evidence.md) records candidate and producer-attempt ownership.

The [workflow-security decision](../../.agents/notes/implemented/process/2026-09-05-workflow-security.md) records the ownership and trade-offs. [GitHub's secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use) explains immutable Action references and job-scoped permission increases.

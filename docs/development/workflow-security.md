# Workflow dependency and token policy

English | [中文](workflow-security.zh.md)

## Summary

GitHub Actions workflows use recorded upstream commit SHAs and explicit token permissions. The repository verifier checks every workflow, including local reusable callees, before static and hygiene checks accept the candidate. This reference covers Action references and `GITHUB_TOKEN`; scanners, artifact integrity, and production release approval have separate owners.

## Table of Contents

- [Immutable Action references](#immutable-action-references)
- [Token permissions](#token-permissions)
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

The [workflow-security decision](../../.agents/notes/implemented/process/2026-09-05-workflow-security.md) records the ownership and trade-offs. [GitHub's secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use) explains immutable Action references and job-scoped permission increases.

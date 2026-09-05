# Agent Note: Immutable workflow actions and explicit token permissions

Status: implemented

English | [中文](2026-09-05-workflow-security.zh.md)

## Problem

Mutable Action tags can change the code a previously reviewed workflow executes. Inherited writable tokens and persistent checkout credentials also expose authority beyond the operation that needs it. A release checklist cannot mechanically reject either condition in a changed candidate.

## Decision

Every external Action reference uses a full commit SHA recorded after lookup in its owning repository. A YAML-aware verifier checks all job/step references and required workflow files. Workflow defaults are explicitly read-only; writable jobs match a reviewed permission/environment exception. Checkout credentials are not persisted. The same verifier runs in static and hygiene aggregates; the [reference](../../../../docs/development/workflow-security.md) owns fields and commands.

The policy preserves independent publication decisions, including [Python publication](2026-08-11-python-publication-workflow.md) and [documentation publication](2026-07-13-documentation-site-projection.md). It limits `GITHUB_TOKEN` use without replacing protected environments or the scopes of GitHub App and external-service credentials.

## Alternatives considered

- Version tags are easier to read but can move; readable comments preserve revision context beside immutable references.
- Repository-wide writable tokens grant unrelated jobs unnecessary authority. A job-specific exception states both the permission and the operation that needs it.
- A textual search cannot reliably distinguish executable YAML fields from comments or shell-script strings. Parsing identifies the owning job and step.
- Looking up upstream revisions during every offline check would make source acceptance depend on mutable network state. Reviewed pins retain the lookup result; updates deliberately repeat the lookup.

## Consequences

Action updates require a reviewed registry and workflow change. A removed writable job also removes its exception, preventing stale permissions from remaining available for reuse. A changed protected environment is visible in both the workflow and policy.

Focused tests and the executable verifier must reject mutable/unrecorded revisions, missing workflows, malformed input, implicit or broad permissions, checkout persistence, and altered write exceptions. Pinning does not audit transitive Action behavior, replace scanners, or prove artifact provenance; those checks remain part of release engineering.

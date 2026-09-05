# Agent Note: One application release identity across platforms

Status: implemented

English | [中文](2026-09-05-product-release-identity.zh.md)

## Problem

Independent native version literals permit one candidate to report different application versions. Protocol and durable-format versions identify interoperability obligations, so using either as an application release number conflates independent changes.

## Decision

The root package manifest owns application SemVer. Explicit release metadata owns a build number and distribution channel; the generator derives Android, Apple, and Windows representations before packaging. Parser rejection and byte freshness checks apply before artifact construction. The [reference](../../../../docs/development/product-release-identity.md) owns fields, limits, and commands.

The application identity extends the [npm release sequences](2026-08-10-npm-release-sequences.md) without replacing their independent vendor and native publication ownership. The dsh version planner validates release metadata and includes generated platform inputs in its normal commit. Channel selection changes distribution metadata without enabling runtime capabilities or changing protocol admission.

## Alternatives considered

- Manual native versions leave drift possible even when package versions agree.
- Deriving an application version from a protocol version couples releases that have different compatibility meanings.
- CI run numbers cannot reproduce a candidate from committed inputs; explicit build numbers can.
- Embedding the current source SHA in a committed generated file creates a self-reference. Candidate manifests bind source SHA and artifact digests after checkout.

## Consequences

Platform numeric limits constrain the shared identity. A new distributed candidate must advance its build number across versions and channels; same-artifact retries retain it. Identity parsing alone cannot enforce the comparison with the previous distributed manifest, nor prove signing, installation, or release readiness.

Required verification covers invalid metadata, channel/version mismatch, numeric overflow, missing and stale projections, release planning without writes, and actual embedded platform metadata. Apple settings and Info.plist comparison rejects divergence independently. Packaging and release evidence remain separate from these source checks.

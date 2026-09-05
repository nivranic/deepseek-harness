# Agent Note: Candidate checks and actual CI source receipts

Status: implemented

English | [中文](2026-09-05-ci-source-evidence.zh.md)

## Problem

A workflow's candidate `head_sha` does not identify its actual PR merge checkout. A successful older attempt or a workflow-level result that includes optional jobs also cannot establish current mandatory acceptance.

## Decision

Required checks derive from the existing CI aggregate and native workflow owners. Source-producing jobs capture the actual checkout, tree, raw Git parents, workflow digest, candidate, and producer attempt before validation. Raw commit headers preserve parent identities in shallow checkouts. Receipts retain only source and execution metadata.

The evaluator requires current mandatory verdicts and consistent clean source receipts. It uses the source job's attempt because rerunning another job need not rerun the producer. An older PASS cannot replace a newer failure. The [reference](../../../../docs/development/workflow-security.md#candidate-source-evidence) owns commands and fields. [Workflow permissions](2026-09-05-workflow-security.md), the [serial CI reference](2026-07-21-serial-cross-platform-ci-reference.md), and [failover](2026-07-26-ci-failover-runbook.md) retain their independent roles.

## Alternatives considered

- Workflow `head_sha` alone omits the actual merge checkout and its tree.
- Requiring the receipt's attempt to equal the latest workflow attempt rejects valid partial reruns.
- Reimplementing the CI job matrix duplicates its aggregate owner; independent observations remain separate from that verdict.

## Consequences

Workflow edits regenerate the required-check projection. Missing or stale receipts cannot produce PASS. Offline rejection fixtures cover identity, attempt, required-job and source drift; Git fixtures cover shallow parents and dirty inputs. Online collection, GitHub commit verification, and newest-run rechecks remain required before candidate acceptance. Receipts are unsigned observations and do not establish authenticated provenance or branch protection.

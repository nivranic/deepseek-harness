# Agent Note: Backend teardown drains unit owners

Status: implemented

English | [中文](2026-09-16-storage-owner-teardown.zh.md)

## Problem

A domain can own accepted writes that have not reached its backend unit, including a checkpoint waiting for Session log durability. Closing only the unit misses that work. A domain still loading records can also return a handle after its facility starts closing.

## Decision

[`KvFacet.open`](../../../../packages/storage/storage/src/backend.ts) accepts an optional owner teardown callback. Backend close joins pending opens, drains each registered owner before closing its unit, then releases the medium. Independent unit close withdraws its callback. Callbacks stop new work and drain accepted work; they may close their unit but must not await backend close, which is waiting for them.

JSON and SQLite use the shared [`closeOwnedKvUnits`](../../../../packages/storage/storage/src/close-units.ts) helper. Each unit close runs even if its owner fails. Independent owners settle before medium release, and an `AggregateError` retains owner, unit, and medium failures in registration order. Concurrent or repeated backend closes share one teardown result.

[`DomainFacility`](../../../../packages/storage/storage-domain/src/index.ts) registers the owner callback when opening a unit. Its terminal `closeAll()` stops new opens and joins both active domains and pending initialization. A valid initialization interrupted by close rejects with `closed` and releases its unit instead of publishing a handle. Initialization failure remains visible to the opener; a concurrent closer also receives initialization cleanup failures. Facility unmount runs even when teardown rejects.

## Alternatives considered

**Drain only backend writes.** The backend cannot observe prerequisites waiting in the domain queue, so its own drain cannot preserve all accepted work.

**Rely on plugin disposal order.** Direct backend close remains callable outside plugin disposal. Ordering plugins cannot enforce that public operation's obligations.

**Add another lifecycle registry.** The backend already tracks each live unit. Keeping its owner callback with that unit provides registration and withdrawal without a second registry or RPC.

## Consequences

The [checkpoint ordering decision](2026-09-16-checkpoint-write-order.md) remains active: each checkpoint must reserve its domain queue position before waiting for log durability. Backend teardown extends that drainage to medium disposal. The [cache compatibility decision](../architecture/2026-09-02-projcache-cross-version-read-compat.md) still owns record versions and lineage; neither decision is superseded, and this change adds no Session event or storage generation.

Shared JSON/SQLite conformance tests check durable owner work, callback withdrawal, repeated close, and multiple cleanup failures. Domain tests check initialization races and all-owner drainage. The authored [Web Session recording](../../../../snapshots/web/checkpoint-order/session.v3.jsonl) runs through the Web Loader with backend close during a pending checkpoint and verifies the durable cache and Session log. These checks do not qualify installed Desktop artifacts, real model providers, or other platforms.

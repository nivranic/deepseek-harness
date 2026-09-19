# Agent Note: Checkpoint capture order includes log durability

Status: implemented

English | [中文](2026-09-16-checkpoint-write-order.zh.md)

## Problem

Two checkpoints of one Session can finish their log flushes in a different order from their captures. Enqueuing the record only after that wait allows an older cut to replace a newer durable checkpoint. A domain close can also miss work that is still waiting outside its queue.

## Decision

[`KvTable.put`](../../../../packages/storage/storage-domain/src/domain.ts) accepts an optional asynchronous prerequisite. The domain reserves the write position first, invokes the prerequisite in that position, and persists and publishes only after it succeeds. A synchronous throw or asynchronous rejection skips both the record update and `domain/changed`; subsequent accepted writes remain runnable. A closed domain rejects a new operation without invoking its prerequisite. Domain close drains accepted prerequisites with their writes.

[`SessionProjectionCache.write`](../../../../packages/session/session-projection-cache/src/index.ts) captures the projection and its complete lifecycle identity before queuing the log flush with the replacement. The Session store remains the sole flush dispatcher. Detached Sessions use the existing persistence retirement drain and cold-read watermark checks. The projection registry already returns detached values; its cloning behavior remains unchanged.

The [cache compatibility decision](../architecture/2026-09-02-projcache-cross-version-read-compat.md) continues to own format and lineage checks, including `inheritedEventCount`. The [Session observation decision](../architecture/2026-08-25-session-observations-and-projection-owned-client-state.md) continues to own exact reads and Client projection ownership. Neither decision is superseded, and this change adds no Session event or storage generation.

## Alternatives considered

**Wait before reserving the write position.** This admits completion-order writes and leaves the wait outside domain teardown.

**Add a second queue to the projection cache.** This duplicates the domain's serialization and close ownership. Other writes to the same domain would not share that queue.

**Pass an already-running promise.** An earlier queue position or a closed domain can leave its rejection unobserved. Invoking a callback inside the accepted position keeps start, failure, and disposal ownership together.

## Consequences

A prerequisite must not await another write or close on the same domain because those operations wait behind it. It is a durability dependency, not a transaction or rollback hook. Backends own their medium lifecycle and drain registered domain owners before closing units, as defined by the [owner teardown decision](2026-09-16-storage-owner-teardown.md).

Regression tests cover an older delayed flush replacing the latest durable value, mutable projection isolation, prerequisite failures, queue continuation, and close drainage. The authored [Web Session recording](../../../../snapshots/web/checkpoint-order/session.v3.jsonl) exercises title changes through the shipped Loader composition and compares the persisted event log. This does not qualify other platforms, installed artifacts, or real model providers.

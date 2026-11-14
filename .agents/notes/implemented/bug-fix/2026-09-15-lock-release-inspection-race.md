# Agent Note: Retry a lock released during inspection

Status: implemented

English | [中文](2026-09-15-lock-release-inspection-race.zh.md)

## Problem

Windows can report `EPERM` when exclusive creation encounters a held writer lock. The holder can remove that lock before the contender checks its existence. Treating the resulting `ENOENT` as a permanent permission failure rejects an operation that can acquire the released lock.

## Decision

[`withFileLock`](../../../../packages/util/atomic-write/src/index.ts) allows one immediate exclusive-create retry after `EPERM` followed by an `ENOENT` inspection. A second consecutive unconfirmed `EPERM` preserves the create error. An observed held lock restores ordinary bounded contention handling; other inspection failures preserve the original create error. The contender never removes another writer's lock.

## Alternatives considered

**Reject every unconfirmed EPERM.** This loses the release race even when the next exclusive create can succeed.

**Treat every EPERM as contention.** This delays genuine permission failures and reports them as lock timeouts. The bounded retry distinguishes a possible release from persistent failure without weakening exclusive creation.

## Consequences

Settings and credential writers can acquire a just-released lock while persistent permission errors still reject. Rename retries, string-only writes, the deadline, and orphan recovery remain unchanged. The [credential storage decision](../architecture/2026-07-30-credential-boundaries-and-atomic-registration.md) retains its independent ownership and stale-write guarantees.

Verification must place the holder's unlink between failed creation and inspection, observe one successful operation and lock cleanup, and reject consecutive missing-lock errors and unrelated inspection failures. The race is deterministic filesystem fault injection, not evidence of changed Windows permissions or a real permission-failure recovery.

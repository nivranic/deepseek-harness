# Agent Note: Preserve context for pending snapshot reads

Status: implemented

English | [中文](2026-09-06-snapshot-pending-read-diagnostics.zh.md)

## Problem

An asynchronous persistence probe can still be reading when its deadline expires. Vitest then has no callback failure to report and emits a generic timeout. The diagnostic loses the session and requested record, so it cannot distinguish a missing post-turn event from another wait in the same scenario.

## Decision

The [snapshot polling adapter](../../../../packages/test-support/session-snapshot/src/wait-for-snapshot-check.ts) tracks whether its assertion has rejected. If none has rejected when the waiter fails, the adapter reports the scenario's timeout message and keeps the original failure as its cause. An observed assertion failure propagates unchanged, including a failure whose text happens to match Vitest's timeout message. Classification depends on the assertion's actual outcome rather than message matching.

All asynchronous persistence waits in the [scenario harness](../../../../packages/test-support/session-snapshot/src/harness.ts) supply their existing diagnostic. Poll intervals, deadlines, predicates and malformed-turn handling retain their semantics. A late read cannot change an already rejected scenario into success; the waiter does not cancel the underlying filesystem operation.

## Alternatives considered

- Increasing a short test timeout leaves the first-read race possible under slower I/O.
- Accepting a generic timeout in the assertion loses evidence about which scenario step failed.
- Replacing every error by its message hides observed read and parse failures; their original values remain available to callers.

## Consequences

A controlled pending promise reproduces the unnamed timeout independently of disk speed. Tests also cover retry success, late completion and unchanged observed failures. The complete harness suite exercises the real subprocess paths and persisted records. The [ACP snapshot decision](2026-06-19-acp-snapshot-tests.md) remains the authority for replay derivation and fixture fidelity; this adapter changes failure diagnostics only.

# Agent Note: Atomic replacement and a retained flat-migration generation

Status: implemented

English | [中文](2026-10-04-atomic-durability.zh.md)

## Problem

Section 46 requires adjacent, atomic, recoverable, crash-safe persistence writes and retention of the source during startup migrations. File replacement and migration retention have separate owners. The shared atomic writer stages and renames complete content. Credentials migration must also preserve the pre-release flat document before replacing it.

## Decision

Credentials migration writes the flat original to `<file>.migration-v0.bak` with owner-only permissions under the writer lock before replacing the document. Re-migration writes the same backup bytes. A later boot of the migrated document leaves that backup untouched.

The adopted `writeFileAtomic` implementation uses an exclusive temporary sibling, caller-selected permissions, and atomic rename with bounded Windows retries. It performs no file or directory `fsync`. Storage JSON and JSONL own their synchronized publication protocols. Their guarantees do not extend to consumers of the shared writer.

`credentials-local/tests/migration.spec.ts` checks byte-identical retention, owner-only mode on POSIX, and an unchanged backup after a second boot. `atomic-write/tests/atomic-write.spec.ts` covers complete replacement, permissions, symlink handling, and rename failures. Power-loss recovery requires separate platform evidence.

## Alternatives considered

Routine settings updates use atomic replacement. The credentials layout migration additionally retains its source because a schema conversion needs an operator-recoverable predecessor. Storage-specific synchronized writers keep their own publication and recovery responsibilities.

## Consequences

Credentials startup migration leaves a recoverable source beside the converted document. Settings and credentials inherit atomic replacement from the shared writer. Crash durability and Windows owner-only ACL enforcement remain outside that writer's guarantees.

## Open follow-ups

Generic-writer crash durability, session-query-sqlite's derived schema reset, and storage-sqlite's version refusal remain separate review items. [JSONL persistence](../../../../packages/session/session-persistence-jsonl/README.md) owns torn-tail repair and its retained repair intent.

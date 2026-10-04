# Agent Note: Crash-durable atomic writes and a retained flat-migration generation

Status: implemented

English | [中文](2026-10-04-atomic-durability.zh.md)

## Problem

Section 46 requires persistence writes to be adjacent, atomic, recoverable, and crash-safe, and forbids overwriting a user's only copy at startup. A read-only survey of every persistence write path found the session log backend already satisfies the full clause, but the two surfaces under the shared `dsh-atomic-write` primitive did not: `writeFileAtomic` staged a temp file and renamed it without any `fsync` (its own TODO said crash durability was out of scope), so every `settings.yaml` and `.credentials.yaml` write could be observed unwound after a crash — and the credentials boot upgrade of the pre-release flat layout rewrote the sole copy of a secrets document in place, with no old generation retained anywhere.

## Decision

`writeFileAtomic` now mirrors the crash-safe protocol `dsh-storage-json` already ships: the exclusive-create temp file is written, fsynced, and closed before the rename commits, and the parent directory is fsynced on POSIX afterwards (Windows rejects `O_RDONLY` directory opens; the platform's atomic `MoveFileExW` replacement carries the commit, with the directory entry left to the platform — recorded as the package's remaining limitation). The credentials flat-layout migration now retains the old generation per the clause: the flat original is written to `<file>.migration-v0.bak` (owner-only, itself through the now-durable writer) before the sole copy is replaced, a re-migration rewrites the same backup bytes, and a later boot of the already-migrated document leaves the backup untouched.

Verification: `atomic-write.spec.ts` gained a recorded-order case asserting the temp fsync happens before the rename commit (the existing `node:fs/promises` mock harness wraps `open` and records handle `sync` vs `rename`) and a failure case asserting a pre-rename fsync error removes the temp sibling and leaves the target's old content intact; `migration.spec.ts` gained the retention case (backup byte-identical, owner-only mode, untouched by a second boot). Lanes: atomic-write 15 (one pre-existing Windows symlink-EPERM case, stash-probe-proven at HEAD), credentials-local 104+1skip, settings-file 45+2skip (its mid-cycle lock-race injection moved from module-level `writeFile` to the handle seam the new writer uses — same behavior, new seam), app-boot/host-description/llm-deepseek/agent-presets 739 (agent-presets' one dangling-install-link failure is a stash-probe-proven HEAD Windows baseline).

## Alternatives considered

Backing up the settings document on every write was rejected: routine settings updates are not migrations, and rename-atomic replacement plus fsync already guarantees "complete old or complete new" — the retention obligation belongs to the one true migration on these surfaces (the credentials layout upgrade). Making `fsyncDirectory` throw on Windows was rejected in favor of the storage-json precedent's platform guard: the durability win there is the file fsync, which stands on all platforms. Rebuilding the storage-sqlite version-mismatch refusal and the session-query-sqlite in-place derived reset into adjacent migrations was deferred: the former is an unreleased schema with nothing to migrate, and the latter is a rebuildable read model over logs the durable backend already preserves — both stay honestly recorded as open §46 items rather than silently claimed.

## Consequences

Every `writeFileAtomic` consumer (settings, credentials, and the four packages riding the same primitive) is crash-durable without any call-site change. The credentials boot migration now leaves an operator-recoverable old generation beside the migrated document. The package READMEs' durability contracts flipped in both languages, with the Windows directory-fsync gap and the Windows-ACL permission question recorded as the remaining limitations.

## Open follow-ups

session-query-sqlite's destructive in-place schema reset, storage-sqlite's no-migration version refusal, and the JSONL torn-tail repair truncation window remain open §46 items for later adjudication; none loses user data today (the reset rebuilds from preserved logs, the refusal fails loud, and the repair rewrites recovered events), but none meets the full adjacent/retain-old-generation bar either.

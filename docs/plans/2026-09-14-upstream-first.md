# Upstream-First Implementation Plan

English | [中文](2026-09-14-upstream-first.zh.md)

**Goal:** Converge downstream capabilities onto the captured official Host, Desktop, Typert API, and shared Client.

**Architecture:** Start from the official commit in an isolated worktree. Import reviewed capabilities through their current owners; keep historical branches and product data intact.

**Tech Stack:** Git, Node.js, pnpm, Cordis, Typert, Electron, React, Swift, Kotlin.

## Summary

Phases 0 and 1 are complete: source dispositions cover every captured component and legacy uncommitted report. Gate 0 admits the migration plan; Phase 2 ports selected behavior onto the official application. [Implementation status](../../IMPLEMENTATION_STATUS.md) owns progress; [the inventory](../../CUSTOM_CAPABILITY_INVENTORY.json) owns classifications.

## Table of Contents

- [Task 1: Complete the audit](#task-1-complete-the-audit)
- [Task 2: Converge Desktop](#task-2-converge-desktop)
- [Task 3: Stabilize shared APIs](#task-3-stabilize-shared-apis)
- [Task 4: Continue in dependency order](#task-4-continue-in-dependency-order)
- [Dev Note](#dev-note)

<a id="task-1-complete-the-audit"></a>
## Task 1: Complete the audit

Files: [baseline](../../UPSTREAM_DELTA.json), [inventory](../../CUSTOM_CAPABILITY_INVENTORY.json), [audit](../../UPSTREAM_DELTA.md), and [decision](../../.agents/notes/proposed/architecture/2026-09-14-upstream-first-convergence.md).

1. Compare each component's recorded source commits with the captured official commit and their merge-base. Include old Goal uncommitted paths separately; never equate them with the source commit.
2. Review Desktop custom settings, native integration, diagnostics, and recovery first, then Gateway, Session Controller, Connection, persistence, settings, and credentials.
3. Resolve every component without a capability mapping. Record Adopt, Adapt, Keep, Migrate, Delete, or Experimental with exact source, target, dependency, and verification needs.
4. Keep Gate 0 open until all required patch reviews and migration decisions are recorded. Check report consistency and prove that an incomplete audit cannot claim Gate 0 PASS.

<a id="task-2-converge-desktop"></a>
## Task 2: Converge Desktop

Files: [Desktop sources](../../apps/desktop/src/main.ts), [Host process](../../apps/desktop/src/host-process.ts), [package configuration](../../apps/desktop/electron-builder.config.mjs), and owner-local tests under `apps/desktop/tests/`.

1. Keep the official runtime lifecycle, exact version binding, custom scheme, framed pipes, plugin manager, and updater.
2. Keep tray preferences and login registration in the [Shell owner](../../.agents/notes/implemented/architecture/2026-09-15-desktop-shell-preferences.md). Convert legacy Host-owned Desktop settings only through a reviewed, explicit migration; do not mirror OS login state. Port diagnostics and health through their shared owners. Update locale dictionaries and relevant snapshots with UI changes.
3. Run focused Host lifecycle, protocol, single-instance, and update tests, followed by the supported Desktop development launcher with an isolated Harness home. Record source tests separately from application execution.
4. Treat Windows and macOS packaging, signing, installation, and recovery as later platform evidence. Do not infer them from source tests.

<a id="task-3-stabilize-shared-apis"></a>
## Task 3: Stabilize shared APIs

Files: [Gateway](../../packages/api/gateway/src/index.ts), [Remote assembly](../../packages/api/remotes/src/index.ts), [Connection](../../packages/client/connection/src/client/connection.ts), [Session client](../../packages/api/session-controller/src/client/sessions/manager.ts), and the current persistence owners.

1. Design HostDescriptor and capabilities through the current Remote contribution mechanism, separating product, API, and Session-format versions.
2. Define error results and mutation identity at their domain owners. Verify duplicate prompt, answer, cancel, and rename requests before claiming retry safety.
3. Reuse Gateway pending waterfall delivery and replay. Specify the second answer's closed result and Host restart behavior before changing the protocol.
4. Resolve old SQLite Session and versioned settings documents through explicit, recoverable conversion designs. Never run candidate boot against the user's historical Harness home.
5. Add meaningful unit/integration cases, keyless product snapshots, and TS/Swift/Kotlin compatibility fixtures at their owners; update both SDK projections when Session events change.

<a id="task-4-continue-in-dependency-order"></a>
## Task 4: Continue in dependency order

Complete Interaction reliability, responsive shared Client, diagnostics, Device Trust, Remote transport, follow/attach/view handoff/multi-host, thin Native companions, Lite, and release qualification in that order. [Compatibility](../../COMPATIBILITY_MATRIX.md), [security](../../SECURITY_STATUS.md), [platform](../../PLATFORM_VERIFICATION.md), and [release](../../RELEASE_STATUS.md) reports own their evidence gaps.

<a id="dev-note"></a>
## Dev Note

The source commit is a candidate baseline, not a migrated product or RC. No commit, push, product-data migration, signing, or publication has been performed by this task.

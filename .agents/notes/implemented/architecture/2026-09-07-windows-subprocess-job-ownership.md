# Agent Note: Ordinary Windows subprocesses remain owned by a kernel Job

Status: implemented

English | [中文](2026-09-07-windows-subprocess-job-ownership.zh.md)

## Problem

A Windows program can spawn a detached descendant and exit before its consumer asks for termination. A PID-rooted process-table walk cannot reliably recover that descendant after the root disappears. Treating the root's exit as whole-tree quiescence releases ownership while work can still execute, and `taskkill /T` cannot restore the lost relationship.

Assigning an already-running target to a Job leaves a second gap: target code can spawn before assignment. The local provider also needs Node-compatible pipes, arbitrary executable arguments, Electron support, and the packaged Python SDK's fixed `dsh` entry.

## Decision

The local provider owns one non-inheritable, non-breakaway, kill-on-close Job per ordinary Windows subprocess. A trusted bootstrap starts without the target's startup environment. The parent assigns that bootstrap to the Job before sending the executable, argv, and explicit environment over IPC. The bootstrap inherits the caller's three standard streams and starts the target detached from libuv's additional kill-on-bootstrap-exit Job; the target and its descendants still inherit the provider's Job.

The bootstrap reports the target's exit facts over IPC separately from its own exit. A target can exit while descendants remain active. `done` retains that result; `waitForExit()` requires a successful kernel query showing zero active Job members. Normal termination requests `TerminateJobObject`, then observes membership. Closing the owner handle terminates remaining members even if the host exits without executing JavaScript, but handle closure alone is not an exit observation.

Job setup and target spawn failures reject the launch. Unexpected bootstrap exit without a target outcome terminates the Job and rejects `done`; explicit cancellation can settle with the terminated bootstrap's facts. A late IPC failure cannot replace an already-owned cancellation. Failed Job queries or termination retain the handle for final cleanup rather than publishing successful quiescence. Both success and failure close harness-collected pipes and spill descriptors; pipe-mode streams remain caller-owned.

Bootstrap startup excludes inherited `NODE_*`, `ELECTRON_*`, and `TSX_*` hooks before applying the runtime's required launch flags. The original target environment travels only in the post-assignment message. Source runs select the TypeScript helper; built Node and Electron runs select its JavaScript entry. A Windows SEA re-enters the fixed `dsh` bin with a private marker and parent IPC, then loads only this helper. Plain Node, missing IPC, and invalid marker values reject that selection. The helper is not a second application launcher or a security sandbox.

The [shared Win32 library](2026-08-19-shared-win32-process-primitives.md) owns Job handles, assignment, accounting, and native errors. Its anonymous Koffi structures are module-owned, so independently loaded module generations do not collide in the native type-name registry. The provider owns IPC, stream settlement, cancellation, and lifecycle observation. POSIX group and terminal-session mechanics keep their existing owners.

## Existing decisions and supersession

This decision supersedes the ordinary Windows PID-tree realization in the [subprocess seam](2026-07-26-subprocess-seam.md) and [synchronous host-exit cleanup](../bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.md). Those records remain active for capability separation, consumer ownership, POSIX behavior, and terminal finalization. The shared Win32 decision remains active for policy/resource separation; its requirement for a real ordinary-process consumer is satisfied here. The [Python profile runtime](2026-08-23-python-sdk-dsh-profile-runtime.md) still owns packaging and module fallback. No active record is fully superseded.

## Alternatives considered

**Keep PID-tree termination.** Rejected because root exit removes the discoverable relationship before cleanup can act; repeating a process-table scan does not recover kernel ownership.

**Assign the requested program after ordinary spawn.** Rejected because target code can run before assignment. Gating a trusted helper preserves Node's stdio implementation while withholding target code until membership exists.

**Implement another native piped process launcher.** Rejected because the current consumer needs Job ownership, not a duplicate of Node's executable quoting, stream plumbing, and runtime launch behavior. The shared library exposes only the additional native operations this path consumes.

**Let a SEA execute arbitrary script argv.** Rejected because the packaged CLI has one fixed entry and supported applications use profiles. A fixed private helper selected over parent IPC preserves that application model.

## Consequences

Each ordinary Windows launch adds one bootstrap process and one Job handle. Restrictive enclosing Jobs can reject assignment, and the provider fails instead of falling back to PID-only cleanup. The interval before assignment contains only trusted bootstrap startup; parent IPC disconnect ends an unassigned helper. Job membership can reach zero before separately held process handles become signaled, so those observations remain distinct.

This changes ordinary Windows process ownership only. It does not strengthen terminal descendant discovery, confine target filesystem access, guarantee POSIX cleanup after native host failure, or recover work after power loss.

## Verification

Native Windows regressions cover target outcomes, explicit environment and startup-hook isolation, descendants retained after target exit, cancellation before assignment, setup failure, unexpected helper exit, and final cleanup after a failed membership query. Portable protocol tests cover IPC validation, ordering, late cancellation callbacks, and spill descriptor closure. Linux regressions retain POSIX escalation, output, terminal, and host-exit behavior; Koffi reload and native allocation tests cover independent module generations.

The header probe binds Job accounting size and active-member offset to the Windows SDK. Built Node, Electron, and full SEA profile smokes exercise the helper through their actual runtime entries; source coverage cannot observe the self-executing child entry. These process checks do not establish Windows installer acceptance or complete cross-platform release qualification.

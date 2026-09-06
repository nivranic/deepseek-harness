---
description: "The local host provider for the subprocess service: run managed process trees and real terminal sessions on the host machine."
kind: "package-reference"
---

# @deepseek-ai/dsh-subprocess-local

English | [中文](README.zh.md)

## Summary

Mount `dsh-subprocess-local` in a composition that runs child processes on the host: it resolves local executables, owns POSIX process groups or Windows Jobs with explicit stdio, and provides real terminal sessions through `node-pty`. It has no configuration; each spawn request supplies its dispositions, limits, terminal size, and grace. Collected output retains a bounded tail with optional spill files, children receive a scrubbed environment, and disposal terminates and joins every owned tree.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider beside its consumers and start processes exactly as the subprocess service specifies; this package decides only how those processes run on the host.

### Mounting the provider

Load the provider in the same composition as its consumers. It has no config fields: every choice arrives on the spawn request, so deployment-varying decisions stay with the caller's configuration.

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-bash-local'
```

### Resolving executables

Absolute executable paths are verified; bare names resolve against the scrubbed PATH with platform-aware executable extensions (`.COM`/`.EXE`/`.BAT`/`.CMD` on Windows). Relative paths containing separators are rejected — provide an absolute path or a bare PATH name — and relative PATH entries resolve from the host process cwd.

### Collecting output

Collect mode keeps the last `maxBytes` of a stream in memory — errors and final results cluster at the end — and, when a `spill` cap is configured, appends the complete stream to a private file under a per-process directory in the OS temp dir (a `0700` directory, `0600` random-named files). A stream larger than the spill cap discards its incomplete spill and returns only the marked truncated tail. Reads are offset-based and non-consuming, so background and batch readers coexist before and after exit.

### Running terminal sessions

`spawnTerminal` allocates a real PTY and bridges UTF-8 text; you can inspect and signal the current foreground process group and await a `terminate()` that settles every session member the provider can still observe. On Linux, an exact input wait requires a foreground thread whose fd 0 identifies the shell's controlling terminal and whose current syscall waits on that fd. If the kernel denies the syscall probe, the provider reports no exact wait and leaves the higher PTY backend to its idle inference; process sleep state is not evidence. On Windows, SIGINT is delivered as a Ctrl-C input write, SIGTSTP and SIGHUP are unsupported, and teardown verifies the shell's termination through the process table because an externally killed shell may never fire the PTY exit notification.

### Shutdown behavior

Normal disposal terminates every owned tree and terminal and awaits their exit. At a JavaScript-observable host exit, synchronous finalization sends SIGKILL to POSIX groups, closes ordinary Windows Job handles, and terminates observable terminal members without promises or timers. Windows kill-on-close Jobs also terminate ordinary members when the host dies without running JavaScript; POSIX groups and terminal sessions require an external owner for those failures.

### What can go wrong

An unresolved executable fails loudly. `done` rejects launch failures and an unexpected bootstrap exit without a target outcome; the latter also terminates the Windows Job. Collected pipes and spill descriptors close on success and error. A failed Job query or termination remains an error, and the service retains ownership for final cleanup. A read past the retained tail is `lossy`; POSIX or terminal descendants outside the owned group or observable session can outlive cleanup.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and points at the code that realizes them; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The provider owns a POSIX process group or a non-breakaway Windows Job independently of the requested program's exit. A Windows bootstrap receives executable, argv, and target environment over IPC only after Job assignment. Its startup environment excludes caller `NODE_*`, `ELECTRON_*`, and `TSX_*` hooks; the target still receives the explicit environment. The bootstrap reports the target outcome separately and permits descendants to remain in the Job after the target exits. `pid` identifies the bootstrap tree root on Windows. The [Job ownership decision](../../../.agents/notes/implemented/architecture/2026-09-07-windows-subprocess-job-ownership.md) explains the fixed SEA entry and assignment interval.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service wiring: live-handle sets, disposal, host-exit finalization, executable lookup |
| [`src/spawn.ts`](src/spawn.ts) | Standard streams, tail collection, spill files, POSIX escalation, and tree-exit observation |
| [`src/windows-spawn.ts`](src/windows-spawn.ts) / [`src/windows-bootstrap.ts`](src/windows-bootstrap.ts) | Job assignment, private IPC launch, and target exit facts |
| [`src/terminal.ts`](src/terminal.ts) | `node-pty` terminal handle: foreground inspection, session cleanup, Windows teardown |
| [`src/process-inspector.ts`](src/process-inspector.ts) | POSIX process-tree and session inspection |
| [`src/windows-inspector.ts`](src/windows-inspector.ts) | Windows Toolhelp32 process-table inspection via koffi |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; the seam owns the contract) |

### Main flow

`done` retains the requested program's outcome after a bounded pipe-drain grace, so a descendant holding an inherited pipe cannot delay settlement indefinitely. Whole-tree observation remains independent: POSIX escalation survives direct-child settlement, and Windows waits for zero active Job members before closing the owner handle. Terminal cleanup sweeps exact process identities, stops the shell, re-sweeps, and verifies absence through the process table.

### Safety invariants

Spill files are opened `0600` with `O_EXCL` and random names under a `0700` per-process directory, defeating symlink planting in shared temp dirs; a failed final close withholds the spill path. Process identities carry start times, so cleanup never follows PID reuse. Host-exit finalization creates no promises or timers, preserves the host exit code and diagnostic, contains each target's failure, and does not claim quiescence.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the provider-level contract is not enough. They move from the exhaustive type reference to the abstract contract and the decisions behind the host mechanics.

- [Subprocess subsystem](../../../docs/subsystems/subprocess.md) — spawn specs, output readers, outcomes, and the `DSH_*` environment in full.
- [dsh-subprocess](../subprocess/README.md) — the abstract contract this provider implements.
- [dsh-bash-local](../../shell/bash-local/README.md) — the largest consumer and the concrete stdio shapes it asks for.
- [Subprocess seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md) — why the process half became its own seam.
- [Synchronous subprocess exit cleanup](../../../.agents/notes/implemented/bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.md) — the host-exit finalization decision and its failure modes.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumer seams such as the bash executor family, which own all model-facing rendering of spawned process output and lifecycle.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a general platform comparison or a task backlog.

- **Windows Job assignment is required** — creation or assignment failure rejects the launch before target code runs. Restrictive enclosing Jobs can prevent assignment; the provider does not fall back to PID-only termination.
- **Windows terminal signalling is console-wide** — SIGINT is delivered as a `\x03` Ctrl-C input write that conhost turns into a console-wide CTRL_C event; SIGTSTP and SIGHUP are rejected as unavailable; a `taskkill` without `/F` does not terminate console processes, so the teardown TERM tier is a grace wait before the `/F` escalation.
- **A daemonized terminal descendant can still escape the observable boundary** — on macOS, a child that reparents before any foreground-inspection snapshot is no longer discoverable from the PTY root; on Linux, a `setsid` child leaves both the tree and the owned terminal session; the provider adds no continuous process-table monitor.
- **POSIX and terminal finalization requires a JavaScript-observable exit** — unhandled signals, fatal OOM, `process.abort()`, and native crashes need an external owner. Ordinary Windows Jobs retain kernel ownership when the host exits; this is lifetime management, not a security sandbox or a power-loss recovery mechanism.
- **The credential scrub is a name heuristic** — `*KEY*`/`*PASSWORD*`/`*SECRET*`/`*TOKEN*` only; differently named secrets (for example `*PASSPHRASE*`) pass through, and a whitelist for over-scrubbed variables is noted future work.
- **Completed spill files are not deleted** — bounded full-output recovery files (and the private per-process spill directory) accumulate under the OS tmpdir until something external cleans them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

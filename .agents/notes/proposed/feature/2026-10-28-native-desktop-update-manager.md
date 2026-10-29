# Agent Note: Standalone native Desktop update manager

Status: proposed

English | [中文](2026-10-28-native-desktop-update-manager.zh.md)

## Problem

A personal fork needs a repeatable Windows build and local deployment entry that preserves the current application, user data and unrelated development work. Build completion, verified installation and shortcut maintenance are different outcomes; one success flag cannot safely recover interrupted updates.

## Proposal

Keep the manager in a standalone C# solution with a WinUI 3 host, shared core and CLI. Store typed durable milestones, complete artifact identity, the fixed remote SHA and independent deployment verification. Use the fork's unsigned NSIS pipeline and its isolated runtime smoke, with an owned source checkout and supported installation directory parameters.

The manager runs from a complete .NET and Windows App SDK self-contained directory. Windows Job Objects contain only task-owned processes. Existing directories require explicit ownership and reject reparse points; manager replacement stages a verified directory and uses same-volume Directory.Move, preserving the former directory for recovery.

Configuration saves and update tasks hold the same cross-process lease. An opened instance checks its build configuration against the saved file under that lease before using the backend. Installation verification uses the expected artifact's complete payload; an old receipt with the same version and commit cannot establish that a rebuilt package was installed. Pending deployment receipts become committed only after that verification.

Each subprocess output pipe maintains independent credential-redaction state across bounded byte chunks. Explicit secret masks leave the original characters available for credential syntax recognition, and retained UTF-16 text never separates a surrogate pair. Long credential values are discarded without buffering the complete line; the disk log and bounded display receive the same sanitized output.

Startup diagnosis uses opt-in, bounded QPC marks with fixed phase names, without configuration or log contents. Trace writes occur on normal close after managed-directory checks and cannot change task state. Log controls load on first expansion and remain loaded to retain search and follow state; collapsed presentation does not stop log persistence or bounded buffering. UI Automation call durations include provider work and waits on the UI thread, so they cannot be subtracted from startup samples to establish user interactivity.

## Alternatives considered

**Electron management UI.** Reusing the target application's renderer couples the updater to the application it must replace and adds a separate JavaScript UI runtime. The requested WinUI host keeps update execution in one reusable C# core.

**Copy the application EXE.** The application requires its full Electron resources, runtimes and installer registration. The fork's supported NSIS pipeline owns those installation behaviors and directory rollback.

**Synchronize the active development checkout.** A dedicated owned checkout pins one commit without overwriting dirty work or changing the user's branch and remote configuration.

## Acceptance criteria

The complete manager starts from the specified BAT, displays local information before network work and follows typed task events. Behavioral tests cover SemVer, failed final writes, process ownership, cancellation, artifact reuse and unsafe paths; native UI, complete real build/install, launch and performance evidence remain separate acceptance categories.

Actual application packaging requires an authorized Mandatory Update service origin. A syntactically valid address or a successful fixture test does not satisfy that external dependency. Follow the [manager verification record](../../../../desktop-manager/docs/verification.zh.md) for measured results and remaining work.

## Risks

Self-contained delivery costs disk space and requires maintaining two runtime distributions. Same-volume directory renames preserve recoverable backups but are not one atomic exchange across a power failure. Program-file rollback does not establish compatibility with migrated user data. The fork provides no default production update-service host, so that service must be verified before real packaging can be accepted.

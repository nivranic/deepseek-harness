# Agent Note: Privacy-safe session telemetry

Status: implemented

English | [中文](2026-09-02-privacy-safe-session-telemetry.zh.md)

## Problem

The shared base selected `FEEDBACK_ONLY` when `DSH_TELEMETRY_MODE` was absent, so recording `/feedback` constructed an outbound transport without a prior deployment choice. The capture coordinator also copied complete Session event payloads and `session.cwd`; a rule-free export could therefore include prompts, reasoning, system prompts, tool schemas, tool arguments and results, feedback text, error messages, source and file content, and local paths. The acknowledgement disclosed this release only after the feedback event had triggered it.

## Decision

The shared base and direct provider construction default to `DISABLED`. Only an explicit `DSH_TELEMETRY_MODE=FULL` or `FEEDBACK_ONLY` constructs an OTLP exporter, while any non-empty `DSH_TELEMETRY_DISABLED` remains the pre-load hard opt-out. `FEEDBACK_ONLY` remains available for a deployment that explicitly chooses feedback-triggered prefixes; recording feedback alone is not the shipped default consent mechanism.

The Service Definition applies a mandatory privacy projection before its `session-telemetry/record` waterfall. Seam records carry no body value and contain only the bounded diagnostics in the [subsystem privacy inventory](../../../../docs/subsystems/session-telemetry.md#privacy-inventory); an OTLP JSON encoder may represent the contentless body as `{}`. Model-produced tool names and arbitrary error names/codes are absent; error reporting uses a fixed built-in class vocabulary with `CustomError` fallback. Unknown plugin events expose only record time, pseudonymous Session identity, event type, and sequence. The waterfall receives a frozen record whose Session ids are already pseudonymous; after it returns, the coordinator retains only original attributes with unchanged keys and values, so a listener can delete fields or choose a fixed severity but cannot add, rewrite, or alias outbound data.

`ctx.sessionTelemetry` exposes only the `sharing` disclosure. Each Service Provider gives the coordinator a private `SessionTelemetrySink`, so another plugin cannot inject arbitrary outbound records or drive provider shutdown. The anonymous-identity owner persists one private 256-bit root and derives public user identity and Session pseudonyms under separate HMAC domains. POSIX reads require current-user ownership and no group/other permissions. First creation publishes a fully written same-directory inode without replacement; reads compare pre-open, descriptor, and post-open identities. Rotation publishes or adopts one complete private no-replace claim, verifies the current target, and atomically moves the shared claim onto its path, so cooperating processes use one seed and an interrupted process leaves a recoverable claim. Exposed or oversized regular roots rotate without a content read; checks reject unsafe or changed paths before publication. Node has no cross-platform device-and-inode compare-and-replace operation, so a process with write access to the harness home can replace a directory entry between the final check and rename. Rename does not follow a symlink or write its referent, but it can replace that entry; custom homes therefore require operator protection. Windows fresh files inherit the harness-home DACL because Node.js mode bits cannot validate that ACL. The coordinator resolves the identity before capture and pseudonymizes Session and parent Session ids before any extensible callback; the root and Session key never leave the identity package. The OTel provider adds only the derived public user id, product version, platform, and architecture as Resource attributes; its two static instrumentation scopes carry the package version, and every SDK log record binds to `ROOT_CONTEXT` so ambient spans cannot add trace correlation.

## Alternatives considered

**Keep feedback-gated sharing as the shipped default and improve the acknowledgement.** Rejected because disclosure after the event cannot authorize a release that already started, and a free-text feedback action is not deployment consent even for bounded diagnostics.

**Keep raw records and require every deployment to mount a redaction listener.** Rejected because an omitted or incomplete listener fails open at the trust boundary. Data minimization belongs to the capture owner and must hold with no deployment extension.

**Allow `FULL` to bypass the privacy projection after explicit opt-in.** Rejected because an environment setting authorizes telemetry transport, not unrestricted source code, prompts, credentials embedded in tool output, or workspace paths. A future payload-sharing feature requires its own explicit data classes and consent.

**Hash or encrypt complete payloads.** Rejected because reversible encryption still exports the sensitive payload and opaque hashes provide less diagnostic value than structured event metadata while retaining correlation risk.

## Consequences

Fresh profiles make no telemetry network request. Explicit uploading modes preserve version/platform correlation, pseudonymous Session timelines, fixed event outcomes, fixed error classes, and lifecycle signals, while sensitive payload leakage is structurally absent. Receivers lose tool names, error codes, free-form feedback, and transcript reconstruction; users send those through a separately authorized support channel when needed. Unit and real Loader tests assert that prompt, reasoning, system-prompt, tool-name/argument/result, feedback, error-name/code/message, source/file-content, workspace-path, raw Session ids, private identity material, and ambient trace or span ids never appear in captured OTLP JSON, while the canonical Session log retains its original content.

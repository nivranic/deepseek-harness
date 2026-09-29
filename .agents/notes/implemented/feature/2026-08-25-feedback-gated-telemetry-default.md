# Agent Note: Feedback-gated session-telemetry mode

Status: implemented

English | [中文](2026-08-25-feedback-gated-telemetry-default.zh.md)

## Problem

Diagnosing a `/feedback` report needs the session data the report describes. With the shared base resolving an unset `DSH_TELEMETRY_MODE` to `DISABLED`, a default installation's feedback reached its receiver with no session data at all, and the reporter had no way to grant access at the moment they asked for help; only deployments that had exported `DSH_TELEMETRY_MODE` beforehand ever delivered a diagnosable report.

## Decision

`FEEDBACK_ONLY` is an explicit `DSH_TELEMETRY_MODE`: nothing is uploaded before the user records `/feedback`, and each recorded feedback releases the not-yet-shared privacy-safe diagnostic prefix through that exact event. A resumed session shares only its current lifecycle. The [privacy-safe telemetry decision](../architecture/2026-09-02-privacy-safe-session-telemetry.md) supersedes feedback-triggered sharing as the shipped default; the shared base and omitted plugin mode resolve to `DISABLED`, while any non-empty `DSH_TELEMETRY_DISABLED` remains the authoritative pre-load hard opt-out.

The [default-mount decision](2026-07-31-web-telemetry-default-mount.md) continues to own the endpoint, batching cadence, and exit-drain settings. The feedback action is a trigger only after a deployment explicitly selects this mode; it is not sufficient transport consent by itself.

## Alternatives considered

**Keep `DISABLED` and instruct reporters to re-run with `DSH_TELEMETRY_MODE=FEEDBACK_ONLY`.** Rejected: the session that exhibited the problem is the one worth uploading, and re-running loses it.

**Default to `FULL`.** Rejected: continuous export without any user action is exactly what the default-off decision forbids, and nothing in a fresh installation authorizes it.

**Gate the official DeepSeek `dsh_session_log` request contribution on feedback instead of reviving the OTel default.** Not taken here: that contribution uploads through subsequent LLM requests rather than at the feedback boundary, so a session's final feedback would never be delivered; a feedback-triggered flush on that path is a larger design than a default flip.

## Consequences

- A fresh installation uploads nothing; an explicit `FEEDBACK_ONLY` deployment releases only prefixes ending at canonical feedback records.
- Released records contain the mandatory privacy projection, not Session payloads or workspace paths; the feedback text itself stays local.
- The `/feedback` acknowledgement discloses the selected policy but never claims delivery.

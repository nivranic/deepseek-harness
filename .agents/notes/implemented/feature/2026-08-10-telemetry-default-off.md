# Agent Note: SessionTelemetryBackend requires explicit opt-in

Status: implemented

English | [中文](2026-08-10-telemetry-default-off.zh.md)

## Problem

DeepSeek Harness originally had two outbound telemetry feeds. During internal testing, the shared base mounted telemetry with a baked-in production endpoint, and both feeds reported by default to help diagnose reported problems: the session OTel backend could export complete session content, tool data, prompts, and workspace paths when its mode was omitted, while the dsh-sdk launcher feed did so unconditionally. A fresh installation therefore permitted outbound reporting without a positive deployment choice.

## Decision

The session feed uses `DSH_TELEMETRY_MODE` as its positive consent setting. Unset and empty values resolve to `DISABLED` in both the shared base and direct construction, which creates no OTel provider, processor, or exporter and leaves feedback local. A deployment opts into privacy-safe diagnostics through `FULL` or `FEEDBACK_ONLY`. Any non-empty `DSH_TELEMETRY_DISABLED` remains the authoritative pre-load hard opt-out. The [privacy-safe telemetry decision](../architecture/2026-09-02-privacy-safe-session-telemetry.md) owns data minimization, while the [default-mount decision](2026-07-31-web-telemetry-default-mount.md) owns the endpoint, batching cadence, and exit-drain settings.

The [CLI reference README](../../../../apps/cli/reference/README.md) documents the current deployment stance: the shared base defaults to `DISABLED`, explicit uploading modes send only the privacy inventory's diagnostics whose body carries no value or content, and the hard opt-out wins. The product presents no prompt that can enable upload; deployment configuration is the only positive consent path.

## Alternatives considered

**Keep opt-out defaults and improve disclosure.** Rejected because disclosure does not make a missing configuration a positive authorization to send even bounded diagnostics.

**Default session telemetry to `FEEDBACK_ONLY`.** Rejected because recording feedback would still trigger an upload without a deployment explicitly enabling outbound reporting. The default must keep both the session and its feedback local.

**Add another consent marker.** Rejected because `DSH_TELEMETRY_MODE` already owns Session telemetry consent; another configuration entry would create conflicting settings.

**Remove Session telemetry.** Rejected because internal deployments still need explicit `FULL` and feedback-gated reporting.

## Consequences

Fresh profiles make no telemetry network request. Uploading modes require an explicit setting, retain endpoint validation, batching, and shutdown behavior, and receive only the mandatory privacy projection. The existing hard opt-out remains effective.

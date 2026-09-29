# Agent Note: Default session-telemetry mount (OTel reporting) in the dsh web composition

Status: implemented

English | [中文](2026-07-31-web-telemetry-default-mount.zh.md)

## Problem

The telemetry seam and OTel backend ([revival Note](2026-07-23-session-telemetry-otel-revival.md)) had never been wired into any deployment composition since completion: no roster row, no switch, no cadence ruling, and zero observability over user sessions for the internal deployment. A deployment decision was needed: which surfaces report, to where, on what cadence, how to opt out, and how CI stays isolated.

## Decision

The shared dsh base bundle (`packages/bundle/base/cordis.patch.yml`) mounts the `session-telemetry-otel` row with a production endpoint, so every base-backed profile has one consistent telemetry capability. The standalone [`sdk-minimal` profile](../architecture/2026-08-24-standalone-sdk-minimal-profile.md) deliberately omits that row. The row defaults to `DISABLED`; only explicit `FULL` or `FEEDBACK_ONLY` authorizes reporting. Web and headless use the [bounded, escalating process-shutdown controller](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md) on SIGINT/SIGTERM, giving an enabled backend's three-second shutdown deadline time to drain before the five-second launcher bound.

| Ruling | Value | Rationale |
|---|---|---|
| Mount surface | `packages/bundle/base/cordis.patch.yml` | One capability row for every profile that loads the shared base |
| Sharing mode | `DSH_TELEMETRY_MODE`, default `DISABLED`; explicit `FULL` or `FEEDBACK_ONLY` opts in | A fresh profile uploads nothing, while configured deployments retain live and feedback-triggered policies |
| Endpoint | `DSH_TELEMETRY_OTLP_URL`, default `https://harness-telemetry.deepseeksvc.com/v1/logs` | Internal collector; the env override serves local/dev runs |
| Hard opt-out | any non-empty `DSH_TELEMETRY_DISABLED` (including `0`/`false`) disables the row | The launcher patch takes effect before load-time transport validation and overrides every configured mode |
| Cadence | `processor.scheduledDelayMillis: 10000` (10s/batch) in uploading modes | Streaming while the session runs, never exit-time-only; a crash loses at most the last unexported interval |
| Exit-drain bound | `exporter.timeoutMillis: 1000` + `maxExportBatchSize: 2048` (== maxQueueSize) + `exportTimeoutMillis: 1500` + `shutdownTimeoutMillis: 3000` | Ordinary unreachable-collector failure releases in ~1s: timeoutMillis is the per-attempt socket timeout and retry deadline, while one queue-sized batch avoids sequential drain multiplication. The DSH-owned 3s outer bound covers the SDK's preceding unbounded `forceFlush()` wait when the transport Promise never obtains a socket. |
| Compression | `compression: gzip` | Contentless-body OTLP records still repeat fixed record and attribute keys; compression reduces cross-datacenter payload size |
| CI isolation | top-level `env: DSH_TELEMETRY_DISABLED: '1'` in GitHub workflows | Defense in depth keeps test sessions local even when a job explicitly selects an uploading mode |

The base bundle test pins the shipped `DISABLED` default expression, the backend suite pins that omitted mode constructs no transport, and the real Loader composition suite explicitly selects each uploading mode when it verifies OTLP delivery.

## Alternatives considered

**No default mount; deployments add the row themselves.** Rejected because the mounted `DISABLED` mode retains a local feedback warning and gives every base-backed profile one patch target without authorizing any upload.

**A config field instead of an env patch for the switch.** Infeasible: cordis rows have no config-level disable semantic, and `exporter.url` validation fails loud at plugin construction, so the switch must take effect before the Loader — AppCLIEntry's patch layer is the only seat.

**A `Promise.race` timeout backstop around exit.** Originally deferred because the SDK parameters appeared to bound the backend's drain to ~1.5-3s (typically <100ms), with measured SIGINT-to-exit of 110ms-1.1s. A Linux sandbox reproduction later proved that `BatchLogRecordProcessor.shutdown()` can wait forever in `exporter.forceFlush()` before reaching its `exportTimeoutMillis`-bounded completion Promise. The [CLI shutdown fix](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md) therefore adds both a three-second backend bound for that specific gap and a five-second process-level bound plus repeated-signal escape for the whole plugin tree.

## Consequences

- A developer running `dsh web` without telemetry configuration makes no telemetry network request, including after recording `/feedback`. An internal deployment sets `DSH_TELEMETRY_MODE` and may point `DSH_TELEMETRY_OTLP_URL` at another collector.
- **The mandatory privacy projection lives in the capture owner**: explicitly enabled exports contain diagnostics whose body carries no value or content and HMAC-pseudonymous Session correlation; Session content and workspace paths never reach the backend. Deployments may use `session-telemetry/record` only to reduce the safe record further. The [privacy-safe telemetry decision](../architecture/2026-09-02-privacy-safe-session-telemetry.md) owns the inventory, and the anonymous user id ships through the [anonymous-user-id Note](2026-07-31-telemetry-anonymous-user-id.md).
- Test rigs remain local by default; explicit uploading-mode tests provide their own collector and mode.

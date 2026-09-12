---
description: "OpenTelemetry session-telemetry backend for deployments choosing a mode, configuring the exporter, or tracing what leaves the machine."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-telemetry-otel

English | [中文](README.zh.md)

## Summary

`dsh-session-telemetry-otel` delivers privacy-safe diagnostics through OpenTelemetry logs and is the only entry a deployment loads for the [session-telemetry seam](../session-telemetry/README.md). Its `mode` decides whether records follow the live stream, are released only at recorded feedback, or stay local: `FULL` hands every record to OTel immediately, `FEEDBACK_ONLY` replays a canonical-log prefix when `feedback/record` lands, and `DISABLED` constructs no capture or reporting pipeline and shares nothing. Uploading modes compose the OTel JS SDK as-is and map each record onto `logger.emit()`, so batching, retry, queueing, and loss policy follow the SDK. The owner-level projection excludes Session payloads and workspace paths before this backend sees a record.

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

Mount this plugin when a deployment should export privacy-safe Session diagnostics through OpenTelemetry logs. Choose an explicit uploading mode and give the exporter an endpoint; omitted mode stays local.

### Modes

| `mode` | Behavior |
|---|---|
| `FULL` | Every projected record, including lifecycle ops records, is handed to the OTel SDK immediately |
| `FEEDBACK_ONLY` | Each `feedback/record` replays, projects, and redacts the canonical session-log suffix through that event; later records wait for another feedback event and remain local if none arrives |
| `DISABLED` | Default. No coordinator, provider, processor, or exporter is constructed; no telemetry record leaves the process, and a `feedback/record` logs that nothing will be shared |

Programmatic TypeScript configuration uses the exported `SessionTelemetryMode` enum; raw string literals are not assignable. The mounted service discloses the resolved mode through the seam's [`SessionTelemetrySharingStatus`](../session-telemetry/README.md#the-sharing-disclosure) `sharing` property (`full` / `feedback-only` / `disabled`), so the `/feedback` acknowledgement reports whether and how the session is shared — even `DISABLED` discloses `disabled`.

### Minimal configuration

Uploading modes require an exporter URL and accept the SDK option blocks verbatim:

```yaml
- id: sessionTelemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config:
    mode: FULL                # explicit opt-in; default: DISABLED
    shutdownTimeoutMillis: 3000 # optional; defaults to 3000
    exporter:                # passed verbatim to the SDK's OTLP/HTTP log exporter
      url: https://collector.example.com/v1/logs
      headers:
        authorization: !!js `Bearer ${process.env.OTLP_TOKEN}`
    processor: {}            # optional; passed verbatim to BatchLogRecordProcessor
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `DISABLED` | Sharing policy: `FULL`, `FEEDBACK_ONLY`, or `DISABLED` |
| `exporter.url` | required in uploading modes | Full OTLP logs endpoint; must parse as `http(s)` |
| `exporter`, `processor` | — | Passed verbatim to the SDK exporter and batch processor |
| `shutdownTimeoutMillis` | `3,000` | Outer deadline for the SDK's complete shutdown sequence |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-telemetry-otel) is the exhaustive source for every accepted field. Upload authorization is positive and fail-closed: the shipped base and direct construction default to `DISABLED`, an unknown mode fails before transport configuration is read, and `FEEDBACK_ONLY` reacts only to the exact `feedback/record` object already stored in the canonical log. `ctx.sessionTelemetry` has no public emit or shutdown operation.

### What leaves the machine

Uploading modes send event time/type/sequence, severity, bounded turn/step/outcome fields, tool error state, a fixed error class, and lifecycle operation. The Resource sends product name/version, `os.type`, `host.arch`, and the derived harness-home anonymous `user.id`. The anonymous-identity owner converts raw Session and parent Session ids to stable HMAC-SHA-256 pseudonyms before the reduction waterfall or this backend sees them; its private root and Session key never leave that package. Every SDK record uses `ROOT_CONTEXT`, so an ambient span cannot add trace or span correlation. The log body carries no value or content, although the OTLP JSON encoder may serialize an empty `body: {}` object. Message content, reasoning, system prompts/tool schemas, model-produced tool names, tool arguments/results, feedback text, arbitrary error names/codes/messages, workspace paths, source code, file contents, trace ids, span ids, and trace flags never reach the exporter. The authoritative [privacy inventory](../../../docs/subsystems/session-telemetry.md#privacy-inventory) accounts for DSH-controlled content-bearing values, Resource and record attributes, and static instrumentation-scope metadata.

### Failures and shutdown

Misconfiguration fails at plugin load: a missing or non-`http(s)` `exporter.url`, a non-positive-integer `processor.maxExportBatchSize` (which the SDK accepts but then hangs on at shutdown), and an invalid `shutdownTimeoutMillis` all reject before any record is exported. During shutdown, OTel awaits `exporter.forceFlush()` before the processor's bounded completion promise; if that transport promise never settles, this package abandons the wait at `shutdownTimeoutMillis`, logs the contained failure, and lets application teardown continue — records still pending then may be lost at process exit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the backend's composition; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The backend is a thin adapter over the OTel JS SDK: it owns capture mode, publication of the derived Resource identity, and an outer shutdown deadline. The anonymous-identity package owns the private root and Session-id pseudonymization; the capture coordinator hands this backend already-pseudonymous identifiers. The static `@deepseek-ai/dsh-session-telemetry-otel` and `@deepseek-ai/dsh-session-telemetry-otel/ops` instrumentation scopes separate ledger and operational records; both carry the package-manifest version. Resource identity carries `service.name`/`service.version`, `os.type`, `host.arch`, and the derived anonymous `user.id`, once per export batch rather than per record.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: mode resolution, fail-closed validation, SDK pipeline wiring, coordinator composition, shutdown deadline |

### Capture wiring

`FULL` composes the coordinator in `live` mode; `FEEDBACK_ONLY` composes it in `on-demand` mode and triggers `captureSession(session, event.seq)` only for the exact canonical feedback record; `DISABLED` registers only a local-feedback warning. The coordinator receives a private sink, while `ctx.sessionTelemetry` exposes only `sharing`. The backend deliberately implements no `flush()` because the batch processor owns ordinary flushing.

### Field mapping

Each seam record maps onto one SDK log record whose body carries no value or content: `time` and `severity` become SDK fields, the already-pseudonymous privacy-safe attributes carry through unchanged, and an explicit `ROOT_CONTEXT` prevents implicit trace-context inheritance. The OTLP JSON encoder may represent that absence as an empty object. In `FULL`, receivers can detect crashes by `shutdown`-record absence; in `FEEDBACK_ONLY`, a released prefix normally has no later marker, so absence is not a crash signal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the backend contract is not enough. They move from the seam it implements to the subsystem reference and the identity it reports.

- [Session telemetry seam](../session-telemetry/README.md) — the capture contract, record vocabulary, and redaction waterfall.
- [Session telemetry subsystem](../../../docs/subsystems/session-telemetry.md) — the capability split and type declarations.
- [Anonymous user identity](../../identity/anonymous-user-id/README.md) — the id reported as the OTel Resource `user.id`.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-telemetry-otel) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the backend forwards seam records into the OTel SDK pipeline and registers nothing model-facing.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where SDK behavior governs and where export guarantees end. They are current package constraints.

- **Upstream experimental tree** — `@opentelemetry/sdk-logs` is published from the upstream experimental tree; SDK API churn lands here and only here, while the seam contract does not move.
- **Live-collector behavior belongs to the SDK exporter** — authentication, TLS, throttling, and other real OTLP deployment behavior follow the upstream SDK rather than a package-owned compatibility layer.
- **Feedback-time snapshot** — `FEEDBACK_ONLY` retains no telemetry-owned copy before feedback; it reads and redacts the current canonical log when feedback is recorded, so a crash before feedback uploads nothing and policy changes before feedback affect what that replay exports.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

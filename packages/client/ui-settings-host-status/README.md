---
description: "§41 Host readiness section in Web Settings for the dsh web client: the derived accept-Agent-requests verdict plus one row per health component (process, runtime, session store, plugin state, connection, model provider), read from hostDiagnostics/health."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-host-status

English | [中文](README.zh.md)

## Summary

The **Host status** section shows Web users whether this Host can currently accept Agent requests, and why: the verdict line carries the Host's own derived readiness, and one row per §41 health component — process, runtime, session store, plugin state, connection, model provider — shows that component's up/degraded/down state with the non-secret probe detail naming what was checked. The section registers unconditionally (hostDiagnostics is composed by every Settings-face Host) and owns its failure rendering: a refused read shows the error line with retry, not a missing nav entry.

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

Open Web Settings and pick **Host status**. The page reads one `hostDiagnostics/health` snapshot on entry and renders it top-down: the verdict line first (`data-host-ready`), then the six component rows. Each row is the component name, a state dot (green for up, amber for degraded, red for down), and the component's own `detail` string verbatim — the detail names the probed service or proof (for example `pid 1234` or `no model provider is registered`) and never carries configuration values.

The verdict is the snapshot's `ready` field as the Host derived it; the section never re-derives readiness client-side. The connection component is deliberately outside that derivation: a Host without a network carrier (CLI, desktop pipe) is a legitimate deployment, so a down connection row beside a ready verdict is correct, not a contradiction.

A refused read replaces the page with the error line and a retry button; retry re-issues the read and the section recovers on the next successful snapshot.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Registration

The plugin registers one `settings.section` contribution (`id: 'host-status'`, order 16, between Hosts and Telemetry). Registration is unconditional: the section's data plane is `ctx.remote.hostDiagnostics` — the one Remote namespace every Settings-face Host composes — so there is no capability to watch; a Host that cannot answer `health` surfaces through the section's error state instead of a withdrawn nav row.

### Data plane

The injected face is one function, `health(): Promise<HealthSnapshot>`. The registration-side adapter unwraps the generated client's `RemoteResult`: `ok: true` resolves to the snapshot, `ok: false` rejects with the remote failure so the component's error state owns every refusal shape (unpaired, unadvertised, timeout, wire error) in one place. The component tracks one `loading | ready | error` view state with a request counter for retry, the same pattern as the plugin-inventory tab.

### Rendering

The display list `HOST_STATUS_COMPONENTS` and the dictionary key set both derive from `keyof HealthSnapshot` minus `ready`, so a component added or renamed on the Host side fails this package's build until the row and its copy follow. The `ComponentHealth` tri-state maps to StateDot as `up → done`, `degraded → warning`, `down → error`: `ongoing` is the animated running ring reserved for live transitions, and §41 `degraded` is a settled partial failure, so the amber `warning` dot is the nearest legal value. Each row also carries `data-component` and `data-component-state` attributes for tests.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings domain, the §41 vocabulary this section renders, and the Remote seam it rides.

- [ui-settings](../ui-settings/README.md) — the domain base declaring the `settings.section` slot this package registers into.
- [host-diagnostics](../../api/host-diagnostics/README.md) — the Host-side owner of the six-component vocabulary and the derived readiness verdict.
- [remotes](../../api/remotes/README.md) — the Client-side Remote aggregation that mounts the `hostDiagnostics` namespace.
- [ui-settings-telemetry](../ui-settings-telemetry/README.md) — the sibling section whose registration pattern this package follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the reach of the readiness surface; they are current package constraints.

- **No live refresh** — the section reads one snapshot on entry and re-reads only through the retry button; it subscribes to no forwarded event, so a Host that degrades while the page is open keeps showing the last read snapshot until the user retries.
- **The verdict is not re-derived client-side** — the rows show each component's state, but the verdict line is the Host's own `ready` field; a client-side re-derivation of readiness from the rows is deliberately absent so the two can never disagree.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Cross-lane contract: the `hostDiagnostics` Remote namespace reaches the Client only through the `dsh-api-remotes` aggregation — the aggregation both `$mount`s the contribution and re-exports its declaration merge (`export type {} from '@deepseek-ai/dsh-api-host-diagnostics/remote'`), which is what makes `ctx.remote.hostDiagnostics.health()` type-check in consumer programs. The generated client answers `RemoteResult<HealthSnapshot>`; the adapter's unwrap is the only place that shape is known.

</details>

**Runtime invariant:** No companion is published. This package projects one `hostDiagnostics/health` snapshot per page entry through the injected Remote face; it maintains no independent durable authority.

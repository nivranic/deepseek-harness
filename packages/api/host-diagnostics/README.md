---
description: "Host-diagnostics seam: section 41 health/readiness snapshot and the section 42 sanitized cross-platform diagnostics payload."
kind: "package-reference"
---
# @deepseek-ai/dsh-api-host-diagnostics

English | [中文](README.zh.md)

## Summary

One Typert Remote owner (`ctx.hostDiagnostics`, capability `host.diagnostics.v1`, permission `view`) for the diagnostics slice. `health()` answers the section 41 liveness/readiness distinction: six components — process, runtime, sessionStore, pluginState, connection, modelProvider — each with a state and a detail naming the probed service, plus the derived `ready` verdict (connection is excluded: a carrier-less profile is still a Host). `describe()` composes the section 42 payload — descriptor facts, plugin inventory rows, the released migration chain, and the health snapshot — sanitized by construction, the field set enumerates non-secret facts only — no API key, bearer, pairing secret, or raw credential can reach it.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package answers health and diagnostics reads and registers no prompt, tool, or session event.

#### KV Cache effect

None; health and diagnostics reads do not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Health is presence-based** — a `down` names the missing owning service; component probes that can see partial failure (`degraded`) and a crash/last-error recorder seam remain open with the support-bundle increment (§43).
- **No client surface yet** — the payload's consumers (settings, support collection) land with their increments; the seam and its wire are the contract.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The probes are `ctx.get()` lookups over optionally composed services: `sessionPersistence`, `loader`, `llm`, `webServer`, `pluginInventory` (§42 rows), and `hostDescription` (descriptor facts; a missing owner fails `describe` loud with `gateway/service-unavailable`). The migration table is the static released chain imported from the session-format packages — no build-time introspection to keep in sync.

</details>

**Runtime invariant:** No companion is published. The Remote owner self-registers when the plugin applies.

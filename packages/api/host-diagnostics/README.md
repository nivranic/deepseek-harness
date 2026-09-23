---
description: "Host-diagnostics seam: section 41 health/readiness snapshot and the section 42 sanitized cross-platform diagnostics payload."
kind: "package-reference"
---
# @deepseek-ai/dsh-api-host-diagnostics

English | [中文](README.zh.md)

## Summary

One Typert Remote owner (`ctx.hostDiagnostics`, capability `host.diagnostics.v1`, permission `view`) owns the diagnostics slice. `health()` answers the section 41 liveness/readiness distinction: six components (process, runtime, sessionStore, pluginState, connection, modelProvider), each with a state and a detail naming the probed service, plus the `ready` verdict — connection excluded: a carrier-less profile is still a Host. `describe()` composes the section 42 payload — descriptor facts, plugin inventory rows, the migration chain, recorded crash and last-error facts, and the health snapshot — sanitized by construction: only non-secret facts are enumerated, so no API key, bearer, pairing secret, or raw credential can reach it.

## Table of Contents

- [Support Bundle](#support-bundle)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Support Bundle

`supportBundle()` produces the section 43 artifact: sanitized entries (a recursive secret-shape scan at any depth refuses api-key/bearer/secret/password/credential keys), a per-entry SHA-256 manifest over canonical key-sorted serialization, a chained checksum over the ordered manifest rows, and collector validation that recomputes every digest and fails loud on tampering — input order never leaks, so four platforms running the same candidate produce byte-identical bundles. The artifact's content entries: the §42 diagnostics snapshot; `session-headers.json` — when a session store is composed and holds at least one session — one row per stored session (header facts and store counts, never event content), sorted by id; and `settings-export.json` — when the settings seam is composed and registers namespaces — one row per namespace with the seam-stripped resolved value (`redactSecrets`), sorted by namespace.

## Model Experience

None, as this package answers health and diagnostics reads and registers no prompt, tool, or session event.

#### KV Cache effect

None; health and diagnostics reads do not alter a model request.


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Degraded probes cover partial failure where a signal exists** — failed plugin fibers and a provider-less LLM owner degrade; components without a partial-failure signal (sessionStore, connection) stay presence-based.
- **Crash and last-error recording is always on** — a pid-safe boot marker under `$DSH_HOME` turns an unclean previous shutdown into a durable capped crash log, and the agent error relay fills a process-local capped ring; facts carry identity and text only.
- **No client surface yet** — the payload's consumers (settings, support collection) land with their increments; the seam and its wire are the contract.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The probes are `ctx.get()` lookups over optionally composed services: `sessionPersistence`, `loader`, `llm`, `webServer`, `pluginInventory` (§42 rows), and `hostDescription` (descriptor facts; a missing owner fails `describe` loud with `gateway/service-unavailable`). The migration table is the static released chain imported from the session-format packages — no build-time introspection to keep in sync.

</details>

**Runtime invariant:** No companion is published. The Remote owner self-registers when the plugin applies.

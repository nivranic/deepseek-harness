---
description: "Per-kind telemetry consent section in Web Settings for the dsh web client: five independent switches (session telemetry, provider metadata, relay metadata, Device Trust metadata, crash diagnostics), no master switch, writes through the settings scope."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-telemetry

English | [中文](README.zh.md)

## Summary

The **Telemetry** section lets Web users decide, per data category, what this Host may share: session telemetry, provider metadata, relay metadata, Device Trust metadata, and crash diagnostics each get their own switch, defaulting to off. There is deliberately no master switch. The section appears only while the Host registers the telemetry-consent settings namespace, shows when changes take effect, writes through the settings scope's revision-fenced path, and reports a write that did not take by following the re-read Host value.

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

The section registers only while the Host settings document exposes the `telemetry-consent` namespace (the telemetry backend's Host-side registration; see the Dev Note for the field contract). When the namespace is absent — no telemetry backend composed, or a non-loopback page whose settings stay process-local — the section does not render at all.

Each of the five data categories renders as its own row: category name, one-sentence description of what that category covers, and one switch. Flipping a switch queues exactly that field's write; nothing else moves, and no control anywhere flips more than one category. Switch positions derive only from the Host answer, never from the click: a write the Host refused (including a revision conflict from a concurrent change) leaves the switch where the re-read Host value stands, and the row says the change did not take.

### What each category covers

- **Session telemetry** — session records mirrored from the session log, shared through the configured reporting backend.
- **Provider metadata** — which LLM provider and model each request used.
- **Relay metadata** — how requests were relayed between the Client and the Host.
- **Device Trust metadata** — paired-device identity facts, such as device names and key fingerprints.
- **Crash diagnostics** — diagnostic records produced when the application crashes.

### When changes take effect

The section carries one line stating that changes take effect after the application restarts, following the `applies` mode the Host registered for the namespace. A Host that registers the namespace as live suppresses the line.

### Read-only documents

When the settings provider does not accept writes, every switch is disabled with the reason as its hover text; the section still shows the five stored values.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section is a projection over the settings describe mirror plus one bound settings scope; it owns no consent state.

### Registration

The plugin binds one `telemetry-consent` scope through `ctx.settingsScope` and watches the shared describe mirror. Registration exists exactly while the mirror's view contains the namespace: absent namespace means no nav row; a change of the namespace's `applies` mode re-registers the section so the hint line follows the Host's own declaration.

### Reads and writes

Values, revision, and writability come from the bound scope, which derives from the same mirror snapshot as the registration gate, so the two can never disagree. Writes go through `scope.set(kind, value)`: the scope carries the latest namespace revision as the fence, serializes rapid gestures, folds the write answer into the mirror, and reloads Host state when a write is refused — which is exactly how a conflict surfaces here as a re-read value rather than an error string.

### Rendering

Each row is one `TelemetryDataKind`. The display list and the dictionary keys both derive from the same union imported from `dsh-session-telemetry`, so a kind added or renamed there fails this package's build until the row and its copy follow. Local gesture state tracks which kind's write is in flight and which row's last write did not take; both live in component state and reset with the section.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings domain, the consent vocabulary, and the telemetry seam this section configures.

- [ui-settings](../ui-settings/README.md) — the domain base providing the settings scope and declaring `settings.section`.
- [ui-settings-devices](../ui-settings-devices/README.md) — the sibling section template this package follows.
- [settings](../../settings/settings/README.md) — the Host-side settings seam whose namespace views this section reads.
- [session-telemetry](../../session/session-telemetry/README.md) — the Service Definition owning the five-kind consent vocabulary.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the reach of the consent surface; they are current package constraints.

- **Deployment consent stays outside this section** — the switches persist the user settings document; whether a deployment actually ships each category is its telemetry backend's composition, and this section neither detects nor describes that.
- **No per-kind effective-state explanation** — the rows show the stored switch, not a resolved view of what the running backend currently exports; live enforcement state belongs to the backend seam.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Cross-lane contract: the Host telemetry backend registers the settings namespace `telemetry-consent` with five boolean fields named exactly by the `TelemetryDataKind` literals (`sessionTelemetry`, `providerMetadata`, `relayMetadata`, `deviceTrustMetadata`, `crashDiagnostics`), all defaulting to off, `applies: 'restart'`. This package reads that namespace by name; no shared constant module exists because the client-side reach is type-only.

Gestures deliberately do not pass `expectedRevision`: the scope's `set` fences with the latest mirrored revision and serializes queued writes, so pinning each click to its render-time revision would turn any two quick toggles into a spurious conflict. The conflict path surfaces as the scope's documented recovery re-read, which the rows report by comparing the settled gesture against the re-read value.

</details>

**Runtime invariant:** No companion is published. This package projects the shared settings mirror's `telemetry-consent` namespace and routes writes through the settings scope; it maintains no independent durable authority.

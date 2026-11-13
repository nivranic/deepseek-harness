---
description: "Five independent telemetry consent controls over the Host backend's configuration."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-telemetry

English | [中文](README.zh.md)

## Summary

The **Telemetry** section lets Web users edit five independent consent fields: session telemetry, provider metadata, relay metadata, Device Trust metadata, and crash diagnostics. There is no master switch. Values come from the Host configuration; refused writes retain the Host value and show a notice on the affected row. The section appears while the Host exposes the shipped telemetry backend's settings entry.

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

Open **Telemetry** in Settings. The Host must expose the `session-telemetry-otel` Loader entry; when it does not, the section has no navigation row. Each category has one switch, and each click writes only that category under the entry's `consent` field.

Switch positions follow accepted Host configuration. The UI does not move a switch optimistically. A refused or failed write leaves the accepted value visible and reports that the change could not be saved. Read-only documents disable every switch.

### Data categories

- **Session telemetry** — session records eligible for the backend's feedback-authorized export.
- **Provider metadata** — provider and model identity.
- **Relay metadata** — request relay information.
- **Device Trust metadata** — paired-device identity facts.
- **Crash diagnostics** — application failure records.

The switches store consent, not a promise that a backend exports that category. The shipped OTel backend currently exports only feedback-authorized Session records; the other fields do not create additional export channels.

### Applying changes

Writes update the backend's live consent reference through the Host configuration editor. No restart is required. Withdrawing consent stops new feedback captures; batches authorized before withdrawal may finish sending.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin consumes `ctx.configForms`, the shared settings describe mirror and serialized write queue. `whileServed` owns section registration and removes it when the backend entry disappears or the plugin unloads.

The form reads the backend's editable consent fields. A gesture submits one path operation at `['consent', kind]`, preserving other consent fields and backend options. The shared form carries the current revision, folds accepted answers into the mirror, and refreshes Host state after refusal.

The renderer binds the form as `useConsent`. The component reads only that snapshot; its local state records in-flight gestures and failed writes. It never keeps a second copy of the saved consent values.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — shared configuration forms and Settings slots.
- [settings](../../settings/settings/README.md) — Host configuration updates and revisions.
- [session-telemetry](../../session/session-telemetry/README.md) — consent data kinds.
- [session-telemetry-otel](../../session/session-telemetry-otel/README.md) — the shipped backend's export policy.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser package registers no model-facing behavior.

#### KV Cache effect

None; this package neither assembles nor sends a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The section targets the shipped `session-telemetry-otel` entry id. A differently named backend entry uses its own configuration editor.
- Consent fields do not describe effective exporter state. Backend composition and upload policy still decide which consented data can leave the Host.

<a id="dev-note"></a>
### Dev Note

None.

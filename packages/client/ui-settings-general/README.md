---
description: "Settings shell, ownerless copy, and durable product-onboarding namespace for the dsh web client: the General section, trigger chrome, and onboarding ledger projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

## Summary

Use this package to give the dsh web client a Settings panel, connection-recovery control, feature-contributed navigation, and sequential first-run onboarding. Users can open it from the sidebar, retry a failed connection immediately, and access a local configuration file when the Host makes one available on a loopback browser. Feature packages supply their own settings rows, sections, and onboarding steps; this package supplies their shared presentation and does not add onboarding copy or built-in General rows.

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

The document action additionally requires `settings.document-open.v1` and current-generation metadata from the shared Settings mirror. Withdrawal hides it, retained callbacks cannot open a replacement Host’s document, and an old native-open result cannot change the new generation’s action state. Restoring support and metadata restores the entry without opening anything automatically.

Users reach the shell through the sidebar's bottom Settings control; feature plugins contribute their pages and onboarding steps through the slot ledgers this shell projects. In both the expanded sidebar and collapsed rail, the control exposes the localized Settings label as its accessible name. A pale-yellow **Offline** action beside Settings indicates browser offline suspension. Automatic recovery shows **Reconnecting** with one to three dots advancing every 500ms. Hover or keyboard focus changes either yellow label to **Reconnect now** without changing its background; press feedback stays within the warning palette, and selecting it starts retry 1 immediately. Recovery changes the region to pale-green **Connected** for two seconds before it disappears. The first handshake starts with **Connecting** and checks Host access as **Authenticating**; replacement attempts show **Reconnecting** or **Authenticating** according to their current operation. Every state remains available as an accessible compact indicator in the collapsed rail. Each indicator reserves enough width for its hover action; its icon, text origin and height remain stable. Uninterrupted ready operation becomes silent after the confirmation. The shell renders the modal panel, the navigation built from `settings.section` entries, and exactly one mounted onboarding step at a time.

Connection failures show **Update required** for incompatible protocols or required discovery capabilities, and **Host data unavailable** for invalid or unavailable discovery or stream data. Their localized tooltip and accessible name explain the corrective action before manual reconnect. These failures remain visible in the collapsed rail; automatic attempts are suspended by Connection.

Rejected browser authentication displays **Not authenticated** with instructions to reopen the Host using its current launch link and reconnect. The action also remains available as an accessible icon in the collapsed rail. The UI neither displays credentials nor silently retries the failed message.

A delayed ready frame displays **Waiting for Host** with progress dots and explains that waiting and automatic retry remain active. Manual reconnect is available, including as an accessible icon in the collapsed rail. A later ready frame replaces the delay with the normal recovery confirmation.

### The General section

The General section holds rows registered into `settings.general.item` by feature packages — it has no built-in rows. Feature plugins own the row copy and behavior; the shell only provides the section and its slot. The Appearance row, for example, lives in ui-theme.

### Opening the configuration file

On a loopback browser, the shell renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action opens that document in the native text editor (bypassing the browser file association on macOS). Remote browsers never register the action and never issue the privileged settings read.

### Onboarding steps

The onboarding ledger projects in ascending order and mounts exactly one step at a time. Registrants own durable completion, capability readiness, copy, mutations, and their visible wrapper, so independently registered flows cannot stack and the shell does not become a second configuration fact source. Visible steps own their dialog chrome and app-root `inert` lifecycle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell owns the chrome and the projections; every piece of content and copy belongs to a registrant.

### Ledger projections

The navigation is a projection of the `settings.section` ledger; nav labels may be locale-following thunks, resolved through `resolveSlotLabel` and re-rendered on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order; the active registrant receives its id, `complete()`, and an `openSection(id)` callback, and completing or skipping transfers ownership to the next entry.

### Connection recovery

The shell is an explicit recovery consumer, so it injects Connection directly rather than adding lifecycle controls to `ctx.remote`. Its private hooks compartment binds `ctx.connection.state`, while the component receives only the selected state and an injected callback for `ctx.connection.reconnect()`. `ConnectionIndicator` owns the inline presentation and receives all visible and accessible copy from the `settings` locale namespace; the shell owns the two-second recovered-state timer.

### Document availability

On a loopback page, the Client loads the provider's `hasDocument` capability through `settings/describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action calls the pathless, browser-authenticated `settings/openSettingsDocument` Remote; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Non-loopback pages retain the Client policy that withholds this native action and its settings read.

### Host half

The Host half registers `ui-onboarding` in the user-settings seam. The welcome step contributed by ui-settings-models reads and writes its `welcomeNoticeVersion` through the existing public settings boundary; the shell itself remains policy-free.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings surface family and the composition model.

- [ui-settings](../ui-settings/README.md) — the domain base whose slot types and scope service this shell builds on.
- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the `sidebar.settings` seat.
- [ui-settings-models](../ui-settings-models/README.md) — the feature package contributing the DeepSeek onboarding step.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the ledgers.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell itself provides versus what features must supply; they are current package constraints.

- **The General section has no built-in rows** — each row appears only when its owning feature plugin is mounted; the shell cannot fill the section alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings seam validates and publishes the durable onboarding section, while slot conflicts fail loud in the slot core. The local document action is browser state over typed RPC responses and is covered by store/component tests rather than a Cordis runtime relationship.

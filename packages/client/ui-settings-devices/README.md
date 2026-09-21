---
description: "Paired-device management section in Web Settings for the dsh web client: roster with role, platform and last-seen facts, inline rename, confirmed revoke and revoke-all."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-devices

English | [中文](README.zh.md)

## Summary

The **Devices** section lets Web users manage the devices paired with the Host. It lists every grant with its display name, role, client-declared platform, paired and last-seen times, and key fingerprint; revoked grants stay visible, marked as revoked with no actions. Renaming edits the name inline; revoking one device or every active grant requires an explicit confirmation, and a completed revoke-all reports how many grants it revoked. Failures map through the shared Remote failure classes to localized copy, with the raw diagnostic kept for unclassified codes.

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

The section is registered only while the current connection advertises `device.list.v1`. Connection replacement withdraws the section, aborts its reads and discards row state (rename drafts, open confirmations); restoration mounts a fresh page that reads the current Host lazily, and a late response or retained callback from the previous page cannot update or reach the replacement Host.

Every Remote callback preserves the original `RemoteError`, including codes unknown to this Client. Row and page failures render localized copy selected by [`classifyRemoteFailure`](../../typert/protocol/README.md) — for example `device/admission-expired` reads as an authentication failure while `device/not-found` reads as the addressed grant being gone — and an unclassified code falls back to the raw diagnostic text.

### Managing one device

Open the **Devices** section in Settings. Each row names the device, tags its role, and shows its platform label when the client declared one, the paired time, the last-admission time (or "Never admitted" before the first admission), and the leading 16 hex digits of the key fingerprint. **Rename** opens an inline editor; an empty name is rejected locally without a Host call, and saving trims the name before sending `renameDevice`. **Revoke** asks for an inline confirmation first; a confirmed revoke stops the grant immediately — its open streams are terminated Host-side — and the section re-reads the roster.

### Revoking every device

**Revoke all** appears while at least one active grant exists and asks for its own confirmation. A completed revoke-all reports how many grants it revoked, and the refreshed roster keeps past grants visible as revoked.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section is a projection over the device-trust Remote namespace; it owns no device state and performs no Remote read during plugin activation.

### Registration

The browser plugin registers one localized `settings.section` contribution with id `devices` (nav order 10, between General and Plugins). Registration uses `ctx.slots.inject()`, so it follows late section declaration, redeclaration, locale changes, and teardown without importing the settings shell. The registration re-registers on `connection.generation` changes, gating on the `device.list.v1` capability and swapping to a fresh component identity so React discards the previous Host's row state.

### Remote calls

All four operations go through one guarded `settle` helper: the connection generation is checked before the call and after the await, so a generation change mid-flight (or its transport failure) surfaces as a "connection changed" rejection that never reaches the replacement Host. `formatTime` formats epoch-ms values with `Intl.DateTimeFormat` under the locale service's active locale, so timestamps follow language switches without a component re-render contract.

### Rendering

Rows are keyed by device id; role tags use fixed tones (viewer neutral, collaborator info, controller solid, owner success, revoked warning). Successful row mutations trigger one roster re-read; failures stay on the row. The page owns the revoke-all confirmation, its reported count, and the load/error/empty/refresh states.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings domain, the Remote face, and the Host-side trust seam.

- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.section`.
- [ui-settings-general](../ui-settings-general/README.md) — the sibling General section and settings shell entry points.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface mounting `remote.deviceTrust`.
- [api-device-trust](../../api/device-trust/README.md) — the Host-side pairing, admission, and revocation seam this section manages.
- [connection](../connection/README.md) — the generation contract behind section withdrawal and restoration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the devices view; they are current package constraints.

- **One roster per Settings mount or mutation** — the section does not subscribe to grant changes and does not automatically refetch after reconnect; a revoke performed on another device appears here only after a manual refresh or a local mutation.
- **Pairing issuance is out of scope** — `issuePairing` belongs to an onboarding flow, not a management surface; adding a pairing entry point is deliberate follow-up work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a read-only-except-explicit-revocation Settings contribution.

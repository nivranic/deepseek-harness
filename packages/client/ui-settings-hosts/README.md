---
description: "Saved-Host roster section in Web Settings for the dsh web client: local roster rows with a switch action into the section 28 seam, current selection marking, page-Host return, local renaming, and cross-session selection persistence."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

English | [中文](README.zh.md)

## Summary

The **Hosts** section shows the page’s saved Hosts: presented name (the client’s choice, else the descriptor’s), platform, origin and last-connected time. Same-origin bookmarks support persisted in-page selection; other origins open in their own Host pages and offer no in-page switch. In-page sessions have no routable origin.

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

The section is always available: the roster is local page state, so it registers without any Host capability and survives connection replacement with its rows intact.

### Switching Hosts

Open **Hosts** in Settings. **Switch** on a same-origin row calls `connection.selectSavedHost`; the selected row is marked, and **Back to the page Host** clears the selection and persisted id. **Rename** edits the row’s local name — an empty draft is rejected, saving trims; **Reset name** returns the row to its descriptor facts once a custom name exists. **Forget** removes a bookmark and its persisted selection without disconnecting the active Host. Cross-origin rows offer a separate page link only; use that Host’s current launch link if its page requires authorization. Authorization does not grant the current page cross-origin API access.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

One React section plus its registration; all data is local. The feature imports Connection types only and invokes the injected service for selection, page-Host return, renaming and forgetting; Connection owns selection persistence.

- **The face** — framework selector hooks observe the saved roster and `connection.target`. External selections, renames and removals update the section immediately. Switching uses [`connection.selectSavedHost`](../connection/README.md); an unknown id leaves the connection and persistence unchanged.
- **Persistence** — Connection restores same-origin selections before the carrier starts, clearing unusable persisted selections while retaining bookmarks; the [Connection README](../connection/README.md) owns storage rules.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-client-connection`](../connection/README.md) owns the roster, the retarget seam, and the boot application of the persisted selection.
- The [Gateway stream carrier](../../api/gateway/README.md) builds every physical WebSocket URL from the same selection.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side Host-roster projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Browser storage can be unavailable or full; the live selection remains usable, but a reload may lose the change.
- The local Web carrier does not support in-page cross-origin connections. Native Remote access requires a separate Connection Source with Device Trust.
- No manual roster reordering; sorting stays most-recent-first, and renames never move a row.

No runtime invariant companion is published: this section renders Connection-owned roster and selection state without maintaining an independent Host projection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The section is the section 28 switching surface; the seam and carrier adoption live in `dsh-client-connection` and `dsh-api-gateway` and carry their own records.

</details>

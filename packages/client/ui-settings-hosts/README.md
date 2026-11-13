---
description: "Browser-local Host bookmarks with confirmed current identity, local names, and manual ordering."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

English | [中文](README.zh.md)

## Summary

The **Hosts** section keeps bookmarks for Hosts described to this browser origin. It preserves local names and manual order, marks the current Host only after successful discovery, and opens other Hosts in their own pages. Bookmarks grant no access.

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

Open **Hosts** in Settings. **Rename** saves a trimmed, non-empty local name; **Reset name** restores the Host's display name. **Move up** and **Move down** persist the displayed order. **Forget** removes a bookmark without disconnecting the current Host.

Other HTTP origins offer **Open Host page**, which opens a separate tab. If authorization is required, use that Host's current launch link. This page always uses its own Host connection; there is no in-page transport switch.

Discovery refreshes on each connection generation. A failed or superseded response cannot mark a Host current, and existing bookmarks remain available. Forgetting the current bookmark hides its row until a later successful discovery records it again.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package owns its bookmark store and exposes observations through Slot-bound hooks. Connection supplies generation notifications; generated `host.describe()` supplies identity facts. The newest discovery response may update the store; unloading invalidates pending replies.

The store retains the existing `dsh-saved-hosts.v1` browser-storage format. It preserves custom names and explicit order when refreshing identity facts, validates persisted rows, and drops invalid origins. The obsolete selected-Host key is not read or changed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Connection](../connection/README.md) — the page's transport and connection generations.
- [Host description](../../api/host-description/README.md) — identity and supported operations.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package manages browser-local bookmarks without registering model-facing behavior.

#### KV Cache effect

None; this package neither assembles nor sends a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The roster retains eight bookmarks, ordered by explicit position before connection recency.
- Browser storage is local to an origin and may be unavailable or full; in that case changes remain in memory and may be lost on reload.
- Discovery does not probe bookmarked Hosts. Opening another Host requires its own authorization.

<a id="dev-note"></a>
### Dev Note

None.

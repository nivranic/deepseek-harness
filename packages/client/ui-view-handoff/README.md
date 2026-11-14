---
description: "Web §26 view-location handoff: a Session-header action copying a cross-device link that captures the connected Host, Session, and last Turn anchor, plus the one-shot open of a received link."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-view-handoff

English | [中文](README.zh.md)

## Summary

Continue viewing a Session on another authenticated device by copying a link or scanning its QR code. The link identifies the Host, Session, and last loaded Turn start. The receiving page verifies the Host and reveals that Turn in Chat. Links carry no credentials, grant no access, and do not move the running agent.

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

Mount this plugin in the Web composition (the [`dsh-web-app`](../../bundle/web-app/README.md) bundle carries it); the row takes no config. The Session header grows the share action whenever a Host generation is admitted and the Chat timeline holds at least one Turn anchor.

### What to expect

Clicking the action copies the page link without query parameters and opens an anchored QR dialog. Escape closes the dialog and returns focus to the trigger; clicking outside also closes it. A clipboard refusal leaves the link in the button tooltip. The receiving page consumes the fragment once and waits for authenticated Host discovery. Invalid links, a different Host, unavailable connections, and inaccessible positions produce localized notices. A different Host is rejected before any Session navigation. Changing the connection generation or unloading the plugin cancels pending navigation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [controller](src/client/controller.ts) discovers identity through `host.describe()` for each connection generation and ignores late replies. The plugin owns the v1 payload codec. Receiving retains the Session while loading history, verifies the requested Turn start in the Chat timeline, and submits a one-shot Conversation focus request before workspace navigation takes over retention. The Conversation renderer creates its shared presentation store; requests arriving before mount wait on the exact Session binding. A root overlay reports failures even when the target Session cannot open.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-api-session-controller](../../api/session-controller/README.md) — scoped Session retention and history loading.
- [dsh-client-ui-chat](../ui-chat/README.md) — the Chat target whose timeline provides the anchor.
- [dsh-api-remotes](../../api/remotes/README.md) — authenticated Host discovery.

-----

<a id="model-experience"></a>
## Model Experience

None, as the action and receiver are browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The link carries no transport of its own.** Delivery across devices still needs a channel a person controls; the popover's QR covers the scan-by-camera path, and pasting into chat or mail stays equally valid — the payload is deliberately URL-safe for all of them.
- **The anchor is the last Turn's start.** A session with no completed Turn start has no position worth handing off and shows no action; partial streaming state is not captured.
- **Admission wait is unbounded.** A received link opened before any Host connects stays pending until one does (the fragment is already consumed); a page the person abandons simply never opens it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [view-handoff Agent Note](../../../.agents/notes/implemented/architecture/2026-10-03-view-handoff.md) records the original delivery design. The current codec and receive lifecycle belong to this plugin.

</details>

**Runtime invariant:** Discovery and navigation expire with their owning generation. Link contents never authorize access to a Host or Session.

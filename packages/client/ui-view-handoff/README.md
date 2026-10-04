---
description: "Web §26 view-location handoff: a Session-header action copying a cross-device link that captures the connected Host, Session, and last Turn anchor, plus the one-shot open of a received link."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-view-handoff

English | [中文](README.zh.md)

## Summary

This package delivers the §26 first-phase handoff's cross-device channel on the Web: one Session-header action captures the connected Host, the current Session, and the last Turn's durable anchor into a prefixed payload (`ClientSessions.encodeViewLocation`) wrapped as the page URL's `#dsh-view=…` fragment, and copies the whole link to the clipboard. Opening the link on another device reads the fragment exactly once and — only after that page's Host is admitted — verifies the payload targets exactly the connected Host before selecting the session and revealing the anchor through the turn-jump loader. The viewing position moves; the runtime never does.

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

The action shows a share glyph and the localized label; clicking encodes the payload, builds `origin + pathname + #dsh-view=<payload>`, copies the link — the button dresses as copied for two seconds — and opens a popover anchored under the action rendering that exact link as a scannable QR code (`qrcode.react` SVG, the same rendering as the device-pairing panel), so a phone camera is a delivery channel alongside paste. The popover follows the repo's anchored-panel recipe: bottom-anchored with a measuring pass, outside-pointer and Escape dismissal, focus returned to the trigger, `aria-haspopup="dialog"`. A clipboard refusal keeps the link reachable through the button's tooltip alongside the failure note. Opening a received link consumes the fragment immediately (one-shot: a wrong-Host failure cannot loop on refresh), waits for Host admission, then opens through the sessions service; a payload naming another Host fails loud in the console and no request leaves the page.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers one header action on `conversation.session.header.actions` plus the bilingual `view-handoff` dictionaries. A page-lifetime controller ([`src/client/controller.ts`](src/client/controller.ts)) subscribes the connection generation observable: descriptor presence is the admission signal `encodeViewLocation` itself requires, published as a snapshot store the action reads through the inject `hooks` compartment. The action derives its anchor from the standard `useConversation` share — the Chat target's timeline's last Turn `start` seq, the exact seq class `loadThrough` reveals. The receiver reads the page fragment once at apply and resolves after the first admitted generation; both the link builder and the fragment reader go through injected location/clipboard seams, so tests drive them without a browser.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-api-session-controller](../../api/session-controller/README.md) — the §26 codec (`encodeViewLocation` / `openViewLocation`) and the turn-jump loader.
- [dsh-client-ui-chat](../ui-chat/README.md) — the Chat target whose timeline provides the anchor.
- [dsh-api-remotes](../../api/remotes/README.md) — the connection generation the admission signal derives from.

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

The section-level decisions — the anchor choice, the one-shot fragment consumption, and the `ISessions` widening that exposes the codec to feature packages — are recorded in the [view-handoff Agent Note](../../../.agents/notes/implemented/architecture/2026-10-03-view-handoff.md).

</details>

**Runtime invariant:** No companion is published. The plugin registers one dictionary effect and one header-slot entry; the admission signal lives in the controller's snapshot store with no second copy to diverge, and the receive side's one-shot guard makes a consumed fragment unrepeatable by construction.

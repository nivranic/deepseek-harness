---
description: "Desktop-surface preferences: General-settings rows for the window close action, login autostart, and cross-device access (toggles, device name, pairing QR, trusted devices)."
kind: "package-reference"
---

# dsh-client-ui-desktop

English | [中文](README.zh.md)

## Summary

The desktop-surface preferences: General-settings rows choosing what the window's close button does — hide to the system tray (the default) or quit the application — and whether the app auto-starts at OS login, hidden in the tray (off by default). The cross-device rows drive remote access: enable cross-device access, allow remote approval, and the device-facing name bind the `remote` settings namespace the `dsh-link-settings` bridge owns, while the trusted-devices block calls the `link` Remote namespace — live LAN status with bind diagnostics, the one-time pairing QR, and per-device revocation. The package is dual-face: the host half registers the `desktop` settings namespace, and the browser half renders the rows bound to that namespace through the shared settings scope.

## Table of Contents

- [Summary](#summary)
- [Composition is the surface gate](#composition-is-the-surface-gate)
- [What the shell does with it](#what-the-shell-does-with-it)
- [When a row is absent](#when-a-row-is-absent)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Composition is the surface gate

Only the desktop bundle composes these rows. The web roster never names the package, so the web surface shows no rows and no `desktop` namespace — surface-specificity rides the roster, never a runtime fact: `appInfo` is display-only by contract, and the settings describe simply has nothing to report where the namespace is not registered.

## What the shell does with it

The Electron app shell ([`apps/desktop`](../../../apps/desktop)) reads the namespace through the settings service at close-button time, so a change from the row applies to the very next press. `tray` hides the window after building the tray affordance (a transparent PNG resource, resized to the tray's physical slot); `quit` tears down through the normal bounded shutdown. An unreadable section (tree still booting, or a drifted roster) falls back to `tray` — the schema default — so the window stays closable rather than stranded, with one logged report. A tray that cannot be built (a missing resource included) closes for real: a hidden window with no affordance to bring it back is never acceptable. With tray-close as the default the shell runs single-instance, and a second launch reveals the hidden window instead of stacking a second tree.

`launchAtLogin` owns the OS login entry: the shell syncs it into the system's autostart registry when the tree first serves settings and on every settings commit, so a toggle lands before the next login. The entry launches the app with `--hidden`, which keeps the window in the tray state while the whole tree boots — a later reveal (tray click or the desktop shortcut) is then instant instead of paying the cold start. Off by default: a login-time footprint is the user's opt-in, never ours.

## When a row is absent

While the namespace is loading, not yet accepted, or not exposed to this client, each row renders nothing — the same degradation every settings-scope row uses. A read-only settings document disables the options without hiding the row.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tray and login-entry implementation lives in the Electron app shell (`apps/desktop`); this package only owns the settings namespace and the rows.

</details>

## Model Experience

None, as the package contributes window-chrome preferences only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Non-Windows desktop builds keep quit-on-close and no login entry** — the shell implements and verifies the tray and login-item paths on Windows only; another desktop target needs its own shell-side wiring before `tray` and `launchAtLogin` can honor their contracts there.
- **Tray and balloon copy follows the OS locale** — the tray lives outside the web surface and its locale service; the shell picks zh/en from the OS locale instead.

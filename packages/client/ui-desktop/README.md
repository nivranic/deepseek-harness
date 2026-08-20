# dsh-client-ui-desktop

English | [中文](README.zh.md)

The desktop-surface preferences: one General-settings row choosing what the window's close button does — hide to the system tray (the default) or quit the application. The package is dual-face: the host half registers the `desktop` settings namespace, and the browser half renders the row bound to that namespace through the shared settings scope.

## Composition is the surface gate

Only the desktop bundle composes this row. The web roster never names the package, so the web surface shows no row and no `desktop` namespace — surface-specificity rides the roster, never a runtime fact: `appInfo` is display-only by contract, and the settings describe simply has nothing to report where the namespace is not registered.

## What the shell does with it

The Electron app shell ([`apps/desktop`](../../../apps/desktop)) reads the namespace through the settings service at close-button time, so a change from the row applies to the very next press. `tray` hides the window after building the tray affordance (a transparent PNG resource, resized to the tray's physical slot); `quit` tears down through the normal bounded shutdown. An unreadable section (tree still booting, or a drifted roster) falls back to `tray` — the schema default — so the window stays closable rather than stranded, with one logged report. A tray that cannot be built (a missing resource included) closes for real: a hidden window with no affordance to bring it back is never acceptable. With tray-close as the default the shell runs single-instance, and a second launch reveals the hidden window instead of stacking a second tree.

## When the row is absent

While the namespace is loading, not yet accepted, or not exposed to this client, the row renders nothing — the same degradation every settings-scope row uses. A read-only settings document disables the two options without hiding the row.

## Model Experience

None, as the package contributes a window-chrome preference only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Non-Windows desktop builds keep quit-on-close** — the shell implements and verifies the tray path on Windows only; another desktop target needs its own shell-side tray wiring before `tray` can honor its contract there.
- **Tray and balloon copy follows the OS locale** — the tray lives outside the web surface and its locale service; the shell picks zh/en from the OS locale instead.

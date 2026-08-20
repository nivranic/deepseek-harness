# Agent Note: Desktop close-button preference — tray by default, composition-gated

Status: implemented

English | [中文](2026-08-20-desktop-close-tray-preference.zh.md)

## Problem

Closing the desktop window tore down the entire harness: `window-all-closed` ran the bounded shutdown, killing every running session. Desktop users expect the close button to park the app in the system tray and keep it running, but that must be a preference — some users want close to mean quit — and it must exist only on the exe surface: the web Settings dialog must not advertise a tray option that no browser window can honor. The default is tray.

## Decision

The preference is a settings namespace owned by a new dual-face package, `packages/client/ui-desktop` (`dsh-client-ui-desktop`):

- The host half registers the `desktop` namespace (`closeAction: 'tray' | 'quit'`, schema default `tray`) and nothing else — deliberately surface-free, exactly the locale plugin's host-half shape: the typert workspace discovery assigns a package to the HOST face only when its host entry declares Context/Events members, and a host registration would drag the package's client half (through its single-package tsconfig) into a host batch program, colliding with `core/agent`'s `TypertContextMap.agent` across from `client/runtime`'s intentional client-face mirror. The Electron shell therefore reads the value through the settings service — `booted.ctx.get('settings')?.get(namespace)` — at close-button time, which needs no service of the package's own. Reading at press time (rather than caching at boot) makes the row's write apply to the next press with no shell-side event plumbing.
- The browser half is a `settings.general.item` row (id `desktop-close`) bound through `ctx.settingsScope.bind`, rendering a two-option radio group from the shared describe mirror; `select` routes through the scope's revision-fenced mutate path.
- The surface gate is composition, not a runtime fact: only `dsh-desktop-app`'s patch carries the row, so the web composition never registers the namespace and its settings describe has nothing to expose. `appInfo` runtime facts stay display-only by their documented contract — the row never branches on them.
- The shell (`apps/desktop/src/main.ts`) intercepts `close`: with `tray` it builds the tray FIRST (a transparent 32×32 PNG resource at `apps/desktop/resources/tray-icon.png`, resized to the tray's physical slot), then hides the window and shows one balloon hint per run. `quit` or a tray that failed to build (missing resource included) close for real — a hidden window with no affordance is never acceptable, and `trayBroken` latches the failure. `before-quit` and Windows `session-end` set a `quitting` flag so real exits (tray Quit, smoke shutdown, OS logoff) pass through unintercepted. Because tray-close is the default, the shell takes the single-instance lock and a second launch reveals the hidden window instead of stacking a second tree. An unreadable section (tree still booting, roster drift) falls back to `tray` with one logged report — the schema default keeps the window closable instead of stranding it, and the desktop composition e2e pins the registration so drift cannot arrive silently.
- Tray and balloon copy follows the OS locale (`app.getLocale`): the tray lives outside the web surface and its locale service.

## Alternatives considered

**Branch the row on `appInfo.runtime.electron`.** Rejected: the boot-graph runtime facts are documented display-only ("a consumer renders these, never branches product behavior on them"), and composition already is the mechanism for surface-specific rosters.

**Always-on tray with a "close minimizes" toggle.** More moving parts for the same contract: the tray exists to hold the hidden window, so it materializes on the first close-to-tray and stays for the run.

**Ship a dedicated tray icon asset.** Adopted one day later, reversing the initial deferral: extracting the exe's own icon with `app.getFileIcon` loses the alpha channel in the HICON→NativeImage conversion, so the tray rendered the circular logo on an opaque white square (the exe's embedded icon and the extracted `toBitmap()` corners are transparent; the encoded `toPNG()` output and the tray were not). The shipped asset is the exe icon's own transparent extraction at 32×32, so taskbar and tray identity stays identical; the packaging stage copies `resources/` beside `lib/` because the deploy filter omits it, and `electron-builder`'s `files` list carries it into the app tree.

**Renderer→main IPC for the preference.** Rejected: the shell already consumes tree services in-process (`desktopGateway` pattern), the scheme-as-bridge design has no preload, and the main process holds the settings service anyway.

## Consequences

The desktop roster now differs from the web roster by one browser row — the drift cost this surface already carries, paid again: the row lives in the bundle's `package.json` dependency AND the `cordis.patch.yml` client-row block, and `apps/cli/tests/desktop-composition.e2e.ts` pins both the boot-graph row and the namespace-with-tray-default (plus the re-resolved section after each commit). The packaging path also changed shape: the exe build stages `apps/desktop`'s manifest closure, so the new dependency is packed like every other — but the smoke launch now requires the app not to be running (the release chain already stops it first), because a second instance reveals instead of starting. The close-to-tray default means quitting happens through the tray menu's 退出 or a real `quit` setting; sessions survive window close, which is the point.

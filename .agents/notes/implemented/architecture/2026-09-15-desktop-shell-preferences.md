# Agent Note: Keep tray preferences and login registration in the Desktop Shell

Status: implemented

English | [中文](2026-09-15-desktop-shell-preferences.zh.md)

## Problem

Hiding a Desktop window requires a native restore affordance that remains available when the Host is starting or failing. Login registration can be disabled outside the application, so a persisted boolean cannot establish whether the OS will launch it. Sharing these controls through Host settings would couple native lifecycle to backend availability.

## Decision

The official Electron Shell owns the native menus, tray, and serialized close preference. [Desktop usage](../../../../apps/desktop/README.md#tray-and-login-startup) owns defaults, file format, error behavior, and user controls. The application renderer receives no additional IPC and the Host settings namespaces do not contain Shell preferences.

The single-instance owner admits preference writes. A tray with restore and quit actions must exist before the Shell prevents closing or hides a login-started window. Disabling the preference reveals the window before tray destruction. Shutdown refuses new changes, joins admitted writes, and destroys the tray. Updater preparation flushes preferences before stopping the Host; an update error releases installer quit ownership.

The packaged executable and fixed `--hidden` argument identify the OS login item. The OS read determines the checkbox state, including Windows executable enablement and macOS approval status. Development launches and unsupported platforms cannot read or change login registration through this adapter. Native activation and a second instance reveal the primary window without creating another Host.

Legacy import is a native, explicit file selection and confirmation. The bounded JSON/YAML reader extracts only the Desktop fields, refuses unknown versions and invalid fields without quoting source contents, and binds confirmation to the selected file's digest. The existing Shell owner applies close behavior with its tray and atomic-write guarantees. The old login preference is displayed but cannot register a login item; neither the source nor its other namespaces are rewritten. Concurrent import is refused, and shutdown or installer ownership prevents new changes.

## Alternatives considered

**Store native behavior in shared Host settings.** This requires backend startup and another communication route to control Shell lifecycle. Native menus and a Shell-owned file keep those operations available independently of the Host.

**Persist launch-at-login alongside close behavior.** A copied boolean can disagree with OS policy or a user change in system settings. The Shell queries the registration instead.

**Enable background closing by default.** This changes ordinary platform close behavior without a user choice. The default remains disabled, and a tray failure never traps a window in the background.

**Discover and migrate the Host settings file at startup.** Automatic discovery can open a historical Harness home without a reviewed source choice and restore OS startup behavior without current consent. Explicit preview preserves the file and requires the user's current close-behavior choice; OS login remains a separate control.

## Consequences

Native preferences survive profile repair but do not synchronize across devices. Legacy import converts close behavior only; users review OS login registration separately and retain the complete old document. The [convergence plan](../../../../docs/plans/2026-09-14-upstream-first.md#task-2-converge-desktop) keeps broader data conversion explicit.

Owner-local menu snapshots and lifecycle tests cover user-visible controls, persistence refusal, failed writes, shutdown, and updater errors. Windows development execution verifies a real tray, close/hide, second-instance restoration, and explicit quit with a separate Node Host. OS login registration, packaged application behavior, and macOS execution remain platform qualification requirements.

The [packaging decision](2026-08-25-electron-desktop-packaging-and-updates.md), [bundled-runtime decision](2026-09-08-desktop-bundled-runtime-and-external-plugins.md), [immediate-window decision](2026-09-09-desktop-immediate-window-and-direct-start.md), and [in-place profile decision](2026-09-09-desktop-in-place-profile.md) retain their ownership. This decision adds Shell preferences without superseding those records.

# Agent Note: Remote host settings and link administration surface (Phase 1 host half)

Status: implemented

English | [中文](2026-08-30-remote-host-settings-and-admin-surface.zh.md)

## Problem

Phase 1 of the nativization plan (E:\11585 plan, chapters 27–28, 42–43) requires the Windows host to expose cross-device access as product settings — enable cross-device access, allow remote approval, device name — plus a local administration surface for pairing and the trusted-device manager. After PoC-2 the carrier's `enabled` and `allowRemoteApproval` existed only as load-time plugin config, the host name was hardcoded to `os.hostname()`, the carrier bound once in the constructor and could never restart, and no Remote namespace could carry these facts to a client settings page. The plan also pins the trust rule: knowing an interaction id must never equal the right to answer it, and the local administration endpoints must not be reachable through the remote carrier itself.

## Decision

`ctx.linkAccess` gained runtime controls: a serialized enable/disable queue (rapid toggles never double-bind, enable-on-enabled and disable-on-stopped are no-ops), a bind-failure record the status surface reads, live `setAllowRemoteApproval`/`setDeviceName` switches, and a `carrierStatus()` read that never throws — the observer promise swallows a mid-flight bind rejection and reports it through `bindError`. Two new packages complete the surface. `dsh-link-settings` (`ctx.linkSettings`) registers the `remote` settings namespace — `enabled`, `allowRemoteApproval`, `deviceName`, all off/OS-hostname by default — and pushes every commit into the carrier name-and-approval first, listener second, so a newly enabled carrier advertises the committed identity; a bind failure is contained (the namespace keeps the user's intent) and disposing the bridge unregisters the namespace so later commits fail loud. `dsh-api-link-controller` (`ctx.linkController`) backs the generated `ctx.remote.link` namespace: `status` (listening, endpoint, SPKI fingerprint, bind diagnostics, name, approval switch, device count), `createPairing` (the QR payload, with a stopped or failed carrier mapped to `link-disabled`), `devices` and `revokeDevice` (rows never carry the device public key; the carrier is read lazily so the controller mounts before remote access exists). The namespace is mounted in `dsh-api-remotes` for every client; dispatch stays local because the remote allowlist lists none of the `link` endpoints.

## Consequences

The host half of the Phase 1 settings page is callable end to end: toggling the namespace flips a real TLS listener, and a port conflict surfaces in `status` instead of wedging the switch. Tests: 35 on the carrier (restart/rebind, serialized toggles, constructor-bind raced by a queued disable, bind-failure recovery, failure frames and their abort-skip, live name/approval on the wire) with per-file 100% coverage restored — this audit also found and closed six pre-existing uncovered locations in the stream failure path and the network-interface flatten; 5 on the bridge and 7 on the controller, both at per-file 100%. The client rows, QR dialog, and device manager are the next increment over `ctx.remote.link` and the `remote` namespace; desktop bundle mounting and the composition e2e land with that UI so the roster carries one coherent feature. Role editing and a pending-pairing cancellation list stay out until a UX needs them.

## Alternatives considered

Link-access could have injected the settings service directly and owned the namespace itself; that couples the carrier plugin to a product-settings UX decision and makes headless deployments load settings machinery they never read. The bridge could also have restarted the whole plugin through the loader on every toggle; the serialized runtime queue does the same job without a dispose/remount window that drops pairing state mid-flight. A separate device-administration Remote namespace per method family was rejected — one `link` namespace with local-only reach keeps the authorization story to a single allowlist check.

# Agent Note: Remote Phase 1 client surface, desktop composition, and link contracts

Status: implemented

English | [中文](2026-08-30-remote-phase1-client-surface-and-contracts.zh.md)

## Problem

The Phase 1 host half (settings namespace, runtime-switchable carrier, `link` Remote namespace) had no client surface: the Windows pairing UX the plan demands — enable cross-device access, allow remote approval, device name, the pairing QR, the trusted-device manager, LAN diagnostics (plan chapters 42–43) — had nowhere to render, the desktop bundle mounted none of the remote rows, and Phase 2's Swift/Kotlin companions needed the wire vocabulary pinned as generated, drift-gated models (chapter 19) before any companion code could be trusted against the host.

## Decision

The ui-desktop client plugin owns the whole cross-device settings block in the General section, extending the existing row pattern: two boolean toggles and a device-name editor bind the `remote` namespace through the shared settings scope, and one devices block calls the `link` Remote namespace through an injected API whose four methods unwrap the generated `RemoteResult` into values or thrown Errors. The pairing dialog renders the one-time payload as a QR (the `uqr` renderer, a devDependency bundled into the client artifact) with the manual code as selectable text; the device list shows role and last-seen, revokes through the same API, and the status line carries the LAN endpoint or the bind error. Composition remains the surface gate: the rows render null wherever the host mounts no link carrier, and the desktop bundle now mounts all four rows — device-trust (lazy), link-access (unbound until the switch commits), link-settings, and the link controller — so the composition e2e proves the acceptance end to end: namespace defaults off, carrier unbound, `link/status` answering locally through the gateway `/api` chain, `link/createPairing` refusing with `link-disabled`, and an empty device list; the remote allowlist carries none of the `link` endpoints, so paired devices cannot reach the administration surface at all. `dsh-link-contracts` pins the same wire vocabulary for native companions: one declarative type table, zod schemas satisfying the protocol types, one golden fixture per exercised type, and a pure emitter producing the manifest (with fixture checksums), Swift `Codable`, and Kotlin data models; `verify-link-contracts` in the hygiene aggregate fails on any drift between the table and the committed artifacts.

## Consequences

The full Phase 1 slice now runs from a settings switch to a TLS listener: flipping the toggle binds a real carrier whose status, pairing, and revocation surface in the same settings page, verified by 34 ui-desktop tests plus the extended desktop-composition e2e (per-file 100% coverage on ui-desktop's sources, closing the coverage debt found in the earlier audit) and 5 contract tests over the fixtures and both emitted languages. Correcting the ui-desktop dependency declarations (static client inputs dev-only, DSH relationships peer+dev) turns `verify-client-packages` green again on dev. Deferred to Phase 2: the Swift/Kotlin companion apps that consume the generated models, SessionController-level session e2e through the carrier, role editing, and a pending-pairing cancellation list.

## Alternatives considered

A dedicated ui-remote client package was rejected: the rows share ui-desktop's scope binding, CSS, locale namespace, and desktop-only roster seat, so a second package would duplicate the composition gate without deleting code. A live-updating device list over a forwarded event was deferred — the block refreshes on mount, on toggle, and after each mutation, and an event feed belongs with the session-stream consumption Phase 2 needs anyway. Emitting the native models from the Typert generator was considered and deferred: the link vocabulary is a hand-pinned contract table, not a reflected service surface, and coupling the emitter to the generator would drag every Remote owner's types into the companions' diff.

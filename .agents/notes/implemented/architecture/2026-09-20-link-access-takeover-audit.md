# Agent Note: Link-access takeover — the candidate gateway owns device-facing access

Status: implemented

English | [中文](2026-09-20-link-access-takeover-audit.zh.md)

## Problem

Spec §48 lists the pre-upstream `packages/remote/link-access`, `packages/remote/device-trust`, and `packages/remote/link-contracts` and forbids continuing them as-is by default: the agent must first audit whether the official current API/Connection can take over those responsibilities, then place the work by current upstream package ownership. The emulator lane now speaks the migrated Link client protocol against a fixture Host, and the candidate harness serves no `/link/pair` endpoint — the ownership question gates Phase 7 (Device Trust) and Phase 8 (Remote Transport).

## Audit findings

- **What the legacy trio owned**: the QR pairing ceremony (one-time code, nonce + expiry + single-use per §70), device grants (revocable, with observer/controller/administrator roles and last-seen/fingerprint bookkeeping per §20–§22), the Noise/pinned-TLS transport with Ed25519 request signing, and the wire contracts for `/link/pair`, `/link/describe`, `/api/$method`, and `/link/stream/$endpoint`. None of this server code exists in the candidate: the historical source carried only the Android client, and the fixture Host (`apps/android/support/link-fixture-host.mjs`) is a lane instrument, not a product surface.
- **What the candidate already owns**: the Typert RPC gateway (`@deepseek-ai/dsh-api-gateway`) serves dispatch, validation, cancellation, streams, forwarded events, capability negotiation (§13), the diagnostics-only tier (§14), and interaction-reply permissions (§15) over Connection's shared `/api` carrier; the webserver serves the web/desktop clients from the Host. Request metadata is explicitly not authorization, and the trust boundary today is the Host's localhost carrier line (§70's "do not close the Host's original localhost defense line"). The shared failure vocabulary and its Kotlin/Swift mirrors are sealed contract columns in `dsh-typert-protocol` and `apps/*/contract`.
- **What is missing**: any device identity, pairing, grant, role, or revocation surface; any non-localhost carrier admission; a TLS/pinning story for LAN device access.

## Decision

1. **No resurrection.** `packages/remote/link-*` and `packages/remote/device-trust` stay retired; nothing is ported from the pre-upstream tree.
2. **The candidate gateway is the single owner of device-facing access.** Device pairing and trust land as a capability-gated seam on the existing gateway + Connection carrier (a `device-pair.v1`-style declaration per §13), not as a parallel Link server. The gateway's existing admission, capability, permission, and failure surfaces apply to devices exactly as they do to web/desktop clients.
3. **The wire stays the client's.** The migrated Link client stack in `apps/android/core` remains the device-side carrier until the candidate-native device seam exists; the fixture Host documents that wire as the lane instrument. When Phase 7 opens, the pairing ceremony, device-key registry, roles, and revocation are specified against the gateway's contract generation, with §21's role table (Viewer/Collaborator/Admin) reconciled onto the existing `requiredPermission` execution rather than the Link protocol's observer/controller/administrator names.
4. **Sequencing.** Phase 7 work starts from this decision: device grant store and pairing issuance first, role-mapped permission checks through the existing §15 seam second, revocation and lost-device UX (§22) third. The LAN carrier (§24: discovery is convenience, never trust) requires a TLS/pinning decision before any non-localhost admission; the localhost line stays closed until then.

## Alternatives considered

- **Port the legacy link-access server as-is.** Rejected by the spec's own audit-first rule; the legacy server code is not in the candidate tree and its trust model predates the gateway's capability/permission seams.
- **Keep the Link protocol as the device seam permanently.** Rejected: two parallel admission models (gateway capabilities vs Link roles) would fork permission semantics; §15 already executes permissions Host-authoritatively.
- **Defer the decision until Phase 7 fully opens.** Rejected: the emulator lane and the Android shell's next steps both need a named owner now; deferral leaves the fixture as an implicit answer.

## Consequences

Device access has one named owner (the gateway + Connection carrier) and one permission executor (the §15 Host-authoritative seam). The Android shell keeps its Link client for the emulator lane and migrates onto gateway admission when the pairing seam lands. The fixture certificate, code, and driver stay lane instruments with no product claim. This decision unblocks Phase 7's first increment (device grant store + pairing issuance) and records why `packages/remote/*` stays absent from the candidate layout.

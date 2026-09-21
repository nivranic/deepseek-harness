# Agent Note: Devices settings section consumes the device-trust Remote face

Status: implemented

English | [中文](2026-09-21-devices-settings-section.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `packages/client/ui-settings-devices`, `packages/api/remotes`, `packages/typert/protocol`

## Problem

Section 22's Host surface (list with platform/lastSeenAt, rename, revoke, revoke-all) had no operator UI: the Remote namespace was the only way to reconcile lost devices, and the §7-§11 product lines had not started. The generated `remote.deviceTrust` namespace was also unmounted — the api-remotes client face neither mounted it nor admitted its capabilities in host preparation.

## Decision

A new browser plugin `dsh-client-ui-settings-devices` registers the localized `settings.section` entry `devices` (nav order 10, between General and Plugins). The api-remotes client mounts `deviceTrustRemote` and re-exports the seam's types; host preparation admits the exact capability set. The section gates registration on `device.list.v1` and re-registers on `connection.generation` changes with a fresh component identity, so row state (rename drafts, open confirmations) never survives a Host replacement; one guarded `settle` helper checks the generation before and after every Remote await, mapping mid-flight generation changes (and their transport failures) to a "connection changed" rejection.

The rows render every Section 22 fact — name, role tone, client-declared platform tag, paired time, admission-derived last-seen (or "Never admitted"), leading 16 fingerprint hex digits, revoked marking without actions. Rename is inline with local empty-name rejection and trimming; single revoke and revoke-all require inline confirmation, a completed revoke-all reports its count, and successful row mutations trigger one roster re-read. Failures resolve through `classifyRemoteFailure` into locale-owned copy; unclassified codes keep the raw diagnostic. `formatTime` rides the inject face (built from `ctx.locale.getSnapshot().active`), because `GlobalStandardProps` carries no locale prop — timestamps follow language switches through the registration, not a component prop.

Three device codes joined the shared failure-class map — `device/key-invalid` → authentication, `device/not-found` → unavailable, `device/already-revoked` → conflict — so every Client surface (this section, the connection classifier's blocked states) agrees on their presentation semantics.

## Alternatives considered

- Subscribing to grant changes instead of one roster per mount/mutation: the settings surface has no stream contract for grant changes; refresh-after-mutation plus an explicit Refresh button is the honest freshness contract, recorded as a limitation.
- Issuing pairing codes from this section: `issuePairing` belongs to an onboarding flow, not a management surface; deferred deliberately.
- Patching the raw diagnostic per row: the class map keeps one home for cross-Client semantics, and the section only owns copy.

## Consequences

- The Devices section exists only while the Host advertises `device.list.v1`; a Host without device trust shows no section, not a broken one.
- All four operations share one generation guard; a late response from a replaced Host cannot update the section or reach the new Host.
- The device-trust package's client-face types now flow through api-remotes re-exports; consumers never import the seam package directly.

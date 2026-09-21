# Agent Note: Device identity change confirms instead of retrying

Status: implemented

English | [中文](2026-09-21-device-identity-confirmation.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `packages/api/device-trust`, `packages/api/gateway`, `packages/client/connection`, `packages/client/ui-settings-general`, `apps/android/core`, `apps/android/support`

## Problem

Section 22's lost-device list was half-landed (revoke one, fingerprint, pairedAt, role) while revoke-all, rename, last seen, platform, and the immediate disconnect of revoked devices' streams were missing; the §18 `device-revoked` Connection state had no producing classifier, so it was unreachable in the shipped composition; and a client whose identity the Host no longer matched (re-key or Host reset — the §22 device re-key path) retried into an opaque failure with no pair-again guidance — the "change identity confirmation" item the record chain carried.

## Decision

Section 22 completes on the Host: `revokeAllDevices` (device.revoke-all.v1) revokes every active grant and answers with the shared time and count; `renameDevice` (device.rename.v1) relabels a grant without touching identity, key, or role; listings expose the admission-derived `lastSeenAt` and the client-declared `platform` (the redemption request carries it — Android sends `android`, the fixture accepts it). Revocation now announces itself: device-trust emits the typed `deviceTrust/grantsRevoked` event, the gateway records each admitted Remote-event client's `deviceId`, and the event's arrival terminates exactly those streams — proven by the stream suite asserting the wire `end` frame after a revoke (a graceful stream end keeps the mux socket open; the frame is the observable).

Identity change confirms on the Connection surface: the gateway client's `classifyFailure` maps `device/already-revoked` to `device-revoked` (repairing the state's missing producer) and `device/not-found`/`device/key-invalid` to the new `identity-changed` state; both block retries and present pair-again guidance through locale-owned keys. `device/replay-detected` deliberately keeps automatic retry: a replay verdict against our own fresh envelopes is noise, not an identity verdict. The code comparisons are plain string matches because the client face does not link the device-trust details-map declaration — the vocabulary is merge-extensible over the wire.

## Alternatives considered

- Reusing `device-revoked` for identity loss: semantically wrong — nothing was revoked; the guidance ("revoke" vs "re-pair") differs.
- Revocation disconnect through per-stream abort signals: the queue-end path already terminates the generator; routing the event to `removeRemoteEventClient` reuses the one lifecycle owner.
- A device-side re-key ceremony replacing re-pairing: the spec's own answer is "pair again after a secure-storage wipe"; the stale grant stays listed (with last-seen and platform) so the operator reconciles by revoking it.

## Consequences

- A lost device's streams die at revocation time without waiting for their next admission; revoke-all is the panic path.
- `revokeAllDevices` skips already-revoked grants (they keep their original time) and emits only for the identities it revoked.
- The identity-changed classification trusts the three device codes at the wire boundary; an unrelated `device/*` verdict still follows `classifyRemoteFailure`'s authentication class (automatic retry).
- Management UI for rename/revoke-all belongs to the §7-§11 product lines; the Remote surface is the operator's API today.

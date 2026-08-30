# Agent Note: Persisting the endpoint with the identity

Status: implemented

English | [中文](2026-08-31-endpoint-persistence.zh.md)

## Problem

Pairing persisted who the companion is but not where the host is: the carrier endpoint and SPKI fingerprint lived only in the pairing payload, so every relaunch showed the pairing screen again even though a durable identity existed — the standing "relaunch re-pairs" limitation on both platforms.

## Decision

`LinkCredentials` grows `endpoint` and `pinnedFingerprint` on both platforms, and `pair` persists them straight from the pairing payload. Both clients grow a `restore` factory — `LinkClient.restore(store:)` on Apple, `LinkClient.restore(store)` on Android — that rebuilds a client from persisted credentials, pinning the stored fingerprint against the stored endpoint. The Apple shells call restore with the keychain-backed store at launch; the Android runtime restores from a new file-backed `FileLinkCredentialsStore` in core (the app passes its files directory, pairing writes through the same store) before first composition. Tests cover the round-trip, the pair-persisted fields, and a restored client signing a working describe against the local test server.

## Consequences

Relaunch skips pairing and lands on the six-tab surface directly on both platforms — both lanes green over the change. The single-host limitation stands (one identity per store), and revocation still surfaces as carrier refusals after restore; multi-host switching stays deferred. On Android the file store is plain JSON in the files directory — the Keystore-backed encryption of the signing key arrives with the security pass the plan schedules later.

## Alternatives considered

Persisting the endpoint in a separate preference was rejected — the identity is only usable with its endpoint and fingerprint, so one document keeps them from drifting apart. Reconstructing the fingerprint from a reconnect-time describe was rejected — the pin must exist before any trust is established, and describe itself rides the pinned connection.

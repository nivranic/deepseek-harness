# Agent Note: Persisting the endpoint with the identity

Status: implemented

English | [中文](2026-08-31-endpoint-persistence.zh.md)

## Problem

Pairing persisted who the companion is but not where the host is: the carrier endpoint and SPKI fingerprint lived only in the pairing payload, so every relaunch showed the pairing screen again even though a durable identity existed — the standing "relaunch re-pairs" limitation on both platforms.

## Decision

`LinkCredentials` grows `endpoint` and `pinnedFingerprint` on both platforms, and `pair` persists them straight from the pairing payload. Both clients expose a `restore` factory — `LinkClient.restore(store:)` on Apple and `LinkClient.restore(store, transportConfig)` on Android — that rebuilds a client from persisted credentials, pinning the stored fingerprint against the stored endpoint. The Apple shells call restore with the keychain-backed store at launch; the Android runtime restores from a file-backed `FileLinkCredentialsStore` in core before first composition, and the [Android Link transport ownership](2026-09-02-android-link-transport-and-stream-ownership.md) rule retires the previous client when the switchable wire installs the restored or freshly paired client. Tests cover the round-trip, the pair-persisted fields, and a restored client signing a working describe against the local test server.

## Consequences

Relaunch skips pairing and enters the companion surface directly on both platforms. The single-host limitation stands (one identity per store), and revocation still surfaces as carrier refusals after restore; multi-host switching stays deferred. On Android the file remains JSON in the app files directory, but the [AndroidKeyStore seal](2026-08-31-android-keystore-seal.md) replaces the signing-key field with AES/GCM ciphertext whose key never leaves AndroidKeyStore.

## Alternatives considered

Persisting the endpoint in a separate preference was rejected — the identity is only usable with its endpoint and fingerprint, so one document keeps them from drifting apart. Reconstructing the fingerprint from a reconnect-time describe was rejected — the pin must exist before any trust is established, and describe itself rides the pinned connection.

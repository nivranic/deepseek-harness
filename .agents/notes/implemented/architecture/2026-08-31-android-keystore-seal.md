# Agent Note: The AndroidKeyStore seal on the signing key

Status: implemented

English | [中文](2026-08-31-android-keystore-seal.zh.md)

## Problem

Endpoint persistence made the signing key durable — as plain base64 in a JSON file under the app's files directory. A rooted device or a file backup reads the key straight off the disk; the identity it signs was only as safe as the filesystem.

## Decision

Core grows a `CredentialsCipher` seam — `seal`/`open` over the key bytes — and `FileLinkCredentialsStore` takes one: saves write the cipher's sealed form where the key's base64 rode, loads open it back. The app injects `AndroidKeystoreCipher`: an AES/GCM key the AndroidKeyStore generates and never exports, each save sealed under a fresh 12-byte IV prepended to the ciphertext. The plain identity cipher keeps previews and shape-only tests unchanged. The boundary test in core uses a see-through XOR fake: it asserts the on-disk bytes never contain the plaintext key, and that loading returns the working identity — the disk-side guarantee, testable without any device.

## Consequences

The lane is green with the boundary test beside the app's `assembleDebug`, which compiles the keystore cipher into the APK. Keystore-held keys die with an uninstall together with the sealed file, leaving nothing stale; key rotation is a future store migration if the keystore entry ever needs re-basing. One test-learning: verifying the round-trip needed no curve point — a fabricated raw public key fails Ed25519 point decoding before any assertion runs.

## Alternatives considered

Encrypting the whole credentials file was rejected — only the key is secret; the rest is operational data a backup may legitimately show. EncryptedSharedPreferences was rejected — a second persistence stack for one field, and the seam keeps core JVM-testable.

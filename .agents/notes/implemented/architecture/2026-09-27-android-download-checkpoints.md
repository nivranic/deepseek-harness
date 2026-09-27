# Agent Note: Android download checkpoints bind encrypted windows to one principal and resource

Status: implemented

English | [中文](2026-09-27-android-download-checkpoints.zh.md)

## Problem

A bounded preview cannot retain a large file. Continuing a partial download after process loss also needs more than a byte offset: the selected Host grant, Session, file version and accepted bytes must still agree. Saving a new offset before its bytes are durable can silently omit data; accepting an uncommitted tail can include a failed write.

## Decision

`FileNativeDownloadStore` owns one application-private transfer under an exclusive filesystem lease. Its encrypted checkpoint binds Host identity, pinned fingerprint, device grant, Session and requested path. Each authenticated encrypted frame binds a random transfer identity, sequence, byte offset and EOF. The caller supplies an authenticating cipher, per-window limit and total content limit. Plaintext memory remains proportional to one window during validation and copying; the total content limit excludes encryption and framing overhead.

Appending synchronizes the frame before atomically replacing a synchronized encrypted checkpoint. Recovery validates all committed frames and ignores any later bytes. Explicit append truncates only that uncommitted tail. Corrupt metadata or committed frames remain untouched and stop continuation. A failed checkpoint replacement leaves the previous prefix authoritative. A complete transfer requires accepted EOF, including for empty files. Complete copying can fail after writing earlier windows, so its consumer must discard an incomplete destination.

`NativeDownloadController` restores local state without network requests. Explicit resume revalidates the full descriptor before reading the missing suffix. Every window uses the same parser as bounded resource previews; changed versions, paths, sizes, offsets, malformed base64 and contradictory EOF cannot be spliced into the retained prefix. Retirement cancels and awaits network and disk work before releasing the lease. The caller must retire this controller before adopting another Host.

This is a core transfer facility. The application does not yet construct it, supply a Keystore cipher or expose a download action. Completed disk content is not yet connected to the document picker. The [resource-reading decision](2026-09-27-android-current-resource-reading.md), [complete snapshot save](2026-09-27-android-complete-resource-save.md) and [saved-Host ownership](2026-09-26-android-saved-host-catalog.md) remain active because they own separate presentation, result lifetime and identity adoption rules.

## Alternatives considered

**Retain every window in memory.** File size would determine heap usage and process loss would discard progress.

**Use a plaintext cache or persist only an offset.** A cache would expose resource content outside the authenticated storage policy; an offset would not prove which principal or version supplied the bytes.

**Append a self-contained journal without a checkpoint.** A torn trailing frame cannot reliably distinguish an interrupted append from corruption of committed content. A separate atomic checkpoint identifies exactly which frames must validate.

**Resume automatically after restoring credentials.** Restoring identity does not restore a user's transfer approval. Explicit continuation keeps process recovery separate from network intent.

## Consequences

Core tests exercise real encrypted files, cross-principal and cross-Session ciphertext transplants, changed descriptors, corruption, bounded copying, retry, pause and awaited retirement. A separate JVM exits abruptly after syncing a frame but before checkpoint replacement; reopening validates the prior prefix, releases the dead process lease and replaces the uncommitted tail. This qualifies local JVM process interruption, not Android process death or power-loss durability. Missing keys, atomic-move support and disk errors fail without plaintext fallback. Storage eviction, explicit reset/removal, aggregate disk quotas, Android Keystore adoption, download UI, foreground scheduling and disk-to-document saving remain integration work. Rollback-resistant storage, hardware failure, physical-device and third-party-provider qualification are not established.

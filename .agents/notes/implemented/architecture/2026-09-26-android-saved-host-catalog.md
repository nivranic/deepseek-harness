# Agent Note: Android commits saved Host selection with its credentials

Status: implemented

English | [中文](2026-09-26-android-saved-host-catalog.zh.md)

## Problem

A single credential file loses the previous Host when pairing another. Persisting the selected Host separately from its credentials can restore a different identity after interruption. Publishing a new Host before retiring old model work can send an action through a connection that differs from the visible selection.

## Decision

Android stores a version 1 encrypted catalog containing all saved native grants and the active Host key. The key hashes Host id and TLS fingerprint; endpoint and replaceable device grant do not define a separate Host. Re-pairing replaces that Host's saved grant. The application uses its own Keystore alias and a 1 MiB document limit. Decode rejects invalid identities, duplicate Host keys, unsupported fields or versions, and dangling selections. Same-directory atomic replacement commits credentials and selection together.

The ViewModel hides business controls and awaits model retirement before changing Host. The controller flushes the old principal's input, prepares the target transport and input, and then commits storage and adoption without cancellation. Before commit, failure retains the old selection and retires candidate resources. After commit, old-resource retirement failure keeps the committed identity visible but unavailable until process restart. It never publishes the prior identity as if the durable commit had failed. New models restore observations only; saved input never submits itself.

A missing catalog can offer explicit import of the previous native credential file. Import preserves that file and rejects legacy Link credentials. Once a catalog exists, the application never falls back to the old file. An unreadable catalog requires explicit backup and empty replacement before pairing. Reading does not create a missing key. No forget, purge, or automatic backup deletion is implied.

The [native connection decision](2026-09-25-native-remote-connection-source.md) retains TLS, proof, and Gateway ownership; this decision replaces its single-Host storage and recovery behavior. The [input checkpoint decision](2026-09-26-android-encrypted-input-checkpoints.md) retains Host-id/fingerprint/device-id isolation, so a replacement grant gets independent input even when it replaces the same catalog entry. Both decisions remain active.

## Alternatives considered

**Separate files for active selection and credentials.** Independent writes can restore a selection whose grant was not committed. A single encrypted document has one atomic replacement point.

**Publish the target before stopping model producers.** A stale UI callback can dispatch under a new identity. Model retirement and hidden controls precede adoption; the new generation is usable only after old resources finish retiring.

**Automatically restore old credentials after catalog failure.** This silently changes the principal and hides damaged state. Explicit import is limited to a missing catalog; explicit recovery preserves unreadable bytes.

## Consequences

Same-id Sessions on different Hosts retain separate drafts, answers, and pending prompt identities. Core tests cover store rejection, encryption, atomic-write failure, cancellation around commit, grant reuse, principal isolation, and failed retirement. The Android scenario pairs two real Hosts, switches saved identities, restarts with retained input, and verifies prompt dispatch reaches only the selected Host. Corruption recovery runs in the isolated acceptance application. Physical devices, permanent hardware key invalidation, sudden power loss, and release qualification remain separate acceptance work.

# Agent Note: Real Host native Link acceptance

Status: implemented

English | [中文](2026-09-02-real-host-native-link-acceptance.zh.md)

## Problem

Generated Swift and Kotlin models, fixture replay, local fake servers, and the TypeScript carrier slice each proved only part of the native Link path. None executed a native client against the shipped Host composition, so pair, pinned TLS, signed RPC, Session streaming, Remote Approval, cancellation, reconnect, and revocation could drift together while every existing check remained green.

## Decision

One repository-owned corpus lists the 13 required pair-through-revoke steps in their canonical order and owns each step's observable values. The list step names the exact target and decoy Sessions, history binds the target opening and forbids the decoy, prompt binds the accepted request and exact response while forbidding the decoy, and reconnect names the active-stream interruption plus the exact follow and Remote Event replacement counts, authoritative snapshot requirement, and Client identity refresh. Every driver rejects extra or missing keys and rejects values outside those pinned expectations before it opens the carrier.

A Vitest orchestrator boots the shipped base plus desktop composition with an isolated Harness home and deterministic model server, then runs the TypeScript reference client on every host and an independently compiled Swift or Kotlin driver in the owning platform lane. Both native drivers read the same physical corpus and use their production Link client, signing, pinning, unary, stream, and companion-state implementations; no copied native resource can become a second scenario owner. Reconnect interrupts the active follow and `$events` generations, then requires the production view models to open exactly one replacement of each kind and publish the new authoritative snapshot and Host-issued `clientId`.

The Host control listener binds only to loopback behind a random bearer token. It may trigger a real Approval request, report its settlement, and revoke the paired test device; it never performs a client business operation or answers an interaction. The native client performs every Link request over the real TLS carrier and must report each corpus step as `PASS`. The orchestrator rejects missing, skipped, reordered, or duplicate steps and mismatched corpus hashes, source revisions, or protocol versions.

The Apple and Android workflows install the repository JavaScript dependencies, execute their native driver against the orchestrator, and upload the Host-published result JSON. A native driver can write only a candidate below the isolated Harness home. The Host publishes a credential-free `FAIL` result first and replaces it with `PASS` only after it validates the candidate schema, corpus hash, separate Host and Client revisions, Link protocol, Link contract, Session format version, all terminal steps, control-listener observations, and a second clean-input check against the same source revision used before launch. The clean-input checks cover the complete native app tree and reject ignored source or configuration files. Repository task evidence records a host that cannot launch Swift or Gradle as `NOT_EXECUTED`; a configured native launch failure leaves the credential-free `FAIL` artifact. The TypeScript reference run proves the Host harness but cannot close either native result.

## Alternatives considered

**Treat generated fixtures as interoperability evidence.** Rejected because decoding identical bytes never opens the native TLS stack, signs a real Host request, observes a live Session stream, or exercises reconnect and revocation.

**Use a native fake server.** Rejected because it would duplicate Gateway envelopes, authorization, Session projection, and Remote Event settlement in the test and could agree with the client while the shipped Host disagreed.

**Launch a separate supported application with a test-only control API.** Rejected for this gate because the existing real-composition test already boots the shipped base and desktop Loader tree, while an application-level control API would add a non-product surface only for orchestration. The native client remains a separate process, and all product requests still cross the real carrier and Gateway.

**Copy the scenario into each native test bundle.** Rejected because byte freshness would not prevent semantic edits from diverging between three owners. Both drivers resolve the one repository corpus at runtime and include its SHA-256 in their result.

## Consequences

Native changes now carry a heavier platform check: the Apple and Android lanes must install the Host dependencies and preserve a machine-readable artifact in addition to compiling their own sources. The test remains keyless and deterministic, its loopback control listener is unavailable outside the temporary run, and a dirty source input cannot produce `PASS`. The [carrier multi-device slice](../architecture/2026-08-30-carrier-session-slice-e2e.md) remains complementary evidence for two-controller settlement; this corpus proves one real native client at a time and does not replace the dedicated recovery fault-injection task.

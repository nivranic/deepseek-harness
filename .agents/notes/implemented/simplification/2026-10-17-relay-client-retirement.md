# Agent Note: the dormant RelayClient retires; the Noise vectors stay

Status: implemented

English | [中文](2026-10-17-relay-client-retirement.zh.md)

## Problem

`RelayClient` — the cross-device rendezvous HTTP consumer from the 2026-08-31 relay prototype — sat dormant in the Android core module with zero production references (its only caller was its own JVM test), and it carried the last `java.net.http` import in an Android main source set: the same latent `NoClassDefFoundError` trap the gen-56 migration removed from `LiteHTTPProvider`, kept alive only because nothing constructs the class. The protocol it speaks was security-quarantined by the capability inventory (`relay-prototype-quarantine`: the old relay "不能作为安全 Carrier 迁入生产" — Phase 8 must build a new secure outbound relay), and the current specification routes remote transport through the official Remote/API Gateway carriers, forbidding the custom parallel `POST /relay/*` endpoint family outright (§2). Every generation since gen-56 carried the retirement as a named open item.

## Decision

Shallow retirement: delete `RelayClient.kt` (284 lines) and the six client-flow tests with their local server harness, keeping everything the quarantine chose to preserve for the Phase 8 rebuild — `link/Noise.kt`, the `relay-noise-vectors.json` interop fixtures with their five pinning tests (now `NoiseVectorTest.kt`, renamed to the package's one-class-one-file convention), and the `RelayRendezvous` vocabulary with its tests. The `java.net.http` import count in Android main sources drops to zero.

## Alternatives considered

Migrating the client to OkHttp was rejected: it would spend transport polish on a class whose target protocol is security-rejected and slated for replacement — unreachable code either way. Deep retirement (also deleting Noise, the vectors, and the rendezvous vocabulary) was rejected: the quarantine explicitly kept the pinned interop vectors as historical reference for the Phase 8 rebuild, and deleting pinned vectors discards evidence a later generation needs. Deferring again was rejected: the trap costs nothing to remove and had already waited four generations.

## Consequences

The Android main source set carries no JDK HttpClient surface anywhere; a future relay client will be built against the Phase 8 secure design with the kept vectors as its interop reference. The core JVM suite drops the six client-flow tests (552 -> 546 tests, 83 -> 82 suites — the deleted client test class was itself a suite). One unrelated flake surfaced during verification (`LiteHTTPProviderTest.aStreamThatEndsBeforeDoneIsTruncation`, one run in six, passes standalone — a real-socket UTF-8 multibyte chunking race against virtual time) and stays out of this change's scope, named here for the flake owner.

## Open follow-ups

The Phase 8 secure outbound relay (new design, kept vectors as reference); the `LiteHTTPProviderTest` stream-truncation flake; the §23 relay traceability row stays NOT_STARTED pending that phase.

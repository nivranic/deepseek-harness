# Agent Note: Native Link offline recovery acceptance

Status: implemented

English | [中文](2026-09-03-native-link-offline-recovery-acceptance.zh.md)

## Problem

Reopening an idle native Link stream proved replacement generation and identity behavior but did not prove recovery while a Session was still advancing. A client could reconnect to a later snapshot while silently losing events, retaining duplicate projection rows, or accepting a snapshot that differed from the Host's authoritative Session cut.

## Decision

The shared 13-step native Link corpus keeps one reconnect step and adds its streaming-loss expectations under `recovery`. Each driver starts a deterministic `slow_success` turn, records the first live `assistant/chunk`, closes the production `session/follow` and `$events` carrier streams, and prevents their automatic retries from opening until the Host finishes the model request. Releasing the test-only retry gate must produce one replacement generation for each stream. A second interruption at the unchanged Host cut must produce one more replacement of each kind without changing the companion projection.

The authenticated loopback control listener first requires the mock provider to remain active after the driver closes both streams, then reports recovery readiness only after `slow_success` becomes `completed` and the Host Session contains a later completed terminal event. It verifies the raw journal has consecutive unique sequence numbers, the offline suffix is non-empty, the replacement opening cursor equals the final Host cursor, `session/page` returns the same records and `hasMore` value for that cut, and the bounded scenario has `hasMore: false`. It derives the expected companion state with `foldCompanionDomain(snapshot.records)`.

Swift, Kotlin, and the TypeScript reference report both projections around the repeated reconnect, their observed cursors, the offline sequence count, and exact replacement counts. The Host accepts a candidate only when both reported projections equal its independently derived state and all reported sequence facts equal the Host observation. The production follow request remains a durable Session address plus its history bound; recovery uses the existing authoritative snapshot and `session/page`, with no resume cursor or second Session authority.

## Alternatives considered

**Add a client-owned resume cursor to `session/follow`.** Rejected because each follow generation already opens with a complete authoritative snapshot and then emits only events after its cursor. A second resume vocabulary would duplicate the Session owner's recovery semantics.

**Trust a native `projectionEqual` boolean.** Rejected because the client under test could make the same folding or comparison error twice. The Host derives the expected state from its own snapshot and compares the complete reported values.

**Require one snapshot record for every raw Session sequence.** Rejected because history may losslessly pack consecutive assistant chunks or replace earlier presentation nodes. Raw-journal continuity proves durable sequence coverage; snapshot and page equality plus the canonical fold prove the client-visible state.

**Treat model completion before reconnect as sufficient offline evidence.** Rejected because an immediate automatic retry could observe most of the turn live. The acceptance observer arms its retry gate before cutting the active streams and releases it only after the Host records the terminal event.

## Consequences

The recovery lane is deterministic and keyless but exercises more lifecycle state than an idle reconnect: stream cancellation must reach the real URLSession or OkHttp call, retries must wait without leaking a generation, and teardown must release any armed gate. The complete-window assertion deliberately bounds this corpus below the follow history limit; long-history pagination remains the existing `session/page` responsibility. A TypeScript reference run validates the Host mechanism, while only the owning Apple and Android workflows can provide cross-language runtime evidence.

## Related

The [real Host native Link acceptance](2026-09-02-real-host-native-link-acceptance.md) owns the shared carrier harness and publication rules. The [Session snapshot projection](2026-08-18-session-snapshot-envelope-projection.md) owns the opening snapshot's projection watermark.

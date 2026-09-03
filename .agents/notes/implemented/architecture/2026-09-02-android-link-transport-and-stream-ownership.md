# Agent Note: Android Link transport and stream ownership

Status: implemented

English | [中文](2026-09-02-android-link-transport-and-stream-ownership.zh.md)

## Problem

The Android [Kotlin wire client](2026-08-30-android-wire-client.md) used `HttpURLConnection` and published a closable reader only after the response body opened. Cancellation during DNS resolution, connect, request write, or response headers therefore had no pre-existing call owner, while `disconnect()` did not guarantee that those blocking phases stopped before teardown joined the reader job. Session and interaction replacements also overwrote job references without serializing concurrent replace and stop operations, so one stream could remain alive after its owner became unreachable.

## Decision

`LinkClient` owns an OkHttp 5.5 client family under the [maintained-dependency policy](../process/2026-07-26-dependencies-over-hand-rolling.md). Pair, describe, and unary operations construct and register their `Call` before enqueue, then await the callback through cancellable suspension; coroutine cancellation invokes `Call.cancel()` and removes the call when its callback settles. Pairing persists credentials only after the response supplies non-empty identity fields, a generated `LinkDeviceRole`, and the requested Link protocol version; malformed responses fail as `BadWire`. Stream collection runs its registered call in one IO owner and passes frames through a rendezvous channel. Settlement cancels the `Call` before it cancels and joins that owner; only the owner closes its `Response` and source, so pinned TLS cancellation never asks a second worker to drain the same unfinished chunked body. No UI coroutine executes a blocking unary `Call.execute()`. Carrier authorization refusals use the reference client's stable failure vocabulary: a `403` body whose string `error` is `forbidden` becomes `LinkClientException.Refused` with code `forbidden` and a message chosen from a non-empty `message`, a non-empty `reason`, then `HTTP 403`; answers without that exact discriminator remain `Carrier` failures. `LinkClient.close()` requests retirement, rejects later calls, cancels every registered call, evicts pooled connections, and shuts down its dispatcher; `closeAndAwait()` additionally waits for every tracked call, stream collector, and dispatcher task to settle. `SwitchableWireDriving.replaceAndAwait()` publishes the next delegate and waits for the retired delegate, so restore and fresh pairing return only after the previous transport is quiescent.

`LinkTransportConfig` makes connect, write, unary read/call, and stream read/call timeouts explicit. A zero stream read or call timeout intentionally permits an idle long-lived stream; cancellation remains the termination mechanism. The shared client installs the same pin-only trust manager and hostname verifier before any call is created. This preserves the [Remote Link access](2026-08-30-remote-link-access-vertical-slice.md) rule: the QR-authenticated leaf SPKI identifies the private Host, and public-CA DNS identity does not replace it.

`SessionModel` and `InteractionModel` delegate stream lifecycle to one generation owner. A mutex serializes replacement, an atomic generation invalidates stale transitions, and separate active and pending job sets keep every started transition awaitable. Synchronous stop invalidates the generation and requests cancellation; awaited stop joins pending transitions and the active stream to quiescence before returning. `CompanionRuntime` owns the stable switchable wire for the Android process. A view-model teardown stops only that model's streams, so configuration changes can recreate the view model without retiring the process-owned transport; a failed pairing closes its temporary client, while a successful pairing transfers that client into the stable wire.

## Verification

Focused Kotlin tests prove that a unary call issued from a Main-like single-thread dispatcher does not block that dispatcher, cancellation reaches the active OkHttp call, and close racing enqueue still settles. Additional deterministic barriers cover TLS connect, request-body write, response-header wait, response-body read, and a stream reader blocked by collector backpressure. A pinned-TLS fixture keeps two chunked NDJSON responses open, cancels both collectors concurrently, and requires both collectors and client retirement to settle. Replacement must wait for the blocked collector and prevent its queued old frame from reaching the model. The tests also interleave model replacement with stop, require awaited teardown to wait for every generation, require model teardown to leave the process-owned wire replaceable, and reject malformed pair identity, role, and version fields without persisting credentials. Transport status tests pin both unary and stream authorization: a canonical `403 forbidden` answer exposes the stable refusal code, while a malformed `403` stays a carrier failure with the HTTP fallback. The [real Host native Link acceptance](../testing/2026-09-02-real-host-native-link-acceptance.md) remains the execution owner for the shared pair-through-revoke corpus; source inspection and generated fixtures cannot substitute for the Kotlin lane result.

## Alternatives considered

**Retain `HttpURLConnection`.** `disconnect()` and reader closure do not provide a call handle that is cancellable before DNS, connect, write, or response headers begin, so they cannot prove quiescent teardown.

**Put a timeout around `join()`.** A bounded wait would let teardown return while the socket or IO job remained alive. It limits waiting but does not retire the resource.

**Close the response from the cancelling coroutine.** OkHttp may drain an unfinished HTTP/1 chunked body during `Response.close()`. A second worker can then contend with the pinned TLS reader for the same input lock, while the IO owner already closes both resources through `use` after `Call.cancel()` stops the read.

**Cancel and overwrite each model job.** A concurrent replacement can publish after stop or overwrite another live job's reference. Serialization plus generation invalidation is required to retain an owner for every transition.

**Restore public-CA hostname validation.** The private Host certificate deliberately uses the QR-authenticated SPKI as its identity. Requiring a public DNS identity would change the existing trust model rather than fix cancellation.

## Consequences

The pure-JVM Android core now has one additional maintained HTTP dependency and explicit transport retirement. Link clients are terminal after `close()`, and lifecycle transitions that depend on complete retirement use the awaited path before they return; a switchable wire constructs a new client rather than reusing the retired one. The [Android Lite HTTP provider](2026-08-31-android-lite-http-provider.md) keeps its separate JDK `HttpClient`; OkHttp is selected for the Link transport's pinning and cancellation ownership, not as a repository-wide networking rewrite.

The official Gradle module build, Android app assembly, and real Host-to-Kotlin result remain platform-lane evidence. Direct Kotlin compilation and JUnit execution can prove the pure-JVM sources on a host without Gradle, but they do not substitute for the Gradle graph, Android SDK, or real native lane. An unavailable step remains `NOT_EXECUTED/HOST_ENVIRONMENT`; focused source or TypeScript evidence never becomes a native `PASS`.

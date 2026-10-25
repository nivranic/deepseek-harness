# Agent Note: The §54 network matrix's in-harness and device-side rounds over the production Lite transport

Status: implemented

English | [中文](2026-10-24-network-matrix.zh.md)

- Date: 2026-10-24
- Class: architecture
- Scope: `apps/android/core` tests (`LiteNetworkMatrixTest.kt`), `apps/android/app` androidTest (`LiteNetworkMatrixNativeTest.kt`), debug overlay (`app/src/debug/`)

## Problem

The Upstream-First spec's §54 names a thirteen-row network matrix (same LAN, different LAN, Wi-Fi→Cellular, Cellular→Wi-Fi, VPN on/off, host IP change, host sleep, host restart, client background, client process death, relay reconnect, packet loss, latency). The Lite companion's transport (`LiteHTTPProvider`) had its failure taxonomy pinned by pure classification tests, a refused-connection round, a truncation round, and the loop's stub-provider error surfacing — but the production transport itself had never been driven under adverse network conditions, neither on the JVM nor on the Android network stack.

## Decision

Split the matrix by what each row can honestly prove in each harness, and verify every in-harness row against the production transport — no fakes. On the JVM (`LiteNetworkMatrixTest`), three real-socket rounds: a 1.5s-delayed first byte survives the disabled read timeout and completes the round (latency); a mid-stream socket reset with `SO_LINGER(0)` reads as a dropped transport (packet loss); a real refused connection drives the production provider through the loop driver and the folded state carries `network/unreachable` — the stub round pinned the shape, this round proves the seam over a real socket. On-device (`LiteNetworkMatrixNativeTest`), the same three rounds over the Android process's own network stack against a loopback listener inside the instrumentation process; cleartext reaches loopback only through a debug-source-set manifest overlay (`network_matrix_loopback.xml`), and the release face never carries it — Android carries no JDK HTTP server, so the device rounds drive raw `ServerSocket` listeners with explicit Content-Length reads (reading to EOF would deadlock: the client keeps its write side open awaiting the response). The physical rig rows — LAN changes, cellular handoffs, VPN toggles, host IP change/sleep/restart, client background/process death, relay reconnect — stay on the external acceptance ledger with the standing §64/§36 device acceptance rows.

## Alternatives considered

Wiring the full OkHttp mockwebserver for every row was rejected: the point of §54 is the production transport's behavior, and a mock webserver replaces exactly the layer under test. Adding retry/backoff machinery as "network resilience" was rejected: §54 asks for verification of existing behavior under network conditions, not new runtime machinery — the loop's existing `network/error` surfacing is the contract. Running the device rounds against a LAN host was rejected: an instrumentation round reaching an external host makes the test environment-dependent, while loopback exercises the same Android network stack path deterministically.

## Consequences

The core aggregate grows 613→616 with the three JVM rounds; the androidTest assembles green under the scanner-env acceptance invocation with the three device rounds. The debug overlay adds `app/src/debug/AndroidManifest.xml` and `res/xml/network_matrix_loopback.xml`; both APK faces rebase (androidTest carries the new class, debug carries the overlay — ff8d2d46 / 3bc0b9cc against the riding lineage comparison). The external ledger rows are recorded as open acceptance items, consistent with the standing external-device rows.

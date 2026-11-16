# Agent Note: HTTP response retirement observes an already closed client

Status: implemented

English | [中文](2026-09-26-http-disconnect-response-retirement.zh.md)

## Problem

A caller can disconnect after the Host accepts a mutation but before its HTTP handler returns. Writing the late result to the closed response returns false. Waiting only for future drain or close events misses the close that already occurred, so the bridge promise stays pending and the native listener cannot finish disposal. This also prevents process-restart acceptance from distinguishing a lost acknowledgement from a teardown failure.

## Decision

The shared Node HTTP bridge checks response destruction and its disconnect signal after the handler returns, before writing each body chunk, and while entering or leaving a backpressure wait. A late response body is cancelled without writing headers. Exiting body iteration cancels unread chunks. A closed response never waits for another socket event. Handlers still own their work until they settle; the bridge supplies the disconnect signal but does not manufacture cancellation of an already accepted Host mutation.

The [Android input decision](../architecture/2026-09-26-android-encrypted-input-checkpoints.md) owns saved request identity and explicit retry. Its native acceptance holds the first RPC result after real Gateway admission and holds Agent processing before its user-message receipt. Force-stop then separates two outcomes: explicit retry before the receipt uses the original request id; restoring after the receipt reconciles it without another prompt RPC. Both preserve a newer draft through another process restart. The [native source](../architecture/2026-09-25-native-remote-connection-source.md) continues to own TLS, device authority, and awaiting all bridge promises during teardown.

## Alternatives considered

**Wait for close alongside drain without checking current state.** An event listener cannot observe a close that happened before registration. The bridge must inspect its owned response and abort state after asynchronous work.

**Return immediately on disconnect and abandon the handler.** This loses ownership of the late response body and any remaining handler cleanup. The bridge waits for handler settlement and cancels the returned body.

**Increase test or shutdown deadlines.** A missed event has no future completion signal. Longer deadlines cannot settle the pending bridge.

## Consequences

The same behavior applies to browser HTTP and native HTTPS carriers. Disconnection does not retract an accepted mutation and does not authorize automatic replay. Deterministic regressions cover a late handler result, a late body chunk, and disconnect during backpressure; the late-result regression fails on the former implementation by observing a write after close. Native scenarios use the actual Loader artifact, so a source-only unit result cannot replace rebuilding the Connection package's Node entry. The acceptance driver removes reverse forwarding during failed acquisition only after that forwarding was installed, preserving errors that occur before acquisition.

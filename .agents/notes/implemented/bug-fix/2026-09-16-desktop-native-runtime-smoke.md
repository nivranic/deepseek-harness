# Agent Note: Desktop native checks follow the shipped runtime

Status: implemented

English | [中文](2026-09-16-desktop-native-runtime-smoke.zh.md)

## Problem

The Desktop production graph uses prebuilt system primitives for POSIX Session locking and Koffi-backed kernel semaphores on Windows. Its payload smoke still required the removed `fs-ext` package and tested file seeking, which no production consumer requested. Windows packaging therefore failed after installing its valid production graph. The generated profile also retained an unnecessary build permission for that package.

## Decision

The [payload smoke](../../../../apps/desktop/tests/fixtures/runtime-payload-smoke.mjs) checks the current PTY, FFI, image, and HTML dependencies. The [real Host smoke](../../../../apps/desktop/scripts/smoke-runtime.ts) loads an external plugin with explicit shared peers and runs the [Session lease fixture](../../../../apps/desktop/tests/fixtures/runtime-session-lease.mjs) through the shipped persistence service. Independent backends contend for one materialized Session: a second writer is rejected, a reader can proceed, and a successor acquires write access after release. A private completion marker records success after both backends dispose. The Host and marker must both verify before preparation succeeds.

This exercises the current platform's native lock implementation through public package imports. The [prebuilt system decision](../architecture/2026-09-07-prebuilt-system-primitives.md) continues to own POSIX flock and the unchanged Windows strategy. The [Desktop runtime decision](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md) continues to own package filtering and complete Host startup; its live description is updated, and neither decision is superseded.

The generated profile permits lifecycle builds only for the currently shipped native install scripts. The removed package has no default permission or package-specific copy rules. Unknown assets retain the ordinary copy policy.

## Alternatives considered

**Add the removed package to make its smoke pass.** This restores installation-time compilation without a production consumer and contradicts the prebuilt runtime design.

**Remove the check without replacing its native operation coverage.** Loading a package alone cannot prove that Session writers exclude one another or that release permits a successor.

**Import the private lease implementation from the build checkout.** That could qualify source files while omitting the packaged native dependency. The external plugin resolves the runtime's public packages and shared Cordis instance.

## Consequences

Runtime preparation verifies the native operations actually consumed by its Host, with a fresh Harness home and ordinary Loader composition. Generated metadata and the obsolete package rejection have focused tests; the full packaging path supplies bundled-Node evidence. This does not change Session data, locking semantics, provider behavior, or production timeouts. Each platform still requires its own native execution and release qualification.

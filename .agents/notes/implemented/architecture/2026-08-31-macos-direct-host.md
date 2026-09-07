# Agent Note: The macOS Direct Host target

Status: implemented

English | [中文](2026-08-31-macos-direct-host.zh.md)

## Problem

A Mac Host runs the Harness runtime, while a Companion consumes another Host. Sharing their application composition would mix runtime authority, process ownership and remote client state. The native Host also needs an external lifecycle owner: a Swift termination callback cannot run after the application is killed.

## Decision

`DirectHostMac` keeps its native controls under `Hosts/` and depends on the separate `DirectHostRuntime` product. No Companion target depends on that product. The native supervisor launches the bundled runtime only through `dsh --profile web --no-open --host 127.0.0.1 --port 0`; an ephemeral WebView consumes that single local carrier. Session and administration semantics remain owned by the existing Node services and Web UI.

The supervisor accepts only the authenticated loopback root announcement, verifies HTTP health before publishing ready, bounds startup, and rejects stale activation callbacks. Pipe readers consume one available chunk per DispatchSource event rather than waiting for a requested byte count or EOF; owned descriptors close only after their handlers finish. Restart waits for shutdown before starting another activation and preserves the application home. A closed failure enum owns native diagnostics; runtime output, cookies, response bodies and launch URLs are never status text or persisted logs.

The native `HostRuntimeSupervisor` helper observes a pipe owned by the Swift application and spawns the fixed runtime invocation in a new POSIX process group. Pipe closure or a stop signal requests group termination; grace expiry forces termination and returns a failure status. Natural runtime failure retains its exit status. This helper is process infrastructure and mounts no Harness services or second Gateway.

## Consequences

The [Mac Host producer](../../../../scripts/produce-mac-host.ts) assembles the runtime, rg, spawn-helper and lifecycle helper under `Contents/Resources/Runtime` from one clean candidate checkout. Native binary tools reject wrong architectures, non-macOS slices and deployment targets above macOS 14; copied bytes, embedded product versions, signatures and the ZIP round trip are checked independently. The deployment check reads `LC_BUILD_VERSION.minos` separately from each build tool's `version`; native fields are retained without source paths before validation. The producer seals only the outer app with an ad-hoc signature, preserving the SEA builder's nested signatures and entitlements. A source shell without resources reports unavailable. Companion archive evidence does not cover the Host bundle.

An explicit application `DSH_HOME` is resolved before launch and must be an absolute POSIX directory path. Invalid values cannot fall back to the default home. This supports isolated installed-app verification through the same configuration consumed by the runtime, without a test-only launcher or a second persistence implementation.

The helper owns the runtime group, not the separate POSIX groups and PTY sessions created by tools. As documented by the [local subprocess provider](../../../../packages/subprocess/subprocess-local/README.md), JavaScript-observable shutdown finalizes those resources, while an abrupt runtime or helper death needs external ownership. Full Host no-orphan acceptance remains incomplete until those lifetimes are covered; a group-only smoke cannot close it.

The Apple lane exercises the native helper against real processes and Swift lifecycle behavior against an executable fixture. The separate Mac Host candidate lane builds and tests the assembled app on an ephemeral macOS runner, with production Web content and an isolated home. The UI scenario advances the shipped first-run notice and keyless provider setup through their ordinary controls, then requires an interactive New session control after each activation. Xcode generates sandboxed XCTest runner entitlements independently of the target sandbox setting. The producer verifies the generated runner identity, disables only its App Sandbox entitlement, and ad-hoc signs the XCTest bundle and runner while preserving the other generated permissions. Its independent `/bin/ps` observer checks runtime PID ownership across stop, start and restart; production applications are outside this signing operation. Both diagnostic and verified artifacts retain the final runner entitlements. An application exit during restart fails the UI scenario immediately. Fresh native Host IPS reports contribute only exception categories, termination signals/codes and bounded function locations; process paths, arguments, environment and exception messages are omitted. An absent or unreadable report remains explicit and cannot establish a crash-free run. Its verified artifact requires native UI and bundled Web acceptance; build success alone cannot produce that artifact. Detached-tool cleanup, Developer ID signing, notarization and full supply-chain acceptance remain separate requirements.

## Alternatives considered

Reusing CompanionUI for the host face is rejected because remote client state is not runtime authority. Reimplementing the Harness core or administration API in Swift is rejected because it would introduce a second service implementation. Relying solely on application termination callbacks is rejected because abrupt application death bypasses them. The isolated target remains useful before resource assembly because the dependency graph can already prevent Host code from entering Companion applications.

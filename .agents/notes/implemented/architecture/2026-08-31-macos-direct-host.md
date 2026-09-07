# Agent Note: The macOS Direct Host target

Status: implemented

English | [中文](2026-08-31-macos-direct-host.zh.md)

## Problem

A Mac Host runs the Harness runtime, while a Companion consumes another Host. Sharing their application composition would mix runtime authority, process ownership and remote client state. The native Host also needs an external lifecycle owner: a Swift termination callback cannot run after the application is killed.

## Decision

`DirectHostMac` keeps its native controls under `Hosts/` and depends on the separate `DirectHostRuntime` product. No Companion target depends on that product. The native supervisor launches the bundled runtime only through `dsh --profile web --no-open --host 127.0.0.1 --port 0`; an ephemeral WebView consumes that single local carrier. Session and administration semantics remain owned by the existing Node services and Web UI.

The supervisor accepts only the authenticated loopback root announcement, verifies HTTP health before publishing ready, bounds startup, and rejects stale activation callbacks. Restart waits for shutdown before starting another activation and preserves the application home. A closed failure enum owns native diagnostics; runtime output, cookies, response bodies and launch URLs are never status text or persisted logs.

The native `HostRuntimeSupervisor` helper observes a pipe owned by the Swift application and spawns the fixed runtime invocation in a new POSIX process group. Pipe closure or a stop signal requests group termination; grace expiry forces termination and returns a failure status. Natural runtime failure retains its exit status. This helper is process infrastructure and mounts no Harness services or second Gateway.

## Consequences

Runtime and helper executables must be assembled under the app's `Contents/Resources/Runtime` directory for the selected architecture. A source shell without those resources reports unavailable. Archive generation for Companions does not establish a Full Host bundle or installed WebView behavior.

The helper owns the runtime group, not the separate POSIX groups and PTY sessions created by tools. As documented by the [local subprocess provider](../../../../packages/subprocess/subprocess-local/README.md), JavaScript-observable shutdown finalizes those resources, while an abrupt runtime or helper death needs external ownership. Full Host no-orphan acceptance remains incomplete until those lifetimes are covered; a group-only smoke cannot close it.

The Apple lane exercises the native helper against real processes and Swift lifecycle behavior against an executable fixture, including startup cancellation, failed health, restart and unexpected death. Real installed runtime/WebView execution, detached-tool cleanup, signing and bundle production remain separate required evidence.

## Alternatives considered

Reusing CompanionUI for the host face is rejected because remote client state is not runtime authority. Reimplementing the Harness core or administration API in Swift is rejected because it would introduce a second service implementation. Relying solely on application termination callbacks is rejected because abrupt application death bypasses them. The isolated target remains useful before resource assembly because the dependency graph can already prevent Host code from entering Companion applications.

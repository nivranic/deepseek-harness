# Agent Note: Android checks advertised support before native operations

Status: implemented

English | [中文](2026-09-27-android-operation-capabilities.zh.md)

## Problem

A negotiated connection does not imply that every Session, Workspace or file operation exists. Rendering every control and discovering missing methods through failures sends avoidable requests. Hiding a button alone leaves delayed callbacks and direct model consumers able to send unsupported operations. Clearing all models when support changes would discard unrelated local input.

## Decision

The companion uses the latest successful native negotiation to select its known operations. `NativeObservedCapability.forEndpoint` mirrors the method sets declared by the owning Session, Workspace Files, Workspace and Subagent Remote services. `NativeGatewayClient` checks that mapping after negotiation and before unary dispatch or mux subscription creation. A missing advertised capability produces `host/capability-unavailable` with the fixed capability identifier and no network request. Successful refresh replaces availability; a failed refresh retains the last successful observation.

Compose uses the same recognized capability identifiers to hide unsupported controls and suppress automatic queries. Session listing, following and control are independent. File listing does not require Workspace follow; text reading and resource preview have separate requirements, with preview requiring both stat and byte reads. Subagent listing and child following are independent. Known unsupported operations differ from a connection without an observation.

Session follow retirement and resource-view closure do not delete encrypted drafts, pending prompt identities or the saved Session selection. Restored capabilities can reopen observations without submitting input. Cancelled subagent reads retain existing rows and return to idle without reporting failure. A refused Stop request produces an unconfirmed-stop notice instead of escaping the Activity coroutine.

Capabilities describe API support, not authorization. Pairing-time roles never grant access in this policy; Gateway continues to validate signed admission and permissions for each operation. The mapping covers native-owned method sets, not arbitrary extension methods. Built-in Gateway event transport has no invented capability identifier, so interaction and push consumers keep its existing negotiated-protocol rules.

The [diagnostic decision](2026-09-27-android-native-gateway-diagnostics.md) retains ownership of safe observation and export. Its allowlist includes the public Subagent catalog identifier; unknown identifiers remain excluded. The [transport decision](2026-09-25-native-remote-connection-source.md) retains TLS, identity and retirement rules. Both remain active because this action policy does not replace their rationale.

## Alternatives considered

**Wait for a failed call before hiding controls.** That approach mistakes runtime failures for feature discovery and dispatches operations the Host never advertised.

**Treat a role or a capability as authorization.** An advertised method may still be refused by current Host policy or device revocation. Client presentation cannot replace admission checks.

**Reset every model when the capability set changes.** Independent observations and input have different owners. Closing only unsupported observations preserves the user's local intent and avoids accidental resubmission.

## Consequences

TLS-backed tests verify that missing capabilities leave HTTP and mux counts unchanged and that refresh can remove and restore support. The installed Activity is tested against a real Host whose methods remain mounted while advertised capabilities change; dispatch observation proves suppression independently of UI assertions. The scenario covers retained drafts, restored controls and a refused Stop without automatic prompt submission. Existing permission, file, input and diagnostic scenarios cover the adjacent paths. Complete cross-version behavior, physical devices and additional native features remain separate qualification work.

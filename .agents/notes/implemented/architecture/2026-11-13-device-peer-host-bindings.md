# Agent Note: Device Peers and explicit Host bindings

Status: implemented

English | [中文](2026-11-13-device-peer-host-bindings.zh.md)

## Problem

Native device roles grant operations across one Host. Resource-based Remote Access grants each Session, Workspace, and the identity-less `global` resource independently. Treating a device as the local owner would bypass resource validation and obscure who initiated a persisted user message. Treating its role as a `global` grant would deny resource-addressed operations that the role previously allowed.

## Decision

A verified signature creates a `device` principal carrying DeviceId. Even the device role named `owner` remains distinct from the local owner principal. An unauthenticated native carrier has a `device-pairing` principal whose sole operation is one-time pairing redemption. Each signed unary request and logical stream owns its admitted Peer lifetime.

Remote Access reserves `host` as an explicit binding target. Its listed actions apply to every valid resource; existing `global` and domain bindings keep their independent meanings. Client snapshots carry a separate Host action set and remove it without deleting independent grants. A Host condition receives the actual requested resource and may advertise a Host-wide snapshot grant only when its answer applies across all resources.

Device policies derive endpoint actions from live capability declarations and current stored roles. Bindings receive the service-access Context so isolated providers retain their declarations, and the requested action so Host-selected notifications can be admitted without entering endpoint snapshots. No grant is inferred from a Client capability claim. Revocation removes grants and terminates admitted streams; disposing the listener drains its carriers and Peers.

Forwarded question and approval replies use the application's declared response permission. A reply requires a fresh signed admission from the event stream's device, and permission is checked again before settlement. Other device identities cannot consume the delivery. The official event-id and generation lifecycle remains authoritative; the device carrier adds no parallel interaction record store.

## Alternatives considered

- Reuse local owner identity: rejected because it bypasses resource checks and loses device attribution.
- Extend `global` to cover domain resources: rejected because existing policies rely on resource independence.
- Enumerate every Session and Workspace in each device grant: rejected because the original role covers newly created resources too and requires no per-resource administration.

## Consequences

The TLS tests cover role-specific notifications and replies, cross-device reply refusal, distinct device identity, isolated receivers, revocation, and listener teardown. Remote Access tests cover Host grants, invalid-resource refusal, snapshot removal, and unchanged global isolation. Native Client composition and platform acceptance remain separate from these Host tests. The [native carrier decision](2026-09-25-native-remote-connection-source.md) owns TLS identity and deployment limits; the [Peer and resource decision](2026-10-12-peer-principal-and-remote-access.md) owns the underlying Peer model.

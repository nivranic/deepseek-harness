# Agent Note: Per-request device admission gates business RPC on declared capability permissions

Status: implemented

English | [中文](2026-09-21-per-request-device-admission.zh.md)

- Date: 2026-09-21
- Class: feature
- Scope: `packages/typert/protocol`, `packages/api/gateway`, `packages/api/device-trust`, `packages/api/host-description`

## Problem

Phase 7 admitted devices at Remote event stream open only: a device's role gated interaction replies, but business RPC had no per-request identity, and the section 21 remaining list kept remote execution authorization open. Adjudicating the authorization surface — which permission kind governs which endpoint — was the plan-open decision blocking this increment.

## Decision

Own the classification at the capability layer, distributed to each Remote service, and enforce it per request in the gateway.

- `TypertRemoteCapability` gains an optional `requiredPermission: RemoteCapabilityPermission` (`view` / `prompt.send` / `question.respond` / `approval.respond` / `device.admin` — the section 21 table columns, now a typert-protocol vocabulary so the protocol layer owns no device-trust import).
- A versioned request envelope may carry the signed admission beside `args` — `{apiProtocolVersion, args, device: {deviceId, timestamp, signature}}`; `decodeRemoteRequest` strips the reserved third key like other metadata, and version 1 never carries one (devices speak the current codec). The signature is the same `deviceId\n timestamp` Ed25519 form the stream open uses.
- The gateway verifies the admission through `ctx.deviceTrust` (same cheapest-first ladder) and resolves the endpoint's owning capability: a declared permission the role lacks, or an undeclared capability, refuses with `gateway/permission-denied` (`details.role` + `details.required` / `reason: 'undeclared'`) before dispatch. Anonymous requests never take this path, and `$events`/`$events/result` keep their existing section 15 stream-admission governance.
- First declarations: device-trust's issue/list/revoke declare `device.admin` (redeem and admit stay undeclared — they precede any device identity); host describe/negotiate declare `view` (held by every role, mirroring the diagnostics tier's read-only posture). Business services adopt declarations in their own increments; until then devices are fail-closed on them, which is the deliberate security posture rather than an accident.

## Alternatives considered

- A centralized endpoint→permission table in the gateway: couples every service's authorization surface to one package and invites drift; the capability declaration keeps ownership where the operation is owned.
- Defaulting undeclared capabilities to `view` for devices: fail-open on silence; fail-closed makes each service's declaration an explicit authorization act.
- Reusing the stream admission for RPC identity (socket-scoped state): the mux connection is stateless across logical requests today, and per-request signatures need no server-side session.

## Consequences

- The `gateway/permission-denied` details widen to a union (HTTP fault | device refusal with role+required/undeclared); the error-envelope schema regenerates.
- The replay posture is unchanged: the acceptance window bounds signature reuse across endpoints; a nonce ledger stays deferred and recorded.
- Tests: gateway 446 including eight per-request admission cases (role-held admission, role-refused, owner-on-admin, undeclared refusal, malformed field, service absent, expired timestamp, anonymous unchanged) and codec tests for the reserved envelope key.

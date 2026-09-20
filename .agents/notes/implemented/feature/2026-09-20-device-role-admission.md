# Agent Note: Device roles map onto the section 15 seam through signed admission

Status: implemented

English | [中文](2026-09-20-device-role-admission.zh.md)

- Date: 2026-09-20
- Class: feature
- Scope: `packages/api/device-trust`, `packages/api/gateway`

## Problem

Phase 7 increment 1 landed the device-trust seam with three roles (`viewer`, `collaborator`, `admin`) and process-local permission-less grants; increment 2 made grants durable. Two gaps remained: the spec's section 21 table actually names Viewer/Collaborator/Controller/Owner with five permission columns (查看/发 Prompt/Question/Approval/Device Admin), and the gateway enforced interaction reply permissions from a deployment-wide config switch (`interactionReplyPermissions`) that the section 15 documentation itself said Device Trust roles must replace.

## Decision

Align the role vocabulary to the section 21 table exactly and make the replacement per-client through a signed admission at Remote event stream open.

- `DeviceRole` becomes `'viewer' | 'collaborator' | 'controller' | 'owner'`; `DEVICE_ROLE_PERMISSIONS` (new `src/permissions.ts`) maps each role to exactly the table's columns — `view`, `prompt.send`, `question.respond`, `approval.respond`, `device.admin`. The first version does no arithmetic RBAC, matching the spec's "第一版不要做复杂 RBAC". The durable zod schema changes with it; pre-release, an old stored record with `admin` rejects the domain open (authoritative data).
- `admitDevice` (`device.admit.v1`) verifies one signed admission: base64 Ed25519 over UTF-8 `deviceId + "\n" + timestamp`, checked cheapest-first — grant existence (`device/not-found`), revocation (`device/already-revoked`), timestamp window `admissionWindowMs` default five minutes (`device/admission-expired`, classified `authentication`: re-sign and retry), then signature (`device/key-invalid`). It returns the identity, role, and permission set.
- The gateway's Remote event stream open accepts the admission as the stream's argument — `args: {}` stays anonymous, `args: { device: { deviceId, timestamp, signature } }` identifies a device. Keeping `device` inside `args` (not beside `apiProtocolVersion`) preserves the version-2 envelope contract: `decodeRemoteRequest` strips metadata only for the exact two-key shape. An admitted client's `replyPermissions` become its role's permission set; the existing section 15 check at reply time (`gateway/permission-denied`, no settlement, no delivery consumption, no tool side effect) needs no change. The device-trust service is resolved lazily via `ctx.get`: a composition without it advertises no device capabilities, and a presented identity fails loud with `gateway/service-unavailable` instead of silently degrading to anonymous defaults.

## Alternatives considered

- **Required `static inject = ['deviceTrust']` on the gateway**: forces the storage stack into every gateway composition and every one of its 432 tests, and contradicts the §13 capability-negotigation model where an uncomposed service means unadvertised capabilities. Lazy resolution keeps the seam optional-but-loud.
- **An admission ticket RPC returning a token the stream open presents**: adds replay state and a second secret for no benefit at one-verification-per-connection granularity.
- **Keeping the three-role vocabulary**: the section 21 table is the spec; the moment roles gate behavior is the moment the wire names must match it.

## Consequences

- Revocation takes effect at the device's next stream open, not mid-connection; per-request business-RPC signatures stay deferred. The acceptance window is replay hygiene, not a nonce ledger — recorded as an honest limitation in the package README.
- The gateway now type-depends on `@deepseek-ai/dsh-api-device-trust` (peer+dev), resolved through `tsconfig.base.json` paths; the host program gains the device-trust project reference.
- Tests: 18 device-trust (admission suite per role and failure code) and 49 gateway stream tests (four-role × approval/question matrix through the real WebSocket transport, wrong-key, revoked, malformed-field, service-absent) — 455 total across both packages.
